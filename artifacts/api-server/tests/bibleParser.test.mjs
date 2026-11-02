// lib/bibleReader.ts parseChapterContent — ordinary verses, split verses
// ("29a"/"29b") and joined verse ranges ("JHN.3.1-JHN.3.2", as The Message
// gives them): every passage is kept, numbered by its first verse, with
// `through` naming its last verse. Synthetic content; no network.
// Run: node tests/bibleParser.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(os.tmpdir(), "bible-parser-"));
try {
  const out = await build({ entryPoints: [path.join(root, "src/lib/bibleReader.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
    plugins: [{ name: "m", setup(b) { b.onResolve({ filter: /\/supabase$/ }, () => ({ path: "s", namespace: "m" })); b.onLoad({ filter: /.*/, namespace: "m" }, () => ({ contents: "export const supabaseServiceRole = {};", loader: "js" })); } }] });
  const f = path.join(tmp, "br.mjs"); writeFileSync(f, out.outputFiles[0].text);
  const { parseChapterContent } = await import(pathToFileURL(f).href);
  const t = (text, verseId) => ({ type: "text", text, attrs: { verseId } });
  const para = (style, ...items) => ({ name: "para", type: "tag", attrs: { style }, items });

  // Ordinary translation (KJV-like).
  const kjv = parseChapterContent([para("s1", { type: "text", text: "Heading" }), para("p", t("In the beginning ", "GEN.1.1")), para("p", t("And the earth ", "GEN.1.2"), t("was void.", "GEN.1.2"))]);
  ok("ordinary verses: one per number, heading before verse 1", kjv.verses.length === 2 && kjv.verses[1].text === "And the earth was void." && kjv.headings[0].beforeVerse === 1 && !("through" in kjv.verses[0]));

  // Paraphrase with joined verses (The Message-like), including a split verse 29a / 29b.
  const msg = parseChapterContent([
    para("s1", { type: "text", text: "Born from Above" }),
    para("m", t("There was a man of the Pharisee sect…", "JHN.3.1-JHN.3.2")),
    para("p", t("Jesus said, …", "JHN.3.3")),
    para("p", t("This is how much God loved the world…", "JHN.3.16-JHN.3.18")),
    para("p", t("The bride ends up with the bridegroom.", "JHN.3.27-JHN.3.29a")),
    para("p", t("That's why my cup is running over.", "JHN.3.29b-JHN.3.30")),
  ]);
  ok("joined verses are kept (were dropped before)", msg.verses.length === 5, JSON.stringify(msg.verses.map((v) => v.verse)));
  ok("numbered by first verse, `through` names the last", msg.verses[0].verse === 1 && msg.verses[0].through === 2 && msg.verses[2].verse === 16 && msg.verses[2].through === 18);
  ok("a single verse has no `through`", msg.verses[1].verse === 3 && !("through" in msg.verses[1]));
  ok("split verse 29a/29b: two passages as the publisher lays them out (27–29, 29–30)", msg.verses[3].verse === 27 && msg.verses[3].through === 29 && msg.verses[3].text.includes("bridegroom.")
    && msg.verses[4].verse === 29 && msg.verses[4].through === 30 && msg.verses[4].text.includes("running over."));
  ok("heading still lands before the first passage", msg.headings[0].text === "Born from Above" && msg.headings[0].beforeVerse === 1);
  ok("malformed ids are ignored", parseChapterContent([para("p", t("x", "JHN.3"), t("y", "nonsense"), t("z", null))]).verses.length === 0);
} catch (e) { fail++; console.log("FAIL crashed", e?.stack ?? e); }
finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(`bibleParser: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
