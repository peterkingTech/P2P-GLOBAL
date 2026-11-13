// Builds data/reference-easton.txt — the historical/theological REFERENCE ARTICLES of the Biblical
// Dictionary, from Easton's Bible Dictionary (M. G. Easton, Illustrated Bible Dictionary, 3rd edition,
// Thomas Nelson, 1897). Kept entirely apart from the Hebrew/Greek/Aramaic lexical records.
//
// Edition and rights (verified 2026-11-13 at the primary sources):
//   • CrossWire SWORD module "Easton" v2.0.1 (TEI, CrossWire's cross-referencing), its .conf:
//     DistributionLicense=Public Domain, TextSource=CCEL, About "Public Domain -- Copy Freely".
//     https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Easton
//   • CCEL's etext it comes from: https://ccel.org/ccel/easton/ebd/easton-info.txt ("Public Domain -- Copy
//     Freely"; the illustrations are not included).
// The download is pinned by SHA-256: a different file is refused until someone re-checks its licence.
// The wording is never changed. Scripture references keep the module's own OSIS targets; see-also links
// to entries that don't exist are resolved only by singular/plural, otherwise left as plain text.
//
//   node scripts/build-reference-index.mjs [--zip <local Easton.zip>]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync, inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_ZIP = "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Easton.zip";
const SHA256 = "f6dd054554764e2e97d5d189a697eb26039054578a9ccf98ce668ab810341c6e";
const OUT = path.join(root, "data/reference-easton.txt");

// ── Fetch + verify ──
const zipArg = process.argv.indexOf("--zip");
const zip = zipArg > 0 ? readFileSync(process.argv[zipArg + 1]) : Buffer.from(await (await fetch(URL_ZIP)).arrayBuffer());
const sha = createHash("sha256").update(zip).digest("hex");
if (sha !== SHA256) throw new Error(`Easton.zip has changed (sha256 ${sha}). Re-check the module's licence and edition, then update SHA256.`);

// ── Minimal ZIP reader (central directory → stored / deflated entries) ──
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const files = new Map(); let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0, n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    files.set(name, method === 0 ? data : inflateRawSync(data));
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
const files = unzip(zip);
const conf = files.get("mods.d/easton.conf").toString("utf8");
const confField = (k) => conf.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? null;
if (confField("DistributionLicense") !== "Public Domain") throw new Error("The module no longer declares Public Domain.");
const base = "modules/lexdict/zld/easton/easton";
const [idx, dat, zdx, zdt] = [".idx", ".dat", ".zdx", ".zdt"].map((x) => files.get(base + x));

// ── SWORD zLD: keys (.idx/.dat) → compressed blocks (.zdx/.zdt) ──
const blocks = new Map();
function block(n) {
  if (!blocks.has(n)) {
    const raw = inflateSync(zdt.subarray(zdx.readUInt32LE(n * 8), zdx.readUInt32LE(n * 8) + zdx.readUInt32LE(n * 8 + 4)));
    const out = [];
    for (let i = 0, c = raw.readUInt32LE(0); i < c; i++) { const o = raw.readUInt32LE(4 + i * 8), s = raw.readUInt32LE(8 + i * 8); out.push(raw.subarray(o, o + s).toString("utf8").replace(/\0+$/, "")); }
    blocks.set(n, out);
  }
  return blocks.get(n);
}
const entries = [];
for (let i = 0; i < idx.length / 8; i++) {
  const rec = dat.subarray(idx.readUInt32LE(i * 8), idx.readUInt32LE(i * 8) + idx.readUInt32LE(i * 8 + 4));
  const k = rec.indexOf(10);
  entries.push({ key: rec.subarray(0, k).toString("utf8").replace(/\r$/, ""), tei: block(rec.readUInt32LE(k + 1))[rec.readUInt32LE(k + 5)] });
}

// ── OSIS book → the app's book ids (same canonical order as the dictionary index) ──
const OSIS = "Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev".split(" ");
const BOOKS = JSON.parse(readFileSync(path.join(root, "data/dictionary-index.txt"), "utf8")).header.books;
if (BOOKS.length !== 66) throw new Error("dictionary index book list missing");
const bookOf = new Map(OSIS.map((o, i) => [o, BOOKS[i]]));
/** "Bible:Acts.23.6-Acts.23.8" → "ACT.23.6-8"; "Bible:Gen.1.1-Gen.2.3" → "GEN.1.1-2.3"; a whole chapter
 *  "Bible:Gen.15" → "GEN.15"; outside the 66 books (e.g. 1 Maccabees) → null. */
function ref(osis) {
  const [a, b] = osis.replace(/^Bible:/, "").split("-");
  const m = a.match(/^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?$/); if (!m || !bookOf.has(m[1])) return null;
  if (!m[3]) return `${bookOf.get(m[1])}.${m[2]}`;
  let s = `${bookOf.get(m[1])}.${m[2]}.${m[3]}`;
  const e = b?.match(/^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?$/);
  if (e && e[1] === m[1] && e[3]) s += e[2] === m[2] ? `-${e[3]}` : `-${e[2]}.${e[3]}`;
  return s;
}

// ── TEI → paragraphs of segments: "text" | ["r", ref|null, label] | ["s", articleId|null, label] | ["i", text] ──
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
const slug = (key) => key.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const idOf = new Map(); const ids = new Set();
for (const e of entries) { let id = slug(e.key) || "entry"; for (let n = 2; ids.has(id); n++) id = `${slug(e.key)}-${n}`; ids.add(id); if (!idOf.has(e.key)) idOf.set(e.key, id); e.id = id; }
const resolveSee = (target) => idOf.get(target) ?? idOf.get(target.replace(/S$/, "")) ?? idOf.get(target + "S") ?? idOf.get(target.replace(/ES$/, "")) ?? null;
let refsOut = 0, refsDropped = 0, seeOk = 0, seeUnresolved = 0;
const articles = entries.map((e) => {
  const title = decode(e.tei.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? e.key);
  const paragraphs = [...e.tei.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(([, body]) => {
    const segs = [];
    const push = (x) => { if (typeof x === "string") { if (!x) return; if (typeof segs.at(-1) === "string") segs[segs.length - 1] += x; else segs.push(x); } else segs.push(x); };
    let last = 0;
    for (const m of body.matchAll(/<ref osisRef="([^"]+)">([\s\S]*?)<\/ref>|<ref target="Easton:([^"]+)">([\s\S]*?)<\/ref>|<foreign[^>]*>([\s\S]*?)<\/foreign>/g)) {
      push(decode(body.slice(last, m.index).replace(/<[^>]+>/g, "")));
      if (m[1]) { const r = ref(m[1]); if (r) refsOut++; else refsDropped++; push(["r", r, decode(m[2].replace(/<[^>]+>/g, ""))]); }
      else if (m[3]) { const id = resolveSee(m[3]); if (id) seeOk++; else seeUnresolved++; push(["s", id, decode(m[4].replace(/<[^>]+>/g, ""))]); }
      else push(["i", decode(m[5].replace(/<[^>]+>/g, ""))]);
      last = m.index + m[0].length;
    }
    push(decode(body.slice(last).replace(/<[^>]+>/g, "")));
    return segs.map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ") : s)).filter((s) => s !== " " && s !== "");
  }).filter((p) => p.length);
  return [e.id, e.key, title, paragraphs];
});

const header = {
  format: "p2p-reference-articles/1", builtAt: new Date().toISOString(),
  source: {
    id: "easton", name: "Easton's Bible Dictionary", author: "M. G. Easton", edition: "Illustrated Bible Dictionary, Third Edition (Thomas Nelson, 1897); the illustrations are not included",
    module: { name: "Easton", version: confField("Version"), date: confField("SwordVersionDate"), from: "CrossWire Bible Society (SWORD)", url: "https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Easton", download: URL_ZIP, sha256: SHA256 },
    textSource: confField("TextSource"), licence: confField("DistributionLicense"), notice: "Public Domain -- Copy Freely",
    verified: { on: "2026-11-13", at: ["https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Easton", "https://ccel.org/ccel/easton/ebd/easton-info.txt"] },
  },
  counts: { articles: articles.length, paragraphs: articles.reduce((n, a) => n + a[3].length, 0), scriptureRefs: refsOut, refsOutsideCanon: refsDropped, seeAlsoLinked: seeOk, seeAlsoUnresolved: seeUnresolved },
  fields: ["id", "key", "title", "paragraphs"],
  note: "Wording unchanged from the module. Segments: text | [\"r\", BOOK.c.v[-v|-c.v] or null, label] | [\"s\", article id or null, label] | [\"i\", foreign word].",
};
writeFileSync(OUT, JSON.stringify({ header, articles }));
console.log(`wrote ${path.relative(root, OUT)}: ${articles.length} articles, ${refsOut} Scripture refs (+${refsDropped} outside the 66 books), see-also ${seeOk} linked / ${seeUnresolved} plain; ${(readFileSync(OUT).length / 1e6).toFixed(2)} MB`);
