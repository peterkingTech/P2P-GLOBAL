// Bible translation licences — every rule in one place, as plain functions
// (tests/bibleProviders.test.mjs). Two providers, two separate rule sets:
//
//   • API.Bible (unchanged): a translation is shown when its row is
//     is_licensed_confirmed with an API.Bible id; verse text may be copied only
//     when its licence notes say public domain.
//   • AO Lab "Free Use Bible API": being in AO Lab's catalogue grants NOTHING.
//     A translation is shown only after a person has reviewed its own licence
//     and approved it (licence_status 'approved', reviewed_by/at recorded,
//     display AND commercial app distribution explicitly permitted). Every
//     other permission (caching, offline, recorded audio, sharing text) is
//     off unless it was explicitly recorded as permitted. Unknown = no.
// The database enforces the same approval rule (migration 225 check).

export type Provider = "api.bible" | "helloao" | "dbp" | "local";
export type LicenceStatus = "unreviewed" | "approved" | "rejected" | "needs_information";
export const LICENCE_STATUSES: readonly LicenceStatus[] = ["unreviewed", "approved", "rejected", "needs_information"];

/** A p2p_bible_translations row; the licence columns exist from migration 225 (all optional before it). */
export interface TranslationRow {
  translation_code: string; translation_name: string; language: string; is_default_for_language: boolean;
  license_notes: string | null; api_bible_id: string | null; is_licensed_confirmed?: boolean;
  provider?: string | null;
  provider_translation_id?: string | null;
  abbreviation?: string | null; description?: string | null; text_direction?: string | null;
  copyright_notice?: string | null; licence_name?: string | null; licence_url?: string | null; attribution?: string | null; source_url?: string | null;
  permits_commercial?: boolean | null; permits_display?: boolean | null; permits_caching?: boolean | null; permits_offline?: boolean | null;
  permits_audio?: boolean | null; permits_sharing?: boolean | null;
  licence_status?: string | null; licence_questions?: string | null; reviewed_by?: string | null; reviewed_at?: string | null;
  /** Local development preview only (never in production): a catalogue entry shown before review. */
  preview?: boolean;
}

export const providerOf = (r: Pick<TranslationRow, "provider">): Provider => (r.provider === "helloao" ? "helloao" : r.provider === "dbp" ? "dbp" : r.provider === "local" ? "local" : "api.bible");
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** May people read this translation in the app? */
export function isServable(r: TranslationRow): boolean {
  const p = providerOf(r);
  if (p === "api.bible") return r.is_licensed_confirmed !== false && !!r.api_bible_id;
  if (p === "helloao") {
    if (!r.provider_translation_id || !ID_RE.test(r.provider_translation_id)) return false;
    if (r.preview) return true;   // development preview (lib/bibleReader.ts honours it only outside production)
    return r.is_licensed_confirmed === true && r.licence_status === "approved" && !!r.reviewed_by && r.permits_display === true && r.permits_commercial === true;
  }
  return false;
}

/** May the server keep chapters in its short memory cache? */
export const canCache = (r: TranslationRow) => (providerOf(r) === "helloao" ? r.permits_caching === true : true);
/** May verse TEXT leave the app (copy / share)? Otherwise only the reference is shared. */
export const textCopyAllowed = (r: TranslationRow) =>
  providerOf(r) === "helloao" ? r.permits_sharing === true : /public domain/i.test(r.license_notes ?? "");
/** May a provider's RECORDED audio be played? (Device read-aloud reads displayed text and is not a recording.) */
export const canPlayRecordedAudio = (r: TranslationRow) => providerOf(r) === "helloao" && r.permits_audio === true && !r.preview;

/** Where the text comes from and how to credit it, shown under every chapter. */
export function attributionOf(r: TranslationRow): string | null {
  if (providerOf(r) !== "helloao") return null;   // API.Bible returns its own copyright per chapter
  const parts = [r.copyright_notice, r.attribution, r.licence_name ? `Licence: ${r.licence_name}` : null, "Text via the Free Use Bible API (AO Lab)"].filter(Boolean);
  return parts.join(" · ");
}

// ── Review support (never approves anything by itself) ──────────────────────
export interface CatalogueLicence { publicDomain: boolean | null; commercialUse: string | null; attribution: string | null; derivatives: string | null; copyleft: boolean | null }
/**
 * AO Lab's own statement turned into suggested review notes and open
 * questions. The result is always 'unreviewed'; a person decides.
 */
export function reviewNotes(entry: { id: string; licenseUrl: string | null; license: CatalogueLicence | null; numberOfBooks: number }): { status: "unreviewed"; questions: string[]; statement: string } {
  const l = entry.license;
  const q: string[] = [];
  if (!l) q.push("AO Lab gives no licence summary — find the publisher's licence.");
  if (!entry.licenseUrl) q.push("No licence URL — confirm the source and copyright holder.");
  if (l && l.commercialUse !== "allowed") q.push(`Commercial use is "${l.commercialUse ?? "unknown"}" — P2P Global is distributed in app stores; confirm this is permitted.`);
  if (l && l.attribution && l.attribution !== "not-required") q.push(`Attribution "${l.attribution}" — record the exact attribution text to show.`);
  if (l && l.copyleft) q.push("Copyleft (share-alike) — confirm what this requires of us.");
  q.push("Caching on our server, offline storage and recorded audio are NOT assumed — confirm each.");
  if (entry.numberOfBooks < 66) q.push(`Only ${entry.numberOfBooks} books — the reader will say missing books aren't in this translation.`);
  const statement = l
    ? `AO Lab states: public domain ${l.publicDomain ?? "unknown"}, commercial use ${l.commercialUse ?? "unknown"}, attribution ${l.attribution ?? "unknown"}, derivatives ${l.derivatives ?? "unknown"}${l.copyleft ? ", copyleft" : ""}.`
    : "AO Lab gives no licence summary.";
  return { status: "unreviewed", questions: q, statement };
}

/** Is a reviewer's approval complete enough to publish? (Mirrors the database check.) */
export function approvalProblems(r: Pick<TranslationRow, "licence_status" | "permits_display" | "permits_commercial" | "reviewed_by" | "provider_translation_id">): string[] {
  const p: string[] = [];
  if (r.licence_status !== "approved") p.push("The licence hasn't been approved.");
  if (r.permits_display !== true) p.push("Displaying the text must be explicitly permitted.");
  if (r.permits_commercial !== true) p.push("Distribution in a commercial app (app stores) must be explicitly permitted.");
  if (!r.reviewed_by) p.push("The reviewer must be recorded.");
  if (!r.provider_translation_id || !ID_RE.test(r.provider_translation_id)) p.push("The AO Lab translation id is missing or invalid.");
  return p;
}
