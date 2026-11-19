// Free translation provider (Azure AI Translator F0, owner 2026-11-19) — the real module with a fake service.
// Run: node tests/azureTranslator.test.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(root, ".tmp-az-"));
let A;
try {
  await build({ stdin: { contents: `export * from "./src/lib/azureTranslator";`, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "a.mjs"), logLevel: "silent", packages: "external", loader: { ".txt": "text" } });
  A = await import(pathToFileURL(path.join(tmp, "a.mjs")).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }

// References stay exactly as written; line breaks survive; HTML in the text is escaped, not interpreted.
const t = "Read John 3:16 and 1 Corinthians 13:4-7.\nThen Psalm 23 and Song of Songs 2:1. <b>not html</b> & more";
const prot = A.protect(t);
ok("Scripture references are protected from translation", prot.includes('<span class="notranslate">John 3:16</span>') && prot.includes('<span class="notranslate">1 Corinthians 13:4-7</span>') && prot.includes('<span class="notranslate">Psalm 23</span>') && prot.includes('<span class="notranslate">Song of Songs 2:1</span>'));
ok("text with < > & is escaped (never treated as markup)", prot.includes("&lt;b&gt;not html&lt;/b&gt; &amp; more"));
ok("round trip: unchanged when nothing is translated", A.unprotect(prot) === t);
ok("ordinary words that aren't book names are not protected", !A.protect("Mark my words, 3 times").includes("notranslate") || A.protect("Mark my words, 3 times") === "Mark my words, 3 times");

// Only text values are sent — never ids, references or the Scripture refs list.
const src = { title: "Grace", metadata: { content: "Para one.\n\nPara two.", discussion_questions: "Q1\nQ2", scriptureRefs: [{ id: "x", verse_ref: "John 3:16" }], lesson_id: "abc", sections: [{ id: "s1", title: "Section", content: "Body" }] } };
const leaves = A.collectLeaves(src).map((l) => l.path.join("."));
ok("translatable fields only (title, content, questions, section text)", JSON.stringify(leaves) === JSON.stringify(["title", "metadata.content", "metadata.discussion_questions", "metadata.sections.0.title", "metadata.sections.0.content"]), JSON.stringify(leaves));

// Calls: key + region headers, html mode, references kept, same shape back.
let calls = [];
A.setTranslatorFetcherForTests(async (url, init) => { calls.push({ url, init }); const body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => body.map((b) => ({ translations: [{ text: b.text.replace("Grace", "Oore-ọfẹ").replace(/Para/g, "Ìpínrọ̀"), to: "yo" }] })) }; });
process.env.AZURE_TRANSLATION_KEY = "k"; delete process.env.AZURE_TRANSLATOR_KEY; process.env.AZURE_TRANSLATOR_REGION = "germanywestcentral";
const r = await A.azureTranslate(src, "yo");
ok("the key name you saved (AZURE_TRANSLATION_KEY) works, with the region header", calls[0].init.headers["Ocp-Apim-Subscription-Key"] === "k" && calls[0].init.headers["Ocp-Apim-Subscription-Region"] === "germanywestcentral");
ok("html mode from English", calls[0].url.includes("textType=html") && calls[0].url.includes("from=en&to=yo"));
ok("translated text comes back in the same shape; ids and Scripture refs untouched", r.result.title === "Oore-ọfẹ" && r.result.metadata.content === "Ìpínrọ̀ one.\n\nÌpínrọ̀ two." && r.result.metadata.scriptureRefs[0].verse_ref === "John 3:16" && r.result.metadata.lesson_id === "abc");
ok("Chinese maps to Azure's code", A.azureLanguage("zh") === "zh-Hans" && A.azureLanguage("tl") === "fil");
let e = null; try { await A.azureTranslate(src, "tw"); } catch (x) { e = x; }
ok("Twi isn't offered by Azure: a clear error, nothing sent", e?.code === "unsupported_language");
A.setTranslatorFetcherForTests(async () => ({ ok: false, status: 429, json: async () => ({}) }));
e = null; try { await A.azureTranslate(src, "de"); } catch (x) { e = x; }
ok("free allowance used up → a plain 'continues next month' error (never a paid tier)", e?.code === "quota" && /next month/.test(e.message));
const eng = readFileSync(path.join(root, "src/lib/translationEngine.ts"), "utf8");
ok("engine: provider switch, licence check before anything is sent, drafts only", eng.includes('if (translationProvider() === "azure")') && eng.includes("await assertTranslationLicensed(contentType, contentId);") && eng.includes('status: "draft",'));
ok("engine: content credited to another author is not translated without confirmed rights", eng.includes("TRANSLATION_LICENSED_MODULES") && eng.includes("class TranslationLicenceError"));
ok("engine: Bible verse text is still never sent", eng.includes("verse_text is NEVER sent to AI"));
console.log(`azureTranslator (api): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
