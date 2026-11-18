// Builds data/biblical-names.txt (served by lib/biblicalNames.ts) from the editable register
// data/biblical-names/register.txt — VERIFYING every entry against its sources (owner brief 2026-11-18):
//   • Scripture: each passage is fetched in five public-domain translations from bible.helloao.org (BSB, KJV, ASV,
//     WEB, YLT) and the entry's wording must appear in it in at least one of them. The primary passage's text is
//     stored in every translation (so "LORD" / "Jehovah" / "Yahweh" can be compared side by side).
//   • Hebrew / Aramaic / Greek: every Strong's number must exist in the STEPBible lexicon (data/dictionary-index.txt);
//     lemma, transliteration, gloss, language and use count come FROM the lexicon (never typed by hand), and the
//     BSB interlinear tagging says whether the word occurs in the primary verse.
//   • Easton's Bible Dictionary: the article title must exist (data/reference-easton.txt).
// Anything that fails is kept out of the verified fields and listed in docs/biblical-names-report.md.
//   node scripts/build-biblical-names.mjs            (chapters are cached in the OS temp folder)
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const repo = path.join(root, "..", "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");

// ── sources ────────────────────────────────────────────────────────────────────────────────────────────────────
const tmp = mkdtempSync(path.join(root, ".tmp-names-"));
let L;
try {
  await build({ stdin: { contents: `export { getDictionary, decodeRefs } from "./src/lib/dictionary"; export { getArticles, articlesForTitle } from "./src/lib/referenceArticles";`, resolveDir: root, loader: "ts" },
    bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "l.mjs"), loader: { ".txt": "text" }, logLevel: "silent" });
  L = await import(pathToFileURL(path.join(tmp, "l.mjs")).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }
const dict = L.getDictionary(), arts = L.getArticles();
const BOOKS = dict.header.books; // GEN … REV
const NAMES = ["Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth","1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah","Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon","Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi","Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians","1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"];
const TRANSLATIONS = [["BSB", "BSB", "Berean Standard Bible"], ["KJV", "eng_kjv", "King James Version"], ["ASV", "eng_asv", "American Standard Version (1901)"], ["WEB", "eng_web", "World English Bible (Classic)"], ["YLT", "eng_ylt", "Young's Literal Translation"]];
const cacheDir = path.join(os.tmpdir(), "p2p-helloao-cache");
mkdirSync(cacheDir, { recursive: true });
const verseText = (v) => v.content.map((c) => (typeof c === "string" ? c : c && typeof c.text === "string" ? c.text : c && c.lineBreak ? " " : "")).join(" ")
  .replace(/\[[‘’“”'"]*\]/g, "").replace(/\s+/g, " ").replace(/\s+([,.;:!?’”)])/g, "$1").replace(/([“‘(])\s+/g, "$1").trim();
const chapters = new Map();
async function chapter(tid, book, ch) {
  const k = `${tid}/${book}/${ch}`;
  if (chapters.has(k)) return chapters.get(k);
  const f = path.join(cacheDir, k.replace(/\//g, "_") + ".json");
  let j;
  if (existsSync(f)) j = JSON.parse(readFileSync(f, "utf8"));
  else {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`https://bible.helloao.org/api/${tid}/${book}/${ch}.json`);
      if (r.ok) { j = await r.json(); break; }
      if (r.status === 404) { j = null; break; }
      if (attempt >= 3) throw new Error(`${k}: HTTP ${r.status}`);
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
    writeFileSync(f, JSON.stringify(j));
  }
  const verses = new Map();
  for (const c of j?.chapter?.content ?? []) if (c.type === "verse") verses.set(c.number, verseText(c));
  chapters.set(k, verses);
  return verses;
}

// ── register ───────────────────────────────────────────────────────────────────────────────────────────────────
const KINDS = new Set(["name", "title", "description", "metaphor", "attribute", "form", "devotional", "worship"]);
const PERSONS = new Set(["father", "son", "spirit", "god"]);
const SECTIONS = new Set(["father", "son", "spirit", "god", "attributes", "devotional"]);
const fold = (s) => ` ${String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’‘'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
const parseRef = (raw) => {
  const m = String(raw).trim().match(/^(~)?([1-3]?[A-Z]{2,3}) (\d+):(\d+)(?:-(\d+))?(?:@(\w+))?$/);
  if (!m || !BOOKS.includes(m[2])) return null;
  const book = m[2], chapter = Number(m[3]), start = Number(m[4]), end = Number(m[5] ?? m[4]);
  return { book, chapter, start, end, connected: !!m[1], person: m[6] ?? null, display: `${NAMES[BOOKS.indexOf(book)]} ${chapter}:${start}${end !== start ? `-${end}` : ""}`, testament: BOOKS.indexOf(book) < 39 ? "OT" : "NT" };
};
const lines = readFileSync(path.join(root, "data/biblical-names/register.txt"), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
const problems = [], entries = [], ids = new Set(), names = new Map();
for (const line of lines) {
  // columns are " | " separated; a "|" with no space on its left (H3070|H3068) stays inside a column
  const c = line.split(/\s+\|(?=\s|$)/).map((x) => x.trim());
  if (c.length !== 13) { problems.push(`malformed line (${c.length} columns): ${line.slice(0, 80)}`); continue; }
  const [id, name, also, kind, persons, sections, ref, refs, phrase, strongs, easton, note, interp] = c;
  if (ids.has(id)) { problems.push(`duplicate id ${id}`); continue; }
  ids.add(id);
  const key = fold(name).trim();
  if (names.has(key)) problems.push(`duplicate name "${name}" (${id} and ${names.get(key)})`);
  names.set(key, id);
  const e = { id, name, also: also ? also.split(";").map((x) => x.trim()).filter(Boolean) : [], kind, persons: persons.split(";").map((x) => x.trim()).filter(Boolean),
    sections: sections.split(",").map((x) => x.trim()).filter(Boolean), note: note || null, interp: interp || null, issues: [] };
  if (!KINDS.has(kind)) e.issues.push(`unknown kind "${kind}"`);
  for (const p of e.persons) if (!PERSONS.has(p)) e.issues.push(`unknown person "${p}"`);
  for (const s of e.sections) if (!SECTIONS.has(s)) e.issues.push(`unknown section "${s}"`);
  e._ref = ref; e._refs = refs; e._phrase = phrase; e._strongs = strongs; e._easton = easton;
  entries.push(e);
}

// ── verification ───────────────────────────────────────────────────────────────────────────────────────────────
const refSets = new Map();
const occursIn = (id, r) => {
  if (!refSets.has(id)) refSets.set(id, new Set(L.decodeRefs(dict.records.get(id)?.refs ?? "")));
  const s = refSets.get(id), b = BOOKS.indexOf(r.book) + 1;
  for (let v = r.start; v <= r.end; v++) if (s.has(b * 1_000_000 + r.chapter * 1000 + v)) return true;
  return false;
};
async function textsOf(r) {
  const out = {};
  for (const [label, tid] of TRANSLATIONS) {
    const vs = await chapter(tid, r.book, r.chapter);
    const parts = []; for (let v = r.start; v <= r.end; v++) if (vs.get(v)) parts.push(vs.get(v));
    if (parts.length) out[label] = parts.join(" ");
  }
  return out;
}
const matchPhrase = (texts, alts) => Object.entries(texts).filter(([, t]) => alts.some((a) => fold(t).includes(fold(a)))).map(([l]) => l);

let fetched = 0;
for (const e of entries) {
  const alts = e._phrase ? e._phrase.split(" / ").map((x) => x.trim()).filter(Boolean) : [];
  // primary passage
  e.primary = null;
  if (e._ref) {
    const r = parseRef(e._ref);
    if (!r) e.issues.push(`primary reference not understood: ${e._ref}`);
    else {
      const texts = await textsOf(r); fetched++;
      const matched = alts.length ? matchPhrase(texts, alts) : [];
      if (!Object.keys(texts).length) e.issues.push(`primary passage ${r.display} not found in any translation`);
      else if (!alts.length) e.issues.push(`no wording given to verify ${r.display}`);
      else if (!matched.length) e.issues.push(`"${alts.join(" / ")}" not found in ${r.display} (${Object.keys(texts).join(", ")})`);
      e.primary = { ...r, texts, matched };
    }
  } else if (e.kind !== "worship") e.issues.push("no primary passage");
  // other passages
  e.refs = [];
  for (const raw of e._refs ? e._refs.split(";").map((x) => x.trim()).filter(Boolean) : []) {
    const r = parseRef(raw);
    if (!r) { e.issues.push(`reference not understood: ${raw}`); continue; }
    if (r.person && !PERSONS.has(r.person)) e.issues.push(`unknown person in ${raw}`);
    if (r.connected) { const t = await textsOf(r); if (!Object.keys(t).length) { e.issues.push(`connected passage ${r.display} not found`); continue; } e.refs.push({ ...r, matched: [] }); continue; }
    const texts = await textsOf(r);
    const matched = matchPhrase(texts, alts);
    if (!matched.length) { e.issues.push(`other passage ${r.display}: wording not found — left out`); continue; }
    e.refs.push({ ...r, matched, text: texts.BSB ?? texts.KJV ?? Object.values(texts)[0] });
  }
  // original language
  e.original = [];
  e.aramaicWord = null;
  for (const raw of e._strongs ? e._strongs.split(/\s+/).filter(Boolean) : []) {
    // "G0005~aramaic": an Aramaic word kept untranslated in the Greek New Testament. Accepted ONLY when the linked
    // Easton article says so in its own words (Aramaic / Aramean / Chaldee / Syriac) — quoted as the evidence.
    const [group, mark] = raw.split("~");
    if (mark === "aramaic") {
      const a = e._easton ? L.articlesForTitle(arts, e._easton)[0] : null;
      // the paragraph of the article that says so, from its start (never a fragment cut mid-reference)
      const sentence = a?.plain.split("\n").find((x) => /\baram(aic|ean)\b|chaldee|syriac/i.test(x));
      if (sentence) e.aramaicWord = { source: `Easton's Bible Dictionary, "${a.title}"`, quote: sentence.trim().slice(0, 300) };
      else e.issues.push(`${group} marked Aramaic but the Easton article does not say so — not shown as Aramaic`);
    }
    const opts = group.split("|").map((s) => s.trim());
    const found = opts.filter((s) => dict.records.has(s));
    if (!found.length) { e.issues.push(`Strong's ${group} not in the STEPBible lexicon`); continue; }
    const inPrim = e.primary ? found.filter((s) => occursIn(s, e.primary)) : [];
    for (const s of inPrim.length ? inPrim : found.slice(0, 1)) {
      const r = dict.records.get(s);
      if (e.original.some((o) => o.strongs === s)) continue;
      e.original.push({ strongs: s, lemma: r.lemma, transliteration: r.transliteration, gloss: r.gloss, language: r.language, uses: r.words,
        inPrimary: !!e.primary && occursIn(s, e.primary), occurrences: L.decodeRefs(r.refs).length });
    }
  }
  if (e.primary && e.original.length && !e.original.some((o) => o.inPrimary)) e.issues.push(`none of the original-language words is tagged in ${e.primary.display} (BSB interlinear)`);
  // Easton
  e.easton = null;
  if (e._easton) {
    const a = L.articlesForTitle(arts, e._easton)[0] ?? arts.list.find((x) => x.title.toLowerCase() === e._easton.toLowerCase());
    if (a) e.easton = { id: a.id, title: a.title }; else e.issues.push(`Easton article "${e._easton}" not found`);
  }
  // derived
  const all = [e.primary, ...e.refs].filter(Boolean);
  e.testaments = [...new Set(all.map((r) => r.testament))].sort();
  e.languages = [...new Set([...e.original.map((o) => o.language), ...(e.aramaicWord ? ["aramaic"] : [])])];
  const primaryOk = e.primary && e.primary.matched.length;
  e.status = e.kind === "worship" && !e.primary ? "no_scripture_wording" : primaryOk && !e.issues.some((i) => /not in the STEPBible|primary|not understood|unknown/.test(i)) ? "verified" : "needs_verification";
  for (const k of ["_ref", "_refs", "_phrase", "_strongs", "_easton"]) delete e[k];
}

// ── output ─────────────────────────────────────────────────────────────────────────────────────────────────────
const sources = {
  bible: TRANSLATIONS.map(([label, tid, name]) => ({ label, name, provider: "bible.helloao.org", id: tid, licence: "Public domain" })),
  lexicon: dict.header.datasets.map((d) => ({ id: d.id, licence: d.licenseUrl })),
  easton: { name: arts.source.name, licence: arts.source.licence },
};
const counts = {
  entries: entries.length,
  byStatus: Object.fromEntries(["verified", "needs_verification", "no_scripture_wording"].map((s) => [s, entries.filter((e) => e.status === s).length])),
  bySection: Object.fromEntries([...SECTIONS].map((s) => [s, entries.filter((e) => e.sections.includes(s)).length])),
  byKind: Object.fromEntries([...KINDS].map((k) => [k, entries.filter((e) => e.kind === k).length])),
  byLanguage: Object.fromEntries(["hebrew", "aramaic", "greek"].map((l) => [l, entries.filter((e) => e.languages.includes(l)).length])),
  withEaston: entries.filter((e) => e.easton).length,
};
writeFileSync(path.join(root, "data/biblical-names.txt"), JSON.stringify({ builtAt: new Date().toISOString(), sources, counts, entries }));
const rep = [`# Biblical Names, Titles and Descriptions — build report`, ``, `Built ${new Date().toISOString()} by \`artifacts/api-server/scripts/build-biblical-names.mjs\` from \`data/biblical-names/register.txt\`.`, ``,
  `## Sources`, ...sources.bible.map((b) => `- ${b.name} (${b.label}) — ${b.licence}, ${b.provider}`), `- STEPBible lexicons TBESH/TBESG + BSB interlinear tagging — CC BY 4.0`, `- ${sources.easton.name} — ${sources.easton.licence}`, ``,
  `## Counts`, "```", JSON.stringify(counts, null, 2), "```", ``,
  `## Needs verification (${entries.filter((e) => e.status === "needs_verification").length})`, ...entries.filter((e) => e.status === "needs_verification").map((e) => `- **${e.name}** (${e.id}): ${e.issues.join("; ")}`), ``,
  `## Verified with notes (${entries.filter((e) => e.status === "verified" && e.issues.length).length})`, ...entries.filter((e) => e.status === "verified" && e.issues.length).map((e) => `- ${e.name}: ${e.issues.join("; ")}`), ``,
  `## Register problems`, ...(problems.length ? problems.map((p) => `- ${p}`) : ["- none"]), ``,
  `## Draft notes`, `Every "note" (speaker, setting, what it communicates) and "interp" text is a DRAFT P2P study note written for this register and shown in the app as awaiting editor review. Facts shown as verified are only: the Scripture wording (checked in the translations listed), the lexicon data and the Easton article link.`];
mkdirSync(path.join(repo, "docs"), { recursive: true });
writeFileSync(path.join(repo, "docs/biblical-names-report.md"), rep.join("\n") + "\n");
console.log(JSON.stringify(counts));
console.log("problems:", problems.length ? problems : "none");
for (const e of entries.filter((x) => x.status === "needs_verification")) console.log(`NEEDS ${e.id}: ${e.issues.join(" ; ")}`);
for (const e of entries.filter((x) => x.status === "verified" && x.issues.length)) console.log(`note ${e.id}: ${e.issues.join(" ; ")}`);
