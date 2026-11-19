// YOUVERSION AUTO-SYNC (owner 2026-11-19: "any new licence I add on my API should show").
// YouVersion only lets a key see the Bibles licensed to it, so the key's own list IS the licence record:
//   • every Bible the key can use is added to P2P automatically (display only, see youversion.ts), except
//       – the same edition P2P already serves from API.Bible / AO Lab (no duplicates in the picker), and
//       – a Bible whose own record carries no copyright / attribution text (owner rule: unknown = no);
//   • a Bible the key can no longer use is hidden at once (licensedTranslations() filters it) — nothing is deleted,
//     so it returns by itself if the licence comes back.
// Runs shortly after the server starts and every 6 hours (index.ts); a super admin can run it now from
// Admin Centre → Bible licences → YouVersion. Additive only: it inserts rows and never updates or deletes one.
import { supabaseServiceRole as db } from "../supabase";
import { logger } from "../logger";
import { yvGet, yvKey } from "./youversion";
import { currentLicensedCount, hasYvLanguageName, recordYouVersionSync, setYvLanguageName } from "./youversionState";

export interface YvListItem { id: number | string; abbreviation?: string; localized_abbreviation?: string; title?: string; localized_title?: string; language_tag?: string; copyright?: string; promotional_content?: string; books?: string[] }
export interface ExistingRow { translation_code: string; translation_name: string; language: string; abbreviation: string | null; provider: string | null; provider_translation_id: string | null }
export interface NewRow { language: string; translation_code: string; translation_name: string; is_default_for_language: false; provider: "youversion"; provider_translation_id: string; abbreviation: string; text_direction: "ltr" | "rtl"; is_licensed_confirmed: true; license_notes: string }
export interface SyncReport {
  at: string; ok: boolean; error?: string; licensed: number; inP2P: number;
  added: { code: string; name: string; language: string }[];
  duplicates: { id: string; abbr: string; language: string; sameAs: string }[];
  noAttribution: { id: string; abbr: string; language: string }[];
  withdrawn: { code: string; name: string }[];
}

// Editions decided by the owner's review on 2026-11-19 (migration 257) — kept out on purpose.
export const EXCLUDED: Record<string, string> = { "51": "same edition as LUT (Luther 1912)", "147": "same edition as RVR09 (Reina-Valera)" };

/** YouVersion language tag → the code P2P uses for that language. */
export function p2pLanguage(tag: string | undefined, abbr = ""): string {
  const t = String(tag ?? "").toLowerCase();
  if (/^zh/.test(t)) return /hant|tw|hk/.test(t) || /CCBT|CSBT/.test(abbr) ? "zh-TW" : "zh";
  if (t === "ak" || t === "tw" || t.startsWith("twi")) return "tw";
  if (t === "fil") return "tl";
  return t.split(/[-_]/)[0];
}
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/^ao-/, "").replace(/[^a-z0-9]/g, "");
const nameNorm = (s: unknown) => String(s ?? "").toLowerCase().replace(/biblica®?|open|®|™|\(.*?\)|\d{4}/g, "").replace(/[^a-z]/g, "");
const RTL = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb"]);
const clean = (s: string) => s.replace(/\s*\(In Review\)\s*/i, " (in review)").replace(/\s+/g, " ").trim();

/** Pure planning step (tested): which licensed Bibles become new rows, which are skipped and why, which were withdrawn. */
export function planSync(list: YvListItem[], existing: ExistingRow[], attributionOf: (id: string) => string | null, rtlOf: (tag: string) => boolean = () => false) {
  const yvIds = new Set(existing.filter((r) => r.provider === "youversion").map((r) => String(r.provider_translation_id)));
  const others = existing.filter((r) => r.provider !== "youversion");
  const codes = new Set(existing.map((r) => r.translation_code.toLowerCase()));
  const licensed = new Set(list.map((b) => String(b.id)));
  const rows: NewRow[] = [];
  const duplicates: SyncReport["duplicates"] = [];
  const noAttribution: SyncReport["noAttribution"] = [];
  const seen = new Set<string>();
  for (const b of list) {
    const id = String(b.id);
    if (seen.has(id) || yvIds.has(id) || !/^\d{1,7}$/.test(id)) continue;
    seen.add(id);
    const abbr = String(b.abbreviation || b.localized_abbreviation || id).trim();
    const lang = p2pLanguage(b.language_tag, abbr);
    if (EXCLUDED[id]) { duplicates.push({ id, abbr, language: lang, sameAs: EXCLUDED[id] }); continue; }
    const dup = others.find((r) => (r.language === lang || r.language.split("-")[0] === lang)
      && (norm(r.abbreviation ?? r.translation_code) === norm(abbr) || norm(r.translation_code) === norm(abbr) || (!!nameNorm(r.translation_name) && nameNorm(r.translation_name) === nameNorm(b.title))));
    if (dup) { duplicates.push({ id, abbr, language: lang, sameAs: `${dup.translation_code} (${dup.provider ?? "api.bible"})` }); continue; }
    const attribution = attributionOf(id);
    if (!attribution) { noAttribution.push({ id, abbr, language: lang }); continue; }
    let code = `YV-${abbr.replace(/[^A-Za-z0-9-]/g, "")}`.slice(0, 30);
    if (code === "YV-" || codes.has(code.toLowerCase())) code = `${code}-${id}`.slice(0, 40);
    codes.add(code.toLowerCase());
    const local = clean(String(b.localized_title || b.title || abbr));
    const english = clean(String(b.title || ""));
    const name = (english && english !== local && /[^\x00-\x7F]/.test(local) ? `${local} (${english.replace(/^.*?\((.*)\)$/, "$1")})` : local).slice(0, 200);
    rows.push({
      language: lang, translation_code: code, translation_name: name, is_default_for_language: false, provider: "youversion",
      provider_translation_id: id, abbreviation: abbr.slice(0, 40), text_direction: RTL.has(lang) || rtlOf(String(b.language_tag ?? "")) ? "rtl" : "ltr",
      is_licensed_confirmed: true,
      license_notes: `YouVersion Platform — licensed to the owner's app key (added automatically ${new Date().toISOString().slice(0, 10)}). DISPLAY ONLY under P2P's copyright rule: shown with this notice, fetched fresh; no caching, offline copy, copying of verse text, P2P Voice or AI. Publisher notice: ${attribution}`.slice(0, 1900),
    });
  }
  const withdrawn = existing.filter((r) => r.provider === "youversion" && !licensed.has(String(r.provider_translation_id)));
  return { rows, duplicates, noAttribution, withdrawn, licensed };
}

let running: Promise<SyncReport> | null = null;
export { lastYouVersionSync, yvLicensedNow, yvLanguageName, setYouVersionStateForTests } from "./youversionState";

async function listKeyBibles(): Promise<YvListItem[]> {
  const out: YvListItem[] = [];
  let token: string | null = null;
  for (let page = 0; page < 60; page++) {
    const j = await yvGet(`/bibles?language_ranges[]=*&page_size=99${token ? `&page_token=${encodeURIComponent(token)}` : ""}`);
    out.push(...((j?.data ?? []) as YvListItem[]));
    token = j?.next_page_token ?? null;
    if (!token) return out;
  }
  throw new Error("YouVersion's list didn't finish");
}

export function syncYouVersion(): Promise<SyncReport> {
  if (!running) running = run().finally(() => { running = null; });
  return running;
}

async function run(): Promise<SyncReport> {
  const at = new Date().toISOString();
  const empty = { licensed: 0, inP2P: 0, added: [], duplicates: [], noAttribution: [], withdrawn: [] };
  if (!yvKey()) { const r: SyncReport = { at, ok: false, error: "The YouVersion key isn't set on the server.", ...empty }; recordYouVersionSync(r); return r; }
  try {
    const list = await listKeyBibles();
    if (!list.length) throw new Error("YouVersion returned no Bibles for the key"); // never hide everything on an empty answer
    const { data, error } = await db.from("p2p_bible_translations").select("translation_code,translation_name,language,abbreviation,provider,provider_translation_id");
    if (error) throw new Error("Couldn't read P2P's translations");
    const existing = (data ?? []) as ExistingRow[];
    const { data: langs } = await db.from("p2p_languages").select("code");
    const appLangs = new Set(((langs ?? []) as { code: string }[]).map((l) => l.code));
    // Language names + direction for languages the app doesn't know (fetched once per server run).
    const dir = new Map<string, boolean>();
    for (const tag of [...new Set(list.map((b) => String(b.language_tag ?? "")).filter(Boolean))]) {
      const code = p2pLanguage(tag);
      if (appLangs.has(code) || hasYvLanguageName(code)) continue;
      try {
        const l = await yvGet(`/languages/${encodeURIComponent(tag)}`);
        const n = String(l?.display_names?.en || l?.localized_name || "").trim();
        if (n) setYvLanguageName(code, n);
        dir.set(tag, l?.text_direction === "rtl");
      } catch { /* the app falls back to the language code's own name */ }
    }
    // The copyright text lives on each Bible's own record — fetched only for Bibles not yet in P2P.
    const yvIds = new Set(existing.filter((r) => r.provider === "youversion").map((r) => String(r.provider_translation_id)));
    const attribution = new Map<string, string>();
    for (const b of list) {
      const id = String(b.id);
      if (yvIds.has(id) || EXCLUDED[id] || attribution.has(id)) continue;
      try { const m = await yvGet(`/bibles/${id}`); const a = String(m?.copyright || m?.promotional_content || "").replace(/\s+/g, " ").trim(); if (a) attribution.set(id, a); } catch { /* skipped until next run */ }
    }
    const plan = planSync(list, existing, (id) => attribution.get(id) ?? null, (tag) => dir.get(tag) === true);
    if (plan.rows.length) {
      for (let i = 0; i < plan.rows.length; i += 100) {
        const { error: e } = await db.from("p2p_bible_translations").upsert(plan.rows.slice(i, i + 100), { onConflict: "translation_code", ignoreDuplicates: true });
        if (e) throw new Error(`Couldn't add the new Bibles (${e.code ?? "error"})`);
      }
    }
    const report: SyncReport = {
      at, ok: true, licensed: plan.licensed.size, inP2P: existing.filter((r) => r.provider === "youversion" && plan.licensed.has(String(r.provider_translation_id))).length + plan.rows.length,
      added: plan.rows.map((r) => ({ code: r.translation_code, name: r.translation_name, language: r.language })),
      duplicates: plan.duplicates, noAttribution: plan.noAttribution, withdrawn: plan.withdrawn.map((r) => ({ code: r.translation_code, name: r.translation_name })),
    };
    recordYouVersionSync(report, plan.licensed);
    logger.info({ licensed: report.licensed, added: report.added.length, withdrawn: report.withdrawn.length }, "YouVersion sync complete");
    return report;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "YouVersion sync failed — previous state kept");
    const r: SyncReport = { at, ok: false, error: (err as Error).message, ...empty, licensed: currentLicensedCount() };
    recordYouVersionSync(r);
    return r;
  }
}
