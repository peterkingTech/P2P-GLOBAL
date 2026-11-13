// Builds the Biblical Dictionary SEARCH INDEX (data/dictionary-index.txt) from the two eligible datasets
// already used by Deep Study, through the same provider (AO Lab Free Use Bible API):
//   • STEPBible Brief Lexicons (CC BY 4.0) — every entry: senses (id, lemma, transliteration, part of speech,
//     English gloss). Definitions are NOT copied: the app fetches them live (GET /deep-study/lexicon/:strongs).
//   • BSB interlinear (public domain) — every word of the Bible: Strong's number, language, BSB rendering;
//     gives each lemma's real occurrences (verse list), counts and how the BSB renders it.
// The index holds identifiers and short glosses only, so search, A–Z browsing and occurrence lists work
// without loading a provider dataset into the app. Re-run to pick up a new dataset version (the header
// records each dataset's catalogue checksum).
//   node scripts/build-dictionary-index.mjs [--raw <cacheDir>]
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://bible.helloao.org";
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../data/dictionary-index.txt");
const rawArg = process.argv.indexOf("--raw");
const RAW = rawArg > 0 ? process.argv[rawArg + 1] : null;
if (RAW) mkdirSync(RAW, { recursive: true });

async function get(p, tries = 4) {
  const cacheFile = RAW ? path.join(RAW, p.replace(/[^\w.-]+/g, "_")) : null;
  if (cacheFile && existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(BASE + p);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      if (cacheFile) writeFileSync(cacheFile, JSON.stringify(j));
      return j;
    } catch (e) { if (i >= tries) throw new Error(`${p}: ${e.message}`); await new Promise((r) => setTimeout(r, 500 * 2 ** i)); }
  }
}
async function pool(items, n, fn) { let i = 0, done = 0; const res = new Array(items.length);
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); if (++done % 1000 === 0) console.log(`  ${done}/${items.length}`); } }));
  return res; }

const catalogue = await get("/api/available_datasets.json");
const ver = (id) => { const d = catalogue.datasets.find((x) => x.id === id); if (!d) throw new Error("dataset missing: " + id); return { id, sha256: d.sha256, licenseUrl: d.licenseUrl, licenseNotes: d.licenseNotes }; };
const datasets = [ver("stepbible-lexicon"), ver("bsb-interlinear")];

// ── Lexicon: every entry's senses ──
const index = (await get("/api/d/stepbible-lexicon/lexicon.json")).lexicon;
console.log("lexicon entries:", index.length);
const entries = await pool(index, 8, async (it) => { const j = await get(`/api/d/stepbible-lexicon/lexicon/${it.id}.json`); return { it, e: j?.entry ?? null }; });

// ── Interlinear: every word ──
const books = (await get("/api/d/bsb-interlinear/books.json")).books;
const chapters = books.flatMap((b, bi) => Array.from({ length: b.numberOfChapters }, (_, c) => ({ book: b.id, bi: bi + 1, ch: c + 1 })));
console.log("interlinear chapters:", chapters.length);
const occ = new Map(); // strongs → { words, verses:Set, renders: Map, langs: Set }
const norm = (s) => String(s ?? "").normalize("NFC").toLowerCase().replace(/[\[\]{}()<>"“”‘’]/g, "").replace(/\s+/g, " ").trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
let words = 0;
await pool(chapters, 6, async ({ book, bi, ch }) => {
  const j = await get(`/api/d/bsb-interlinear/${book}/${ch}.json`);
  for (const v of j?.chapter?.content ?? []) for (const w of v.words ?? []) {
    const m = String(w.strongs ?? "").match(/^([HG])0*(\d{1,4})/i); if (!m) continue;
    const id = `${m[1].toUpperCase()}${m[2].padStart(4, "0")}`;
    let o = occ.get(id); if (!o) occ.set(id, (o = { words: 0, verses: new Set(), renders: new Map(), langs: new Set() }));
    o.words++; words++; o.verses.add(bi * 1_000_000 + ch * 1000 + v.verse); if (w.language) o.langs.add(String(w.language));
    const g = norm(w.gloss); if (g && g !== "-") o.renders.set(g, (o.renders.get(g) ?? 0) + 1);
  }
});
console.log("interlinear words with Strong's:", words);

// ── Compact records ──
// r = [id, lang, lemma, translit, gloss, pos, senses "A=gloss|B=gloss", words, verseRefs(base36 deltas), renders "x:n|y:n", occLangs]
const LANG = { hebrew: "h", aramaic: "a", greek: "g" };
const records = [];
for (const { it, e } of entries) {
  const senses = (e?.senses ?? []).filter((s) => s && s.id);
  const first = senses[0] ?? {};
  const o = occ.get(it.id);
  const refs = o ? [...o.verses].sort((a, b) => a - b) : [];
  let prev = 0; const enc = refs.map((x) => { const d = x - prev; prev = x; return d.toString(36); }).join(",");
  const renders = o ? [...o.renders].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([g, n]) => `${g.replace(/[|:]/g, " ")}:${n}`).join("|") : "";
  records.push([it.id, LANG[it.language] ?? it.language, first.lemma ?? it.name ?? "", first.transliteration ?? "", first.gloss ?? "", first.partOfSpeech ?? "",
    senses.length > 1 ? senses.map((s) => `${s.id.slice(it.id.length) || "-"}=${String(s.gloss ?? "").replace(/[|=]/g, " ")}`).join("|") : "",
    o?.words ?? 0, enc, renders, o ? [...o.langs].map((l) => LANG[l] ?? l).join("") : ""]);
}
const missingEntries = entries.filter((x) => !x.e).map((x) => x.it.id);
// verseRefs encode book NUMBER (1-based position in `books`) × 1,000,000 + chapter × 1000 + verse.
const header = { format: 1, builtAt: new Date().toISOString(), source: BASE, datasets, books: books.map((b) => b.id), counts: { records: records.length, withOccurrences: records.filter((r) => r[7] > 0).length, interlinearWords: words, missingEntries: missingEntries.length },
  fields: ["id", "lang", "lemma", "translit", "gloss", "pos", "senses", "words", "verseRefs", "renders", "occLangs"],
  note: "Search index only (ids, lemmas, transliterations, short glosses, verse references). Definitions are fetched live from the STEPBible lexicon. STEPBible Brief Lexicons © STEPBible.org / Tyndale House, CC BY 4.0; BSB interlinear public domain. Changes: reduced to an index." };
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ header, records }));
console.log("wrote", OUT, (readFileSync(OUT).length / 1e6).toFixed(2), "MB", JSON.stringify(header.counts));
