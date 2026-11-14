// Explore Scripture by Topic (2026-11-14): the editorial collection (data/scripture-topics) and the
// participant routes (routes/prayerTopics.ts) over HTTP with an in-memory database.
//   • every existing topic is preserved (never renamed, removed or re-ordered); new topics have unique ids;
//   • every reference is a real passage: book, chapter, start and end verse checked OFFLINE against the verse
//     numbers recorded from the Berean Standard Bible text (scripts/validate-scripture-topics.mjs);
//   • a passage shared by several topics is ONE reference; no duplicate passage inside a topic;
//   • only approved / published passages are shown, counted, or used for Pray the Word progress;
//   • topics carry their category and a visible-passage count.
// Run: node tests/scriptureTopics.test.mjs
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const express = require("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const dataDir = path.join(root, "data", "scripture-topics");
const tmpDir = path.join(root, "tests", `.tmp-topics-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });

try {
  // The shared parser, bundled for Node.
  const lib = await build({ entryPoints: [path.join(root, "src/lib/scriptureTopics.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  writeFileSync(path.join(tmpDir, "lib.mjs"), lib.outputFiles[0].text);
  const L = await import(pathToFileURL(path.join(tmpDir, "lib.mjs")).href);

  // ── The collection ──
  const index = JSON.parse(readFileSync(path.join(dataDir, "index.json"), "utf8"));
  const counts = JSON.parse(readFileSync(path.join(dataDir, "verse-counts.json"), "utf8")).chapters;
  const cats = JSON.parse(readFileSync(path.join(dataDir, "categories.json"), "utf8"));
  const files = readdirSync(dataDir).filter((f) => f.endsWith(".json") && !["index.json", "verse-counts.json", "validation-report.json", "categories.json"].includes(f));
  const topics = [], additions = [];
  for (const f of files) { const j = JSON.parse(readFileSync(path.join(dataDir, f), "utf8")); topics.push(...(j.topics ?? []).map((t) => ({ ...t, category: j.category }))); additions.push(...(j.existingTopicAdditions ?? [])); }
  const EXISTING = ["Calling", "Comfort", "Discipleship", "Evangelism", "Faith", "Family", "Fear & Anxiety", "Forgiveness", "Freedom", "God's Character", "God's Presence", "God's Promises", "God's Will", "Grace", "Gratitude", "Grief", "Guidance", "Healing", "Holiness", "Hope", "Identity in Christ", "Joy", "Leadership", "Loneliness", "Love", "Missions", "Obedience", "Peace", "Perseverance", "Protection", "Provision", "Relationships", "Rest", "Salvation", "Spiritual Growth", "Strength", "Temptation", "The Church", "Trust", "Unity", "Waiting on God", "Wisdom"];
  ok("1. all 42 existing topics are preserved with a category (none renamed or dropped)", EXISTING.every((t) => index.existingTopicCategories[t] && cats.byTitle[t]) && Object.keys(index.existingTopicCategories).length === 42);
  ok("2. new topics have unique slugs that follow their titles", new Set(topics.map((t) => t.slug)).size === topics.length && topics.every((t) => t.slug === L.slugify(t.title)));
  ok("3. no new topic duplicates an existing one (case-insensitive)", !topics.some((t) => EXISTING.some((e) => e.toLowerCase() === t.title.toLowerCase())) && new Set(topics.map((t) => t.title.toLowerCase())).size === topics.length);
  ok("3. additions only for real existing topics", additions.every((a) => EXISTING.includes(a.title)));
  ok("every new topic is in one of the 9 categories", topics.every((t) => index.categories.some((c) => c.key === t.category)) && index.categories.length === 9);
  const all = [...topics, ...additions].flatMap((t) => t.passages.map((raw) => ({ topic: t.title, p: L.parsePassage(raw) })));
  const bad = all.filter((x) => !x.p.ok);
  ok("4. every passage parses: known book, chapter in range, ordered verses, title and kind", !bad.length, bad.slice(0, 3).map((x) => x.p.reason).join("; "));
  const outOfRange = all.filter((x) => x.p.ok && !(counts[`${x.p.code} ${x.p.chapter}`] >= x.p.endVerse));
  ok("5–6. every verse range exists in the Bible text (checked offline against the recorded verse numbers)", !outOfRange.length && all.length > 1000, outOfRange.slice(0, 3).map((x) => x.p.display).join(", "));
  ok("6. the parser rejects invented or impossible references", !L.parsePassage("Hezekiah 1:1 | x | teaching").ok && !L.parsePassage("Jude 2:1 | x | teaching").ok && !L.parsePassage("John 3:16-10 | x | teaching").ok && !L.parsePassage("John 3:16 | x | sermon").ok);
  const perTopicDup = [...topics, ...additions].filter((t) => { const k = t.passages.map((r) => L.parsePassage(r).key); return new Set(k).size !== k.length; });
  ok("8. no passage is listed twice in the same topic", !perTopicDup.length, perTopicDup.map((t) => t.title).join());
  const keys = new Map(); for (const x of all) keys.set(x.p.key, (keys.get(x.p.key) ?? 0) + 1);
  ok("8. shared passages: one reference identity for several topics", [...keys.values()].some((n) => n > 1) && keys.size < all.length);
  ok("new topics have 10–15 passages each", topics.every((t) => t.passages.length >= 10 && t.passages.length <= 15), topics.filter((t) => t.passages.length < 10).map((t) => t.title).join());
  ok("Old and New Testament both represented", all.some((x) => x.p.code === "GEN") && all.some((x) => x.p.code === "REV"));
  const report = JSON.parse(readFileSync(path.join(dataDir, "validation-report.json"), "utf8"));
  ok("the latest online validation found every reference valid", report.failed.length === 0 && report.valid === report.references && report.references === all.length, JSON.stringify({ v: report.valid, n: report.references, all: all.length }));
  const sql = readFileSync(path.join(root, "..", "..", "migrations", "248_scripture_topics_expansion.sql"), "utf8");
  // Applied 2026-11-14 (owner approval) as migrations/248: still additive — new topics draft, new passages needs_review.
ok("migration 248 (applied 2026-11-14): new topics draft and passages needs_review", sql.startsWith("-- APPLIED TO PRODUCTION") && sql.includes("'draft'") && sql.includes("'needs_review'") && readdirSync(path.join(root, "..", "..", "migrations")).filter((f) => f.startsWith("248_")).length === 1);
  ok("the proposal appends after existing passages (Pray the Word positions never move)", sql.includes("'supporting',") && sql.includes("max(x.display_order)"));

  // ── Routes ──
  const T = {
    p2p_prayer_topics: [
      { id: "t1", slug: "peace", title: "Peace", status: "published", display_order: 1 },
      { id: "t2", slug: "prayer", title: "Prayer", status: "draft", display_order: 50, category: "spiritual_life" },
      { id: "t3", slug: "fear-anxiety", title: "Fear & Anxiety", status: "published", display_order: 2, category: null },
    ],
    p2p_topic_scriptures: [
      { id: "l1", topic_id: "t1", role: "core", display_order: 1, editorial_note: null, scripture: { id: "s1", book: "John", chapter: 14, start_verse: 25, end_verse: 27, reference_display: "John 14:25-27" } },
      { id: "l2", topic_id: "t1", role: "supporting", display_order: 2, editorial_note: null, editorial_status: "published", scripture: { id: "s2", book: "Psalms", chapter: 4, start_verse: 1, end_verse: 8, reference_display: "Psalm 4:1-8" } },
      { id: "l3", topic_id: "t1", role: "supporting", display_order: 3, editorial_note: null, editorial_status: "needs_review", editorial_title: "Hidden", scripture: { id: "s3", book: "Isaiah", chapter: 26, start_verse: 1, end_verse: 4, reference_display: "Isaiah 26:1-4" } },
      { id: "l4", topic_id: "t1", role: "supporting", display_order: 4, editorial_note: null, editorial_status: "approved", editorial_title: "Let the peace of Christ rule", passage_kind: "teaching", scripture: { id: "s4", book: "Colossians", chapter: 3, start_verse: 12, end_verse: 15, reference_display: "Colossians 3:12-15" } },
      { id: "l5", topic_id: "t3", role: "core", display_order: 1, editorial_note: null, editorial_status: "draft", scripture: { id: "s5", book: "Philippians", chapter: 4, start_verse: 6, end_verse: 7, reference_display: "Philippians 4:6-7" } },
    ],
    p2p_prayer_topic_progress: [],
  };
  const db = {
    from(name) {
      const f = []; let head = false; let up = null;
      const rows = () => (T[name] ?? []).filter((x) => f.every((p) => p(x)));
      const q = {
        select(c, o) { head = !!o?.head; return q; }, order() { return q; }, limit() { return q; },
        eq(c, v) { f.push((r) => r[c] === v); return q; }, in(c, vs) { f.push((r) => vs.includes(r[c])); return q; },
        upsert(v) { up = { id: "p1", ...v }; T.p2p_prayer_topic_progress = [up]; return q; },
        async maybeSingle() { return { data: rows()[0] ?? null, error: null }; },
        async single() { return { data: up ?? rows()[0] ?? null, error: null }; },
        then(res) { return Promise.resolve(head ? { count: rows().length, error: null } : { data: rows(), error: null }).then(res); },
      };
      return q;
    },
  };
  globalThis.__st = db;
  const mockPlugin = { name: "mocks", setup(b) {
    b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: "supabase", namespace: "mock" }));
    b.onResolve({ filter: /adminAuth$|recycleBin$|bibleService$/ }, (a) => ({ path: a.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: a.path === "supabase" ? "export const supabaseServiceRole = globalThis.__st; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;"
      : "export const requireAdmin = (q, s, n) => n(); export const moveToBin = async () => {}; export const sendRecycleError = () => {}; export const getTranslationByCode = async () => null;" }));
  } };
  const out = await build({ entryPoints: [path.join(root, "src/routes/prayerTopics.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  writeFileSync(path.join(tmpDir, "routes.mjs"), out.outputFiles[0].text);
  const app = express(); app.use(express.json()); app.use("/prayer", (await import(pathToFileURL(path.join(tmpDir, "routes.mjs")).href)).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/prayer`;
  const call = (p, init = {}) => fetch(base + p, { ...init, headers: { "content-type": "application/json", "x-test-user": "u1", ...(init.headers ?? {}) } });

  const list = await (await call("/topics")).json();
  ok("9. topic list: published topics only (a draft topic stays hidden)", list.map((t) => t.slug).join() === "peace,fear-anxiety");
  ok("9. counts show only visible passages (published + approved + older rows)", list.find((t) => t.slug === "peace").scriptureCount === 3 && list.find((t) => t.slug === "fear-anxiety").scriptureCount === 0);
  ok("categories: from the editorial collection when the topic has none", list.find((t) => t.slug === "peace").category === "spiritual_life" && list.find((t) => t.slug === "fear-anxiety").category === "difficult_seasons");
  const detail = await (await call("/topics/peace")).json();
  ok("9. topic detail: needs_review / draft passages are not shown", detail.scriptures.map((s) => s.id).join() === "s1,s2,s4", detail.scriptures.map((s) => s.id).join());
  ok("editorial title and kind travel with approved passages; older rows unchanged", detail.scriptures.find((s) => s.id === "s4").editorialTitle === "Let the peace of Christ rule" && detail.scriptures.find((s) => s.id === "s4").passageKind === "teaching" && !("editorialTitle" in detail.scriptures.find((s) => s.id === "s1")));
  ok("14. existing fields unchanged (reference, role, order)", detail.scriptures[0].referenceDisplay === "John 14:25-27" && detail.scriptures[0].role === "core" && detail.scriptures[0].displayOrder === 1);
  // Pray the Word: the 3rd VISIBLE passage completes the topic (a hidden one is never counted).
  for (const n of [1, 2]) await call(`/topics/t1/progress`, { method: "PUT", body: JSON.stringify({ completedScriptureOrder: n }) });
  const prog = await (await call(`/topics/t1/progress`, { method: "PUT", body: JSON.stringify({ completedScriptureOrder: 3 }) })).json();
  ok("Pray the Word progress counts visible passages only (3 of 3 = completed)", prog.status === "completed", JSON.stringify(prog));
  ok("signed out → 401", (await fetch(base + "/topics")).status === 401);
  server.close();
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`scriptureTopics (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
