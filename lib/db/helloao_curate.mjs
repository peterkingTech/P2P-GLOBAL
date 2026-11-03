// AO Lab "Free Use Bible API" — evaluate the WHOLE catalogue and build P2P
// Global's curated translation library from evidence.
//
//   node helloao_curate.mjs            (network: bible.helloao.org + each publisher's licence page)
//
// Writes:
//   lib/db/helloao_catalogue_evaluation.json      every translation, classified from its metadata
//   artifacts/api-server/src/lib/bibleProviders/helloaoRegistry.ts   the curated library (with evidence)
//   migrations/226_helloao_curated_translations.sql                  DRAFT to put it in production
//   docs/bible-translation-library.md                                the report
//
// Classification (licence):
//   APPROVED   the publisher's own licence page confirms public domain, or an open
//              licence that permits our use (CC BY / BY-SA / BY-ND — no non-commercial clause);
//   RESTRICTED the licence forbids commercial use (CC …-NC) — P2P is distributed through
//              app stores, so not usable without the rights holder's permission;
//   REVIEW     anything else: no licence summary, a licence we can't confirm, an unreadable page.
// For the whole catalogue (no page fetched) the class is "eligible / review / restricted" from
// AO Lab's metadata only; only CURATED entries are confirmed against the publisher's page.
// Nothing is invented: missing metadata stays missing and is reported.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API = "https://bible.helloao.org";
const OT = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL"];
const NT = ["MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD","REV"];

// ── The curated selection: why each one ─────────────────────────────────────
// lang = p2p_languages code; type = formal | balanced | contemporary | simplified | traditional | historical
const PICKS = [
  // English — a real range (KJV comes from API.Bible already)
  ["BSB", "en", "balanced", "Modern, accurate and very readable; public domain since 2023 — an excellent everyday English Bible."],
  ["ENGWEBP", "en", "contemporary", "World English Bible: the most widely used open modern-English translation; public domain."],
  ["eng_bbe", "en", "simplified", "Bible in Basic English: a limited 850-word vocabulary — ideal for people reading English as a second language."],
  ["eng_lsv", "en", "formal", "Literal Standard Version: a modern word-for-word translation for close study."],
  ["eng_asv", "en", "traditional", "American Standard Version (1901): a respected formal translation in traditional English."],
  ["eng_ylt", "en", "formal", "Young's Literal Translation: extremely literal — useful for word study beside a readable version."],
  ["eng_gnv", "en", "historical", "Geneva Bible (1599): the Bible of the Reformation era, historically important."],
  // German — with Luther 1912 and Elberfelder from API.Bible
  ["deu_sch", "de", "balanced", "Schlachter Bible (1951): faithful and readable; widely used in German-speaking evangelical churches."],
  ["deu_tkw", "de", "formal", "Textbibel (Kautzsch & Weizsäcker, 1906): a careful scholarly translation for study."],
  // French — with Darby from API.Bible
  ["fra_lsg", "fr", "traditional", "Louis Segond 1910: the standard French Protestant Bible for over a century."],
  ["fra_ncl", "fr", "contemporary", "Néo-Crampon Libre: a modern, openly licensed French translation."],
  ["fra_ost", "fr", "historical", "Ostervald: the classic French Reformed translation."],
  // Spanish / Portuguese — beside API.Bible's Reina-Valera 1909, VBL 2022, PdDpt, Bíblia Livre Para Todos
  ["spa_bes", "es", "simplified", "Biblia en Español Sencillo: plain modern Spanish for new readers."],
  ["spa_onbv", "es", "contemporary", "Open contemporary Spanish translation."],
  ["por_blj", "pt", "formal", "Bíblia Livre: a complete, faithful modern Portuguese Bible."],
  ["por_onbv", "pt", "contemporary", "Open contemporary Portuguese translation."],
  // Africa — West
  ["hau_bib", "ha", "contemporary", "Complete Hausa Bible (our API.Bible plan has only the New Testament) — Hausa is spoken by tens of millions across West Africa."],
  ["ewe_bib", "ee", "traditional", "Complete Ewe Bible (Ghana, Togo)."],
  ["efi_bib", "efi", "contemporary", "Efik (Nigeria) — New Testament only; the only open Efik Scripture."],
  // Africa — East
  ["swh_ulb", "sw", "formal", "Swahili Unlocked Literal Bible — a literal option beside the contemporary Neno version from API.Bible."],
  ["swh_onmm", "sw", "contemporary", "Open Swahili translation (complete)."],
  ["gaz_bib", "om", "contemporary", "Complete Oromo Bible — one of Ethiopia's largest languages."],
  ["run_bib", "rn", "contemporary", "Complete Kirundi Bible (Burundi)."],
  ["lug_bib", "lg", "traditional", "Complete Luganda Bible (Uganda)."],
  ["nyn_bsu", "nyn", "traditional", "Runyankore-Rukiga Bible 1964 (Uganda); public domain."],
  ["ach_abr", "ach", "traditional", "Acoli Bible (northern Uganda, South Sudan); public domain."],
  ["kik_bib", "ki", "traditional", "Complete Kikuyu Bible (Kenya)."],
  ["luo_bib", "luo", "traditional", "Complete Dholuo Bible (Kenya, Tanzania)."],
  // Africa — Central / Southern
  ["lin_bib", "ln", "traditional", "Complete Lingala Bible (DR Congo, Congo)."],
  ["sna_bib", "sn", "traditional", "Complete Shona Bible (Zimbabwe)."],
  ["nde_bib", "nd", "traditional", "Complete North Ndebele Bible (Zimbabwe)."],
  ["nya_bib", "ny", "traditional", "Complete Chichewa Bible (Malawi, Zambia, Mozambique)."],
  ["tsn_bib", "tn", "contemporary", "Tswana (Botswana, South Africa) — New Testament only; the only open Tswana Scripture."],
  // World languages
  ["cmn_cu1", "zh", "traditional", "Chinese Union Version (Simplified): the standard Chinese Protestant Bible; public domain."],
  ["cmn_cuv", "zh-TW", "traditional", "Chinese Union Version (Traditional script); public domain."],
  ["arb_vdv", "ar", "traditional", "Van Dyck Arabic Bible: the classic Arabic Protestant translation; public domain."],
  ["HINIRV", "hi", "balanced", "Hindi Indian Revised Version — a widely used revision, beside the contemporary version from API.Bible."],
  ["ben_irv", "bn", "balanced", "Bengali Indian Revised Version."],
  ["rus_syn", "ru", "traditional", "Russian Synodal Bible: the standard Russian Bible; public domain (no Russian in our API.Bible plan)."],
  ["jpn_kou", "ja", "traditional", "Japanese Kougo-yaku (1955): the standard colloquial Japanese Bible; public domain."],
  ["jpn_bun", "ja", "historical", "Japanese Bungo-yaku: the classic literary Japanese Bible; public domain."],
  ["kor_old", "ko", "historical", "Korean Bible (1910); public domain — the only open Korean Bible."],
  ["vie_1934", "vi", "traditional", "Vietnamese Bible (1923/1934): the traditional Vietnamese Bible; public domain."],
  ["tgl_bib", "tl", "contemporary", "Open Tagalog Contemporary Bible (Philippines)."],
  ["pes_pbs", "fa", "traditional", "Old Persian Version: the classic Persian Bible; public domain."],
  ["urd_irv", "ur", "balanced", "Urdu Indian Revised Version."],
  ["tam_irv", "ta", "balanced", "Tamil Indian Revised Version."],
  ["tel_irv", "te", "balanced", "Telugu Indian Revised Version."],
  ["mar_irv", "mr", "balanced", "Marathi Indian Revised Version."],
  ["guj_irv", "gu", "balanced", "Gujarati Indian Revised Version."],
  ["kan_irv", "kn", "balanced", "Kannada Indian Revised Version."],
  ["mal_irv", "ml", "balanced", "Malayalam Indian Revised Version."],
  ["pan_bib", "pa", "contemporary", "Open Punjabi Contemporary Version."],
  ["ukr_pan", "uk", "traditional", "Ukrainian Bible (Kulish): the classic complete Ukrainian Bible; public domain."],
  ["ita_riv", "it", "traditional", "Riveduta (1927): the standard Italian Protestant revision; public domain."],
  ["heb_mod", "he", "contemporary", "Modern Hebrew Bible; public domain."],
  ["ces_bkr", "cs", "historical", "Kralická Bible (1613): the classic Czech Bible; public domain."],
  ["mya_jvb", "my", "traditional", "Judson Burmese Bible: the standard Burmese Bible; public domain."],
  ["npi_ncb", "ne", "contemporary", "Nepali Contemporary Bible."],
  ["hat_bsa", "ht", "contemporary", "Haitian Creole Bible 2023."],
];
// Languages a curated Bible needs in p2p_languages (name_en, native, flag, rtl).
const NEW_LANGUAGES = {
  om: ["Oromo", "Afaan Oromoo", "🇪🇹"], sn: ["Shona", "chiShona", "🇿🇼"], ln: ["Lingala", "Lingála", "🇨🇩"], rn: ["Kirundi", "Ikirundi", "🇧🇮"],
  lg: ["Luganda", "Luganda", "🇺🇬"], ee: ["Ewe", "Eʋegbe", "🇬🇭"], ny: ["Chichewa", "Chichewa", "🇲🇼"], ki: ["Kikuyu", "Gĩkũyũ", "🇰🇪"],
  luo: ["Dholuo", "Dholuo", "🇰🇪"], nd: ["North Ndebele", "isiNdebele", "🇿🇼"], ach: ["Acoli", "Lwo", "🇺🇬"], nyn: ["Runyankore", "Runyankore", "🇺🇬"],
  tn: ["Tswana", "Setswana", "🇧🇼"], efi: ["Efik", "Efik", "🇳🇬"], gu: ["Gujarati", "ગુજરાતી", "🇮🇳"], kn: ["Kannada", "ಕನ್ನಡ", "🇮🇳"],
  ml: ["Malayalam", "മലയാളം", "🇮🇳"], pa: ["Punjabi", "ਪੰਜਾਬੀ", "🇮🇳"], my: ["Burmese", "မြန်မာ", "🇲🇲"], ne: ["Nepali", "नेपाली", "🇳🇵"], ht: ["Haitian Creole", "Kreyòl ayisyen", "🇭🇹"],
};

const getJson = async (p) => { const r = await fetch(`${API}${p}`, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); };
const pageText = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&copy;/g, "©").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/[‪-‮]/g, "").replace(/[ \t]+/g, " ");

/** The publisher's licence page → { licence, copyright, notes } (only what the page says). */
async function evidence(url) {
  if (!url) return { ok: false, reason: "no licence URL" };
  let u;
  try { u = new URL(url.replace(/[)\]]+.*$/, "")); } catch { return { ok: false, reason: "invalid licence URL" }; }
  if (u.host === "creativecommons.org") {
    const kind = (u.pathname.match(/licenses\/([a-z-]+)\/([\d.]+)/) || []);
    return { ok: true, licence: kind[1] ? `CC ${kind[1].toUpperCase()} ${kind[2]}` : "Creative Commons", licenceUrl: u.href, copyright: null, source: u.href, statement: "Creative Commons licence (URL)" };
  }
  // eBible.org pages, and other publisher pages (a GitHub LICENSE is read as raw text).
  let fetchUrl = u.href;
  if (u.host === "github.com" && /\/blob\//.test(u.pathname)) fetchUrl = `https://raw.githubusercontent.com${u.pathname.replace("/blob/", "/")}`;
  let html;
  try { const r = await fetch(fetchUrl, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) return { ok: false, reason: `licence page on ${u.host}: HTTP ${r.status}` }; html = await r.text(); }
  catch { return { ok: false, reason: `licence page on ${u.host} unreachable` }; }
  const lines = pageText(html).split(/\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.some((l) => /not found/i.test(l)) && lines.length < 10) return { ok: false, reason: "licence page not found" };
  const all = lines.join("\n");
  const copyright = lines.find((l) => /^Copyright\s*©/.test(l)) ?? lines.find((l) => /copyright\s*©/i.test(l) && l.length < 200) ?? null;
  let licence = null, licenceUrl = null;
  // Publisher wording varies: "Attribution-ShareAlike", "Attribution Share-Alike license 4.0", "Attribution license 4.0" …
  if (/Non-?Commercial|by-nc/i.test(all)) licence = "NON-COMMERCIAL";
  else if (/Attribution[\s-]*Share[\s-]*Alike|by-sa/i.test(all)) { licence = "CC BY-SA 4.0"; licenceUrl = "https://creativecommons.org/licenses/by-sa/4.0/"; }
  else if (/Attribution[\s-]*No[\s-]*Deriv|by-nd/i.test(all)) { licence = "CC BY-ND 4.0"; licenceUrl = "https://creativecommons.org/licenses/by-nd/4.0/"; }
  else if (/Creative Commons Attribution (license )?4|licenses\/by\/4/i.test(all)) { licence = "CC BY 4.0"; licenceUrl = "https://creativecommons.org/licenses/by/4.0/"; }
  // eBible.org marks it as a field: a line that is exactly "Public Domain"; elsewhere a sentence must say so.
  else if (lines.some((l) => /^public domain\.?$/i.test(l)) || /\b(is|are|in the|into the|dedicated to the) public domain\b|public domain (translation|text|bible)/i.test(all)) licence = "Public domain";
  const trademark = /trademark/i.test(all) ? (lines.find((l) => /trademark .*requires|keep the .*trademark intact/i.test(l)) ?? null) : null;
  return { ok: !!licence, reason: licence ? null : "no licence statement found on the page", licence, licenceUrl, copyright, trademark, source: u.href,
    statement: lines.find((l) => /This work is made available under|public domain/i.test(l))?.slice(0, 300) ?? null };
}

const books = async (id) => (await getJson(`/api/${id}/books.json`)).books.map((b) => b.id);
const coverageOf = (ids) => {
  const ot = OT.filter((b) => ids.includes(b)).length, nt = NT.filter((b) => ids.includes(b)).length, extra = ids.filter((b) => !OT.includes(b) && !NT.includes(b)).length;
  const kind = ot === 39 && nt === 27 ? (extra ? "bible_plus" : "bible") : ot === 0 && nt === 27 ? "nt" : ot === 39 && nt === 0 ? "ot" : nt === 27 && ot > 0 ? "nt_plus" : "partial";
  const label = { bible: "Complete Bible (Old and New Testaments)", bible_plus: `Complete Bible + ${extra} additional books`, nt: "New Testament only", ot: "Old Testament only", nt_plus: `New Testament + ${ot} Old Testament books`, partial: `Partial Scripture (${ot} OT, ${nt} NT books)` }[kind];
  return { kind, ot, nt, extra, label };
};

// ── 1. Whole catalogue (metadata only) ─────────────────────────────────────
const catalogue = (await getJson("/api/available_translations.json")).translations;
const classify = (t) => {
  const l = t.license;
  if (!l) return { class: "review", reason: "No licence summary in AO Lab's metadata." };
  if (l.publicDomain === true) return { class: "eligible", reason: "AO Lab: public domain (to be confirmed on the publisher's page before use)." };
  if (l.commercialUse === "allowed") return { class: "eligible", reason: `AO Lab: open licence, commercial use allowed, attribution ${l.attribution}, derivatives ${l.derivatives} (to be confirmed on the publisher's page).` };
  if (l.commercialUse === "not-allowed") return { class: "restricted", reason: "Non-commercial licence — P2P is distributed through app stores; needs the rights holder's permission." };
  return { class: "review", reason: "Licence summary incomplete." };
};
const approxCoverage = (n) => (n >= 66 ? "complete or more (66+ books, unverified)" : n === 27 ? "probably New Testament only (27 books, unverified)" : n > 27 ? `partial (${n} books)` : `portions (${n} books)`);
const evaluation = catalogue.map((t) => ({ id: t.id, name: t.englishName ?? t.name, language: t.language, languageName: t.languageEnglishName ?? t.languageName ?? null, textDirection: t.textDirection, books: t.numberOfBooks, coverage: approxCoverage(t.numberOfBooks), licenseUrl: t.licenseUrl ?? null, aoLabLicence: t.license ?? null, ...classify(t) }));

// ── 2. Curated selection, confirmed against books and the publisher's page ──
const byId = new Map(catalogue.map((t) => [t.id, t]));
const curated = [];
for (const [id, lang, type, rationale] of PICKS) {
  const t = byId.get(id);
  if (!t) { curated.push({ id, lang, status: "missing", reason: "Not in AO Lab's catalogue." }); continue; }
  const [ids, ev] = await Promise.all([books(id).catch(() => null), evidence(t.licenseUrl)]);
  const cov = ids ? coverageOf(ids) : null;
  let status = "approved", reason = null;
  if (!cov) { status = "review"; reason = "Book list couldn't be read."; }
  else if (!ev.ok) { status = "review"; reason = ev.reason; }
  else if (ev.licence === "NON-COMMERCIAL") { status = "restricted"; reason = "Publisher's page: non-commercial licence."; }
  else if (!(t.license?.publicDomain === true || t.license?.commercialUse === "allowed")) { status = "review"; reason = "AO Lab's summary and the publisher's page disagree — needs a person."; }
  curated.push({
    id, lang, type, rationale, status, reason,
    name: t.englishName ?? t.name, nativeName: t.name, abbreviation: t.shortName ?? id,
    isoLanguage: t.language, languageName: t.languageEnglishName ?? null, textDirection: t.textDirection === "rtl" ? "rtl" : "ltr",
    coverage: cov?.kind ?? null, coverageLabel: cov?.label ?? null, books: ids?.length ?? null,
    licence: ev.licence ?? null, licenceUrl: ev.licenceUrl ?? t.licenseUrl ?? null, copyright: ev.copyright ?? null, trademark: ev.trademark ?? null,
    source: ev.source ?? t.website ?? null, statement: ev.statement ?? null,
    aoLabLicence: t.license ?? null,
    attribution: t.license?.publicDomain ? null : [ev.copyright, ev.licence ? `Licensed under ${ev.licence}` : null].filter(Boolean).join(". ") || null,
  });
  process.stdout.write(`${status === "approved" ? "✓" : status === "restricted" ? "✗" : "?"} ${id} `);
}
console.log();

// ── 3. Outputs ──────────────────────────────────────────────────────────────
writeFileSync(path.join(repo, "lib/db/helloao_catalogue_evaluation.json"), JSON.stringify({ fetched: new Date().toISOString(), total: catalogue.length, translations: evaluation }, null, 1));
const approved = curated.filter((c) => c.status === "approved");
writeFileSync(path.join(repo, "artifacts/api-server/src/lib/bibleProviders/helloaoRegistry.ts"), `// GENERATED by lib/db/helloao_curate.mjs — do not edit by hand; re-run the script.
// P2P Global's curated AO Lab ("Free Use Bible API") translations, each confirmed
// against its book list (completeness) and its publisher's licence page.
// status 'approved' = the publisher's page confirms public domain or an open
// licence permitting our use. It reaches people only through the
// p2p_bible_translations row (migration 226) — or a local preview.
// Checked: ${new Date().toISOString().slice(0, 10)}.

export interface CuratedTranslation {
  id: string; lang: string; type: string; rationale: string; status: "approved" | "review" | "restricted" | "missing"; reason: string | null;
  name: string; nativeName: string; abbreviation: string; isoLanguage: string; languageName: string | null; textDirection: "ltr" | "rtl";
  coverage: string | null; coverageLabel: string | null; books: number | null;
  licence: string | null; licenceUrl: string | null; copyright: string | null; trademark: string | null; source: string | null; statement: string | null;
  attribution: string | null;
}
export const CURATED_TRANSLATIONS: CuratedTranslation[] = ${JSON.stringify(curated.map(({ aoLabLicence, ...c }) => c), null, 1)};
`);

const s = (v) => (v == null ? "null" : `$cur$${String(v)}$cur$`);
writeFileSync(path.join(repo, "migrations/226_helloao_curated_translations.sql"), `-- 226 (DRAFT — NOT APPLIED; needs owner approval, a restore test and the guarded
-- production apply): P2P Global's curated AO Lab translation library.
-- Generated by lib/db/helloao_curate.mjs from AO Lab's catalogue, each
-- translation's own book list and its publisher's licence page (see
-- docs/bible-translation-library.md). Additive only.
--
--   • p2p_bible_translations: + coverage (bible | bible_plus | nt | ot | nt_plus | partial),
--     + is_curated, + selection_rationale.
--   • p2p_languages: ${Object.keys(NEW_LANGUAGES).length} languages the curated Bibles need (inactive for
--     automatic content translation, like yo / ig / ha / tw).
--   • ${approved.length} APPROVED translations (licence confirmed on the publisher's page).
--     Applying this migration is the owner's sign-off: the reviewer recorded is the
--     earliest super admin, so the approval rule from migration 225 is met.
-- Existing translations and every person's chosen translation are untouched.
-- Rollback: delete the rows with provider 'helloao' and is_curated; delete the
-- language rows if nothing else uses them; drop the three columns.

begin;
alter table public.p2p_bible_translations
  add column if not exists coverage text,
  add column if not exists is_curated boolean not null default false,
  add column if not exists selection_rationale text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_bible_translations_coverage_check') then
    alter table public.p2p_bible_translations add constraint p2p_bible_translations_coverage_check
      check (coverage is null or coverage in ('bible', 'bible_plus', 'nt', 'ot', 'nt_plus', 'partial'));
  end if;
end $$;

${Object.entries(NEW_LANGUAGES).map(([code, [en, native, flag]], i) => `insert into public.p2p_languages (code, name, is_default, name_en, name_native, flag_emoji, is_rtl, is_active, sort_order, ui_review_status)
values ('${code}', ${s(en)}, false, ${s(en)}, ${s(native)}, ${s(flag)}, false, false, ${41 + i}, 'unreviewed') on conflict (code) do nothing;`).join("\n")}

${approved.map((c) => `insert into public.p2p_bible_translations (language, translation_code, translation_name, is_default_for_language, provider, provider_translation_id, abbreviation, description,
  text_direction, copyright_notice, licence_name, licence_url, attribution, source_url, provider_licence, permits_display, permits_commercial, permits_caching, permits_offline, permits_audio, permits_sharing,
  licence_status, licence_questions, reviewed_by, reviewed_at, is_licensed_confirmed, license_notes, coverage, is_curated, selection_rationale)
select '${c.lang}', ${s(`AO-${c.id}`.slice(0, 40))}, ${s(c.name)}, false, 'helloao', ${s(c.id)}, ${s(c.abbreviation)}, ${s(c.coverageLabel)},
  '${c.textDirection}', ${s(c.copyright)}, ${s(c.licence)}, ${s(c.licenceUrl)}, ${s(c.attribution)}, ${s(c.source)}, ${s(JSON.stringify(curatedLicence(c.id)))}::jsonb,
  true, true, ${c.licence === "Public domain"}, false, false, ${c.licence === "Public domain"},
  'approved', ${s(`${c.statement ?? ""}${c.trademark ? `\nTrademark: ${c.trademark}` : ""}`.trim() || null)}, (select id from public.p2p_profiles where role::text = 'super_admin' order by created_at limit 1), now(), true,
  ${s(`${c.licence}${c.copyright ? ` — ${c.copyright}` : ""}`)}, '${c.coverage}', true, ${s(c.rationale)}
where exists (select 1 from public.p2p_profiles where role::text = 'super_admin')
on conflict (translation_code) do nothing;`).join("\n")}
commit;
`);
function curatedLicence(id) { return byId.get(id)?.license ?? null; }

// Report
const count = (cls) => evaluation.filter((e) => e.class === cls).length;
const langs = [...new Set(catalogue.map((t) => t.language))].length;
const byLang = new Map();
for (const c of curated) (byLang.get(c.lang) ?? byLang.set(c.lang, []).get(c.lang)).push(c);
writeFileSync(path.join(repo, "docs/bible-translation-library.md"), `# P2P Global Bible translation library — AO Lab curation

Generated by \`lib/db/helloao_curate.mjs\` on ${new Date().toISOString().slice(0, 10)} from the live AO Lab catalogue.
Full per-translation evaluation: \`lib/db/helloao_catalogue_evaluation.json\`.

## Catalogue

- Translations: **${catalogue.length}** in **${langs}** languages.
- From AO Lab's metadata: **${count("eligible")} eligible** (public domain or open, commercial use allowed — still to be confirmed per translation), **${count("review")} need review** (no or incomplete licence summary), **${count("restricted")} restricted** (non-commercial licence).
- Curated and confirmed against each publisher's licence page: **${approved.length} approved**, ${curated.filter((c) => c.status === "review").length} review, ${curated.filter((c) => c.status === "restricted").length} restricted, ${curated.filter((c) => c.status === "missing").length} missing.

Approved means the publisher's own page states public domain or an open licence
without a non-commercial clause. Copyright, licence and any trademark condition
are recorded with each translation and shown to readers.

## Curated library

${[...byLang.entries()].map(([lang, list]) => `### ${list[0].languageName ?? lang} (\`${lang}\`)\n\n| | Translation | Type | Coverage | Licence | Why |\n|---|---|---|---|---|---|\n${list.map((c) => `| ${c.status === "approved" ? "✅" : c.status === "restricted" ? "⛔" : "⚠️"} | **${c.name}** (\`${c.id}\`) | ${c.type} | ${c.coverageLabel ?? "?"} | ${c.licence ?? c.reason ?? "?"}${c.copyright ? ` — ${c.copyright}` : ""} | ${c.rationale}${c.status !== "approved" ? ` _(${c.reason})_` : ""} |`).join("\n")}`).join("\n\n")}

## Not in the library (and why)

- **No openly licensed translation in the catalogue:** Amharic, Somali, Wolof (non-commercial or no licence), Swedish and Danish (non-commercial), Afrikaans, Zulu, Xhosa (not in the catalogue).
- **Only partial Scripture:** Indonesian (48 books), Norwegian, Finnish, Hungarian, Slovak (New Testament only) — left out rather than shown as Bibles.
- **Already provided by API.Bible** (kept there, not duplicated): KJV, Luther 1912, Elberfelder, Darby, Reina-Valera 1909, VBL, Bíblia Livre Para Todos, Biblica's Swahili Neno, Yoruba, Igbo, Twi, Turkish YTC, Polish UBG, Thai, and others.

## Open questions for a person

${curated.filter((c) => c.status !== "approved").map((c) => `- \`${c.id}\` — ${c.reason}`).join("\n") || "- None among the curated translations."}
- Biblica-published texts (CC BY-SA) require the Biblica® trademark to stay intact on unmodified copies — P2P shows them unmodified, with the copyright line.
- Copyright text is missing on some publisher pages (public-domain texts usually have none) — nothing was invented.
`);
console.log(`catalogue ${catalogue.length} (${langs} languages): eligible ${count("eligible")}, review ${count("review")}, restricted ${count("restricted")}`);
console.log(`curated ${curated.length}: approved ${approved.length}, review ${curated.filter((c) => c.status === "review").length}, restricted ${curated.filter((c) => c.status === "restricted").length}, missing ${curated.filter((c) => c.status === "missing").length}`);
for (const c of curated.filter((c) => c.status !== "approved")) console.log(`  ${c.status}: ${c.id} — ${c.reason}`);
for (const c of curated.filter((c) => c.status === "approved")) console.log(`  ✓ ${c.lang.padEnd(6)} ${c.id.padEnd(10)} ${String(c.coverageLabel).padEnd(42)} ${String(c.licence).padEnd(14)} ${(c.copyright ?? "").slice(0, 50)}`);
