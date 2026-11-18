// Biblical Names, Titles and Descriptions (owner brief 2026-11-18): the built data (data/biblical-names.txt) and
// lib/biblicalNames.ts (the real module, bundled). No network, no database.
//   • every verified entry: its wording really is in the stored Scripture text of the translations it claims; its
//     Hebrew/Aramaic/Greek words are real lexicon records, tagged in the primary verse; ids and names unique;
//   • classification: worship expressions carry no Scripture wording and no invented original-language word;
//     forms (Yahweh, Jehovah, Holy Ghost) are renderings, not separate names; Aramaic only with quoted evidence;
//   • the accuracy rules of §9 (Abba, Holy Ghost, Messiah/Christ, YHWH/Jehovah, Desire of all nations, Lord);
//   • search: God, Jesus, Holy Spirit, Yahweh, Yeshua, Abba, Prince of Peace, Names of God / Jesus / the Holy Spirit;
//     no names for a typed reference; filters, facets (only non-empty), sorting, duplicates, missing sources.
// Run: node tests/biblicalNames.test.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(root, ".tmp-names-test-"));
let N;
try {
  await build({ stdin: { contents: `export * from "./src/lib/biblicalNames"; export { getDictionary } from "./src/lib/dictionary";`, resolveDir: root, loader: "ts" },
    bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "n.mjs"), loader: { ".txt": "text" }, logLevel: "silent" });
  N = await import(pathToFileURL(path.join(tmp, "n.mjs")).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }
const data = N.getNames(), E = data.entries, dict = N.getDictionary();
const by = (id) => E.find((e) => e.id === id);
const fold = (s) => ` ${String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’‘'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

// ── data integrity ──
ok("a substantial collection, not a handful", E.length >= 250, String(E.length));
ok("ids unique", new Set(E.map((e) => e.id)).size === E.length);
ok("names unique (no duplicate records)", new Set(E.map((e) => fold(e.name))).size === E.length);
const verified = E.filter((e) => e.status === "verified");
ok("verified entries: primary passage text stored in ≥ 2 translations", verified.every((e) => Object.keys(e.primary?.texts ?? {}).length >= 2));
ok("verified entries: each claimed translation really contains the wording (re-checked from stored text)",
  verified.every((e) => e.primary.matched.length > 0 && e.primary.matched.every((tr) => e.primary.texts[tr])), verified.filter((e) => !e.primary.matched.length).map((e) => e.id).join());
ok("original-language words are real STEPBible records (lemma/gloss from the lexicon, not typed)", E.every((e) => e.original.every((o) => dict.records.get(o.strongs)?.lemma === o.lemma && dict.records.get(o.strongs)?.gloss === o.gloss)));
ok("verified entries with original words: at least one is tagged in the primary verse", verified.filter((e) => e.original.length).every((e) => e.original.some((o) => o.inPrimary)));
ok("worship expressions: no Scripture wording claimed, no original-language word invented", E.filter((e) => e.kind === "worship" && !e.primary).every((e) => e.status === "no_scripture_wording" && !e.original.length));
ok("devotional expressions all show their Scripture basis", E.filter((e) => e.kind === "devotional").every((e) => e.primary && e.status === "verified"));
ok("every entry with a draft note is flagged as a draft by the API", N.entry("el-roi").noteLabel.includes("awaiting editor review"));
ok("Aramaic only with quoted evidence (lexicon language or Easton's own words)", E.filter((e) => e.languages.includes("aramaic")).every((e) => e.original.some((o) => o.language === "aramaic") || /aram|chaldee|syriac/i.test(e.aramaicWord?.quote ?? "")));
ok("Hebrew, Greek and Aramaic all present", ["hebrew", "greek", "aramaic"].every((l) => E.some((e) => e.languages.includes(l))));
ok("Daniel's Aramaic (Ancient of Days) comes from the lexicon's own language tag", by("ancient-of-days").original.some((o) => o.language === "aramaic" && o.inPrimary));
ok("connected passages are labelled as such, never as occurrences", E.flatMap((e) => e.refs).every((r) => r.connected ? (r.matched ?? []).length === 0 : (r.matched ?? []).length > 0));

// ── §9 accuracy rules ──
const yhwh = by("yhwh");
ok("YHWH: one entry shows LORD (KJV/BSB), Jehovah (ASV) and Yahweh (WEB) in the same verse", /LORD/.test(yhwh.primary.texts.KJV) && /Jehovah/.test(yhwh.primary.texts.ASV) && /Yahweh/.test(yhwh.primary.texts.WEB));
ok("Yahweh and Jehovah are FORMS of YHWH, not separate names", by("yahweh").kind === "form" && by("jehovah").kind === "form" && /not three|one name/i.test(yhwh.interp));
ok("Holy Ghost = Holy Spirit (a rendering, same Greek words)", by("holy-ghost").kind === "form" && /same Greek words/.test(by("holy-ghost").interp) && by("holy-ghost").original.map((o) => o.strongs).join() === by("holy-spirit").original.map((o) => o.strongs).join());
ok("Messiah and Christ: one title in two languages", /not two persons/.test(by("christ").interp) && by("messiah").original.some((o) => o.strongs === "G3323"));
ok("Abba: Aramaic for father, not reduced to 'Daddy'", by("abba").languages.includes("aramaic") && /not reduced to “Daddy”|not reduced to "Daddy"/.test(by("abba").interp));
ok("Desire of All Nations: marked disputed, translations differ", by("desire-of-nations").interp.startsWith("Disputed") && /treasures of all nations/.test(by("desire-of-nations").interp));
ok("Prince of Peace: Hebrew sar shalom, messianic reading explained with its New Testament basis", by("prince-of-peace").original.map((o) => o.strongs).join() === "H8269,H7965" && /Matthew 4:14-16/.test(by("prince-of-peace").interp));
ok("Advocate: used of Jesus AND the Spirit, kept distinct", by("advocate-jesus").persons.join() === "son" && by("comforter").persons.join() === "spirit" && /distinct/.test(by("advocate-jesus").interp));
ok("Old Testament names are not silently assigned to Jesus or the Father (person 'god')", ["yhwh", "el-shaddai", "el-roi", "ancient-of-days"].every((id) => by(id).persons.join() === "god"));
ok("shared titles keep each person's passages apart (First and Last: Isaiah = the LORD, Revelation = Jesus)", by("first-and-last").refs.some((r) => r.display.startsWith("Revelation 1:17") && r.person === "son"));
ok("an activity is not made a name (the Spirit intercedes)", by("spirit-intercedes").kind === "description" && /not a formal name/.test(by("spirit-intercedes").interp));
ok("Ruach HaQodesh: the exact later form is said NOT to be in the Old Testament", /not found in that form/.test(by("ruach-hakodesh").interp));

// ── search ──
const S = (q) => N.namesForSearch(q);
ok("God → exact names (Elohim, El) + the Names of God collection", S("God").matches.some((m) => m.id === "elohim") && S("God").collection?.section === "father" && S("God").collection.total > 50);
ok("Jesus → Jesus, Yeshua, Yehoshua + the Jesus collection", ["jesus", "yeshua", "yehoshua"].every((id) => S("Jesus").matches.some((m) => m.id === id)) && S("Jesus").collection.section === "son");
ok("Holy Spirit → Holy Spirit, Holy Ghost, Ruach HaQodesh — not the one-word 'Holy'", ["holy-spirit", "holy-ghost", "ruach-hakodesh"].every((id) => S("Holy Spirit").matches.some((m) => m.id === id)) && !S("Holy Spirit").matches.some((m) => m.id === "holy"));
ok("Yahweh → YHWH, Yahweh and Jehovah", ["yhwh", "yahweh", "jehovah"].every((id) => S("Yahweh").matches.slice(0, 4).some((m) => m.id === id)));
ok("Yeshua → Yeshua first, Jesus related", S("Yeshua").matches[0].id === "yeshua" && S("Yeshua").matches.some((m) => m.id === "jesus"));
ok("Abba → Abba", S("Abba").matches[0].id === "abba");
ok("Prince of Peace → Prince of Peace", S("Prince of Peace").matches[0].id === "prince-of-peace");
ok("Names of God / of Jesus / of the Holy Spirit → open the complete collection", S("Names of God").openCollection && S("Names of Jesus").collection.section === "son" && S("Names of the Holy Spirit").collection.section === "spirit" && S("Names of the Holy Spirit").openCollection);
ok("a two-word expression does not match its one-word part (Way Maker ≠ Maker)", !S("Way Maker").matches.some((m) => m.id === "maker"));
ok("ordinary words name nothing", S("grace of God") === null);
const route = readFileSync(path.join(root, "src/routes/studyWorkspace.ts"), "utf8");
ok("route: no names panel for a typed Scripture reference", route.includes("names = reference ? null : namesForSearch(q)"));
ok("route: names returned with the search; collection and entry endpoints", route.includes("meaning, names });") && route.includes('router.get("/names"') && route.includes('router.get("/names/:id"'));

// ── collections, filters, sorting ──
const greek = N.collection({ section: "son", language: "greek" });
ok("filter by language: every result has it", greek.total > 0 && greek.entries.every((e) => e.languages.includes("greek")));
const kinds = N.collection({ section: "devotional", kind: "worship" });
ok("filter by kind", kinds.entries.every((e) => e.kind === "worship") && kinds.total > 0);
ok("facets only list values that have entries", Object.values(N.collection({ section: "spirit" }).facets).filter(Array.isArray).every((list) => list.every((x) => x.count > 0)));
const canon = N.collection({ section: "father", sort: "canon" }).entries.filter((e) => e.primary);
ok("Bible order: Genesis first", canon[0].primary.book === "GEN");
const alpha = N.collection({ section: "son", sort: "alpha" }).entries.map((e) => e.name);
ok("A–Z sort", alpha.every((n, i) => i === 0 || alpha[i - 1].localeCompare(n) <= 0));
ok("one record can sit in several collections without duplicating", by("king-of-kings").sections.length >= 2 && E.filter((e) => e.name === by("king-of-kings").name).length === 1);
ok("sections G (original languages) and H (background) are computed", N.collection({ section: "original" }).total > 200 && N.collection({ section: "history" }).total > 50);
ok("an entry opens in full with related names and the Easton excerpt", N.entry("yhwh").related.some((r) => r.id === "jehovah") && N.entry("yhwh").eastonExcerpt.length > 50);
ok("unknown entry → null (404 in the route)", N.entry("no-such-name") === null);
ok("coverage is not claimed exhaustive", /not claimed to be exhaustive/.test(N.about().coverage));

console.log(`biblicalNames (api): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
