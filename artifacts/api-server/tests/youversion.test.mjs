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
let Y, L, G, B;
try {
  await build({ stdin: { contents: `export * as Y from "./src/lib/bibleProviders/youversion"; export * as L from "./src/lib/bibleLicence"; export * as G from "./src/lib/aiGovernance"; export { withJesusRanges } from "./src/lib/bibleReader";`, resolveDir: root, loader: "ts" },
    bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "m.mjs"), logLevel: "silent", packages: "external", loader: { ".txt": "text" } });
  ({ Y, L, G, withJesusRanges: B } = await import(pathToFileURL(path.join(tmp, "m.mjs")).href));
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
ok("migration 257: additive inserts only, never overwrites, display-only notice on every row", !/\bupdate |delete from|drop /i.test(mig.replace(/--.*$/gm, "")) && mig.includes("where not exists") && (mig.match(/DISPLAY ONLY/g) ?? []).length === (mig.match(/^\s{2}\(/gm) ?? []).length);
console.log(`youversion (api): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
