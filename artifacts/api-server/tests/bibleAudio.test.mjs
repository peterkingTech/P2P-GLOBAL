// Recorded Bible audio from the owner's API.Bible plan (owner 2026-11-19) — the real module with a fake fetch.
// Run: node tests/bibleAudio.test.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(root, ".tmp-ba-"));
let A;
try {
  await build({ stdin: { contents: `export * from "./src/lib/bibleAudio";`, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "a.mjs"), logLevel: "silent", packages: "external" });
  A = await import(pathToFileURL(path.join(tmp, "a.mjs")).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }

const twi = { translation_code: "WAKNA", api_bible_id: "b6aee081108c0bc6-01", provider: "api.bible", is_licensed_confirmed: true };
const web = { translation_code: "WEB", api_bible_id: "9879dbb7cfe39e4d-01", provider: "api.bible", is_licensed_confirmed: true };
const kjv = { translation_code: "KJV", api_bible_id: "de4e12af7f28f599-02", provider: "api.bible", is_licensed_confirmed: true };
let calls = [];
A.setAudioFetcherForTests(async (url, init) => { calls.push({ url, key: init.headers["api-key"] }); return url.includes("GEN.99") ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ data: { resourceUrl: "https://api-bible-audio-assets-prod.s3.amazonaws.com/x.mp3?sig=1", expiresAt: Math.floor(Date.now() / 1000) + 3600, copyright: "<p>Biblica</p>" } }) }; });
process.env.API_BIBLE_KEY = "test-key";
ok("each text edition pairs with ITS OWN audio edition (Twi Akuapem → Akuapem audio)", A.audioEditionFor(twi)?.audioId === "6e21c09d8edb4838-01");
ok("a translation without an audio edition has none (KJV)", A.audioEditionFor(kjv) === null);
ok("unconfirmed licence → no audio", A.audioEditionFor({ ...twi, is_licensed_confirmed: false }) === null);
ok("AO Lab rows are not served here (their audio comes with the chapter under its own licence)", A.audioEditionFor({ ...twi, provider: "helloao" }) === null);
const a = await A.chapterAudio(twi, "JHN", 3);
ok("a chapter's recording: a streaming link, the edition, the copyright (tags removed)", a.url.startsWith("https://") && a.reader.includes("Akuapem Twi") && a.copyright === "Biblica");
ok("the key goes only to API.Bible from the server", calls.length === 1 && calls[0].key === "test-key" && calls[0].url.startsWith("https://rest.api.bible/v1/audio-bibles/6e21c09d8edb4838-01/chapters/JHN.3"));
await A.chapterAudio(twi, "JHN", 3);
ok("the signed link is reused until near expiry (no repeated requests)", calls.length === 1);
let e = null; try { await A.chapterAudio(web, "GEN", 1); } catch (x) { e = x; }
ok("a New-Testament-only recording isn't offered for the Old Testament", e?.status === 404 && calls.length === 1);
e = null; try { await A.chapterAudio(twi, "GEN", 99); } catch (x) { e = x; }
ok("a chapter with no recording → 404 (the player falls back as usual)", e?.status === 404);
e = null; try { await A.chapterAudio(kjv, "JHN", 3); } catch (x) { e = x; }
ok("no audio edition → 404", e?.status === 404);
const src = readFileSync(path.join(root, "src/lib/bibleAudio.ts"), "utf8");
ok("nothing is stored or cached offline (links only, in memory)", !/storage|upload|writeFile|from\("p2p_/.test(src));
const mig = readFileSync(path.join(root, "../../migrations/256_bible_audio_translations.sql"), "utf8");
ok("migration 256: additive inserts only, never overwrites", !/update |delete from|drop /i.test(mig.replace(/--.*$/gm, "")) && mig.includes("where not exists"));
const app = readFileSync(path.join(root, "../mobile/lib/listen/index.ts"), "utf8");
ok("app: the translation's own recording is never swapped for a generated voice", app.includes('const authorised = o.kind === "bible" || o.kind === "playlist";'));
console.log(`bibleAudio (api): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
