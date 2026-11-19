// YouVersion Platform Bibles (owner 2026-11-19) — the real modules with a fake YouVersion service. The HTML below is
// made up (no copyrighted Bible text is kept in the repository). Run: node tests/youversion.test.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(root, ".tmp-yv-"));
let Y, Y2, L, G, B;
try {
  await build({ stdin: { contents: `export * as Y from "./src/lib/bibleProviders/youversion"; export * as Y2 from "./src/lib/bibleProviders/youversionSync"; export * as L from "./src/lib/bibleLicence"; export * as G from "./src/lib/aiGovernance"; export { withJesusRanges } from "./src/lib/bibleReader";`, resolveDir: root, loader: "ts" },
    bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "m.mjs"), logLevel: "silent", packages: "external", loader: { ".txt": "text" } });
  ({ Y, Y2, L, G, withJesusRanges: B } = await import(pathToFileURL(path.join(tmp, "m.mjs")).href));
} finally { rmSync(tmp, { recursive: true, force: true }); }

const html = `<div><div class="d">A song for testing.</div><div class="q1"><span class="yv-v" v="1"></span><span class="yv-vlbl">1</span>First line &amp; more</div><div class="q2">second line.</div>`
  + `<div class="p"><span class="yv-v" v="2"></span><span class="yv-vlbl">2</span>He said, <span class="wj">“Follow me.”</span> <span class="yv-n">note text</span>Then they went.</div>`
  + `<div class="s1">A heading</div><div class="p"><span class="yv-v" v="3"></span><span class="yv-vlbl">3</span>Last verse.</div></div>`;
const r = Y.parseYouVersionHtml(html);
ok("verses parsed in order, labels and notes removed, entities decoded", r.verses.map((v) => v.verse).join() === "1,2,3" && r.verses[0].text === "First line & more second line." && !/note text|\d/.test(r.verses[1].text));
ok("headings and psalm titles kept as headings, before the right verse", JSON.stringify(r.headings) === JSON.stringify([{ beforeVerse: 1, text: "A song for testing." }, { beforeVerse: 3, text: "A heading" }]));
ok("poetry lines marked", r.verses[0].poetry === true && r.verses[2].poetry === false);
const v2 = B(r.verses[1]);
ok("words of Jesus become the shared emphasis ranges", v2.text === "He said, “Follow me.” Then they went." && JSON.stringify(v2.emphasis?.jesus) === JSON.stringify([[9, 21]]), JSON.stringify(v2));

// Service: key header, attribution fetched fresh with every chapter, failures mapped.
let calls = [];
Y.setYouVersionFetcherForTests(async (url, init) => {
  calls.push({ url, key: init.headers["X-YVP-App-Key"] });
  if (url.endsWith("/bibles/111")) return { ok: true, status: 200, json: async () => ({ copyright: "Test Copyright © Publisher", books: ["GEN", "JHN"], title: "Test" }) };
  if (url.includes("/passages/JHN.3")) return { ok: true, status: 200, json: async () => ({ content: html }) };
  return { ok: false, status: 404, json: async () => ({}) };
});
process.env.YouVersion_API_Key = "k";
const c = await Y.getYvChapter("111", "JHN", 3);
ok("the Railway key name (YouVersion_API_Key) is used, sent as X-YVP-App-Key", calls.every((x) => x.key === "k"));
ok("chapter + the version's own copyright on every load", c.verses.length === 3 && c.copyright === "Test Copyright © Publisher" && calls.some((x) => x.url.endsWith("/bibles/111")));
await Y.getYvChapter("111", "JHN", 3);
ok("nothing cached: the second load asks YouVersion again (attribution always current)", calls.length === 4);
let e = null; try { await Y.getYvChapter("111", "GEN", 99); } catch (x) { e = x; }
ok("a missing passage → 404", e?.status === 404);
Y.setYouVersionFetcherForTests(async (url) => (url.endsWith("/bibles/5") ? { ok: true, status: 200, json: async () => ({ books: [] }) } : { ok: true, status: 200, json: async () => ({ content: html }) }));
e = null; try { await Y.getYvChapter("5", "JHN", 3); } catch (x) { e = x; }
ok("a version without attribution is never shown", e?.status === 503);
e = null; try { await Y.getYvChapter("not-a-number", "JHN", 3); } catch (x) { e = x; }
ok("only numeric YouVersion ids", e?.status === 404);

// Copyright rule: display only.
const row = { translation_code: "YV-NIV11", provider: "youversion", provider_translation_id: "111", is_licensed_confirmed: true, license_notes: "Public Domain" };
ok("served when licensed to the key", L.isServable(row) && !L.isServable({ ...row, is_licensed_confirmed: false }) && !L.isServable({ ...row, provider_translation_id: "x1" }));
ok("not cached on the server", L.canCache(row) === false);
ok("no offline copy (even if a flag said so)", L.offlineAllowed({ ...row, permits_offline: true }) === false);
ok("verse text not copyable/shareable (reference only)", L.textCopyAllowed(row) === false);
ok("no P2P Voice synthesis (even for a public-domain version)", L.syntheticSpeechAllowed(row) === false);
ok("no AI processing", G.aiAllowedFor(row, "send_to_provider") === false && G.aiAllowedFor({ ...row, permits_ai: true }, "ai_analysis") === false);
const reader = readFileSync(path.join(root, "src/lib/bibleReader.ts"), "utf8");
ok("reader: YouVersion chapters bypass the chapter cache; no word search", reader.includes('if (providerOf(t) === "youversion") return youVersionChapter(t, book, chapter);') && reader.includes('if (providerOf(t) === "youversion") throw new BibleError("Word search'));
const mig = readFileSync(path.join(root, "../../migrations/257_youversion_translations.sql"), "utf8").replace(/^--.*$/gm, "");
// The one deliberate DDL: the provider check is dropped and re-added with 'youversion' (existing values still allowed).
const migNoCheck = mig.split("alter table public.p2p_bible_translations drop constraint p2p_bible_translations_provider_check;").join("");
ok("migration 257: inserts + the widened provider check only; never overwrites; display-only notice on every row", !/\bupdate |delete from|drop /i.test(migNoCheck.replace(/--.*$/gm, "")) && mig.includes("check (provider in ('api.bible', 'dbp', 'local', 'helloao', 'youversion'))") && mig.includes("where not exists") && (mig.match(/DISPLAY ONLY/g) ?? []).length === (mig.match(/^\s{2}\(/gm) ?? []).length);
// Auto-sync (owner 2026-11-19: "any new licence I add on my API should show").
const existing = [
  { translation_code: "YV-NIV11", translation_name: "New International Version", language: "en", abbreviation: "NIV11", provider: "youversion", provider_translation_id: "111" },
  { translation_code: "YV-OLD", translation_name: "Old licence", language: "en", abbreviation: "OLD", provider: "youversion", provider_translation_id: "999" },
  { translation_code: "BSB", translation_name: "Berean Standard Bible", language: "en", abbreviation: "BSB", provider: "api.bible", provider_translation_id: null },
];
const list = [
  { id: 111, abbreviation: "NIV11", language_tag: "en", title: "New International Version" },
  { id: 3034, abbreviation: "BSB", language_tag: "en", title: "Berean Standard Bible" },
  { id: 916, abbreviation: "NUB", language_tag: "sv", title: "nuBibeln" },
  { id: 3381, abbreviation: "MGJ", language_tag: "mgj", title: "Abureni" },
  { id: 1264, abbreviation: "ASD", language_tag: "fil", title: "Ang Salita ng Diyos" },
  { id: 51, abbreviation: "DELUT", language_tag: "de", title: "Luther 1912" },
  { id: 777, abbreviation: "NIV11", language_tag: "es", title: "Same abbreviation, other language" },
];
const plan = Y2.planSync(list, existing, (id) => (id === "3381" ? null : `© publisher ${id}`));
const codesAdded = plan.rows.map((r) => r.translation_code);
ok("sync: new licences are added", codesAdded.includes("YV-NUB") && codesAdded.includes("YV-ASD"), codesAdded.join());
ok("sync: already-added YouVersion Bibles are not added again", !plan.rows.some((r) => r.provider_translation_id === "111"));
ok("sync: the same edition P2P already has (API.Bible BSB) is not duplicated", plan.duplicates.some((d) => d.id === "3034") && !codesAdded.includes("YV-BSB"));
ok("sync: owner's 257 exclusions stay out (DELUT)", plan.duplicates.some((d) => d.id === "51"));
ok("sync: no copyright notice → not shown (unknown = no)", plan.noAttribution.some((d) => d.id === "3381") && !plan.rows.some((r) => r.provider_translation_id === "3381"));
ok("sync: a code clash gets the id appended", codesAdded.includes("YV-NIV11-777"));
ok("sync: Filipino maps to the app's Tagalog code", plan.rows.find((r) => r.provider_translation_id === "1264")?.language === "tl");
ok("sync: every added row is display-only, licensed, never a default", plan.rows.every((r) => r.provider === "youversion" && r.is_licensed_confirmed === true && r.is_default_for_language === false && /DISPLAY ONLY/.test(r.license_notes) && /Publisher notice: ©/.test(r.license_notes)));
ok("sync: a Bible the key lost is reported as withdrawn", plan.withdrawn.map((r) => r.translation_code).join() === "YV-OLD");
Y2.setYouVersionStateForTests(["111"], { mgj: "Abureni" });
ok("sync: withdrawn Bibles stop being served; current ones still are", Y2.yvLicensedNow("111") && !Y2.yvLicensedNow("999") && Y2.yvLanguageName("mgj") === "Abureni");
Y2.setYouVersionStateForTests(null);
ok("sync: before the first successful sync nothing is hidden", Y2.yvLicensedNow("999"));
ok("reader filters YouVersion rows by the live licence list", reader.includes("yvLicensedNow(r.provider_translation_id)"));
const syncSrc = readFileSync(path.join(root, "src/lib/bibleProviders/youversionSync.ts"), "utf8");
ok("sync is additive (inserts only, never updates or deletes rows)", !/\.update\(|\.delete\(/.test(syncSrc) && syncSrc.includes("ignoreDuplicates: true"));
ok("sync never hides everything on an empty answer", syncSrc.includes("if (!list.length) throw"));
console.log(`youversion (api): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
