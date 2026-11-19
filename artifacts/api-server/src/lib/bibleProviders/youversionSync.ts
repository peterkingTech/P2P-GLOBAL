// YOUVERSION AUTO-SYNC (owner 2026-11-19: "any new licence I add on my API should show").
// YouVersion only lets a key see the Bibles licensed to it, so the key's own list IS the licence record:
//   • every Bible the key can use is added to P2P automatically (display only, see youversion.ts), except
//       – the same edition P2P already serves from API.Bible / AO Lab (no duplicates in the picker), and
//       – a Bible whose own record carries no copyright / attribution text (owner rule: unknown = no);
//   • a Bible the key can no longer use is hidden at once (licensedTranslations() filters it) — nothing is deleted,
//     so it returns by itself if the licence comes back.
// Gentle on YouVersion's per-key request allowance (the same key serves every reader): one call every 2 s, at most
// BATCH new Bibles per run, app languages first, and a 429 stops the run at once (no retries into the limit).
// Runs shortly after the server starts and every hour (index.ts); a super admin can run it now from
// Admin Centre → Bible licences → YouVersion. Additive only: it inserts rows and never updates or deletes one.
import { supabaseServiceRole as db } from "../supabase";
import { logger } from "../logger";
import { yvGet as yvGetOnce, yvKey, YouVersionError } from "./youversion";
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
  /** Licensed Bibles not checked yet — added by the next runs (a few per run, so readers keep YouVersion's allowance). */
  waiting: number;
  /** Set when YouVersion's request allowance ran out mid-run: what was done is kept, the rest waits for the next run. */
  paused?: string;
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

/** Pure planning step (tested): which licensed Bibles become new rows, which are skipped and why, which were withdrawn.
 *  attributionOf: the copyright text; null = checked and has none; undefined = not checked yet (waits). */
export function planSync(list: YvListItem[], existing: ExistingRow[], attributionOf: (id: string) => string | null | undefined, rtlOf: (tag: string) => boolean = () => false) {
  const yvIds = new Set(existing.filter((r) => r.provider === "youversion").map((r) => String(r.provider_translation_id)));
  const others = existing.filter((r) => r.provider !== "youversion");
  const codes = new Set(existing.map((r) => r.translation_code.toLowerCase()));
  const licensed = new Set(list.map((b) => String(b.id)));
  const rows: NewRow[] = [];
  const duplicates: SyncReport["duplicates"] = [];
  const noAttribution: SyncReport["noAttribution"] = [];
  const waiting: { id: string; language: string }[] = [];
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
    if (attribution === undefined) { waiting.push({ id, language: lang }); continue; }
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
  return { rows, duplicates, noAttribution, withdrawn, licensed, waiting };
}

/** Which waiting Bibles to check this run: app languages first, then the rest; at most `batch`. */
export function pickBatch(waiting: { id: string; language: string }[], appLangs: Set<string>, batch: number) {
  return [...waiting].sort((a, b) => Number(!appLangs.has(a.language)) - Number(!appLangs.has(b.language))).slice(0, batch).map((w) => w.id);
}

let running: Promise<SyncReport> | null = null;
export { lastYouVersionSync, yvLicensedNow, yvLanguageName, setYouVersionStateForTests } from "./youversionState";

export const BATCH = 50;
const GAP_MS = 2_000;
const NO_NOTICE_RECHECK_MS = 24 * 3600_000;
const noNotice = new Map<string, number>(); // id → when it was found without a notice (re-checked daily, not every run)
class RateLimited extends Error {}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** One paced call. 429 → stop the run (RateLimited), never retry into the limit. 5xx/network → one retry later. */
async function yvGet(path: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try { const j = await yvGetOnce(path); await pause(GAP_MS); return j; }
    catch (e) {
      if (e instanceof YouVersionError && e.upstream === 429) throw new RateLimited("YouVersion's request allowance for the key is used up for now");
      if ((e instanceof YouVersionError && (e.status === 404 || e.status === 503)) || attempt >= 1) throw e;
      await pause(10_000);
    }
  }
}

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
  const empty = { licensed: 0, inP2P: 0, added: [], duplicates: [], noAttribution: [], withdrawn: [], waiting: 0 };
  if (!yvKey()) { const r: SyncReport = { at, ok: false, error: "The YouVersion key isn't set on the server.", ...empty }; recordYouVersionSync(r); return r; }
  try {
    const list = await listKeyBibles();
    if (!list.length) throw new Error("YouVersion returned no Bibles for the key"); // never hide everything on an empty answer
    const { data, error } = await db.from("p2p_bible_translations").select("translation_code,translation_name,language,abbreviation,provider,provider_translation_id");
    if (error) throw new Error("Couldn't read P2P's translations");
    const existing = (data ?? []) as ExistingRow[];
    const { data: langs } = await db.from("p2p_languages").select("code");
    const appLangs = new Set(((langs ?? []) as { code: string }[]).map((l) => l.code));
    // Which Bibles still need their copyright record (no-notice ones only once a day).
    const now = Date.now();
    const known = (id: string): null | undefined => { const t = noNotice.get(id); return t && now - t < NO_NOTICE_RECHECK_MS ? null : undefined; };
    const first = planSync(list, existing, known);
    const batch = pickBatch(first.waiting, appLangs, BATCH);
    const attribution = new Map<string, string | null>();
    const dir = new Map<string, boolean>();
    let paused: string | undefined;
    try {
      for (const id of batch) {
        const m = await yvGet(`/bibles/${id}`).catch((e) => { if (e instanceof RateLimited) throw e; return undefined; });
        if (m === undefined) continue; // not reachable now — waits for the next run
        const a = String(m?.copyright || m?.promotional_content || "").replace(/\s+/g, " ").trim();
        attribution.set(id, a || null);
        if (!a) noNotice.set(id, now); else noNotice.delete(id);
      }
      // Language names + direction, only for languages of Bibles added now that the app doesn't know.
      const tags = new Set(list.filter((b) => attribution.get(String(b.id))).map((b) => String(b.language_tag ?? "")).filter(Boolean));
      for (const tag of tags) {
        const code = p2pLanguage(tag);
        if (appLangs.has(code) || hasYvLanguageName(code)) continue;
        const l = await yvGet(`/languages/${encodeURIComponent(tag)}`).catch((e) => { if (e instanceof RateLimited) throw e; return null; });
        const n = String(l?.display_names?.en || l?.localized_name || "").trim();
        if (n) setYvLanguageName(code, n);
        dir.set(tag, l?.text_direction === "rtl");
      }
    } catch (e) {
      if (!(e instanceof RateLimited)) throw e;
      paused = `${e.message}; the rest continues at the next run.`;
    }
    const plan = planSync(list, existing, (id) => (attribution.has(id) ? attribution.get(id)! : known(id)), (tag) => dir.get(tag) === true);
    for (let i = 0; i < plan.rows.length; i += 100) {
      const { error: e } = await db.from("p2p_bible_translations").upsert(plan.rows.slice(i, i + 100), { onConflict: "translation_code", ignoreDuplicates: true });
      if (e) throw new Error(`Couldn't add the new Bibles (${e.code ?? "error"})`);
    }
    const report: SyncReport = {
      at, ok: true, licensed: plan.licensed.size, inP2P: existing.filter((r) => r.provider === "youversion" && plan.licensed.has(String(r.provider_translation_id))).length + plan.rows.length,
      added: plan.rows.map((r) => ({ code: r.translation_code, name: r.translation_name, language: r.language })),
      duplicates: plan.duplicates, noAttribution: plan.noAttribution, withdrawn: plan.withdrawn.map((r) => ({ code: r.translation_code, name: r.translation_name })),
      waiting: plan.waiting.length, ...(paused ? { paused } : {}),
    };
    recordYouVersionSync(report, plan.licensed);
    logger.info({ licensed: report.licensed, added: report.added.length, waiting: report.waiting, withdrawn: report.withdrawn.length, paused: !!paused }, "YouVersion sync complete");
    return report;
  } catch (err) {
    const msg = err instanceof RateLimited ? `${err.message} — nothing changed; the next run tries again.` : (err as Error).message;
    logger.warn({ err: msg }, "YouVersion sync failed — previous state kept");
    const r: SyncReport = { at, ok: false, error: msg, ...empty, licensed: currentLicensedCount() };
    recordYouVersionSync(r);
    return r;
  }
}
