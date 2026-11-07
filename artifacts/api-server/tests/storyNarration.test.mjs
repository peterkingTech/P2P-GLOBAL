// Kingdom Stories narration route (routes/kingdomStories.ts GET /:id/chapters/:chapterId/narration and
// lib/storyNarration.ts) over HTTP with a faked database:
//   • signed out → 401; an unpublished story → 404 for readers, served to editors;
//   • a locked chapter → { narration: null } (the database's chapter-open rule decides);
//   • an open chapter → its recording's link and word timings, from the local folder in development;
//   • no recording → { narration: null }; a manifest for another chapter is never served.
// Run: node tests/storyNarration.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = path.join(root, "tests", `.tmp-narration-${process.pid}`);
mkdirSync(tmp, { recursive: true });

const S = "11111111-1111-4111-8111-111111111111", DRAFT = "22222222-2222-4222-8222-222222222222";
const OPEN = "33333333-3333-4333-8333-333333333333", LOCKED = "44444444-4444-4444-8444-444444444444", NONE = "55555555-5555-4555-8555-555555555555";
const T = {
  p2p_kingdom_stories: [{ id: S, status: "published" }, { id: DRAFT, status: "draft" }],
  p2p_profiles: [{ id: "ED", role: "admin_content" }, { id: "READER", role: "student" }],
  p2p_kingdom_story_chapters: [{ id: OPEN, story_id: S, lesson_id: "L1" }, { id: LOCKED, story_id: S, lesson_id: "L2" }, { id: NONE, story_id: S, lesson_id: "L3" }, { id: OPEN, story_id: DRAFT, lesson_id: "L9" }],
};
globalThis.__n = {
  db: {
    from(table) {
      const f = [];
      const c = { select: () => c, eq: (k, v) => { f.push([k, v]); return c; }, in: () => c, order: () => c, limit: () => c,
        maybeSingle: async () => ({ data: (T[table] ?? []).find((r) => f.every(([k, v]) => r[k] === v)) ?? null }) };
      return c;
    },
    rpc: async (fn, a) => ({ data: fn === "p2p_kingdom_story_chapter_open" ? a.p_lesson_id !== "L2" : null }),
    storage: { from: () => ({ download: async () => ({ data: null }), createSignedUrl: async () => ({ data: null }) }) },
  },
};
const mocks = {
  supabase: "export const supabaseServiceRole = globalThis.__n.db; export const supabase = globalThis.__n.db; export const supabaseAsUser = () => globalThis.__n.db; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;",
};
const plugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)supabase$/ }, (a) => ({ path: "supabase", namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: mocks[a.path] }));
} };

// A local narration folder, as the generator writes it.
const dir = path.join(tmp, "out");
mkdirSync(path.join(dir, S), { recursive: true });
const manifest = (chapterId) => ({ version: 1, storyId: S, chapterId, voice: { id: "v", name: "Jon" }, model: "eleven_v4", file: `${chapterId}.mp3`, createdAt: "2026-11-07", words: "in the beginning", starts: [0, 30, 60], ends: [20, 50, 90] });
writeFileSync(path.join(dir, S, `${OPEN}.json`), JSON.stringify(manifest(OPEN)));
writeFileSync(path.join(dir, S, `${LOCKED}.json`), JSON.stringify(manifest(LOCKED)));
// German, in its own language folder (and a mislabelled file that must never be served as German).
mkdirSync(path.join(dir, S, "de"), { recursive: true });
writeFileSync(path.join(dir, S, "de", `${OPEN}.json`), JSON.stringify({ ...manifest(OPEN), version: 2, language: "de", voice: { id: "a", name: "Alexander" }, words: "im anfang" , starts: [0, 30], ends: [20, 50] }));
writeFileSync(path.join(dir, S, "de", `${NONE}.json`), JSON.stringify({ ...manifest(NONE), version: 2, language: "en" }));
process.env.NARRATION_LOCAL_DIR = dir;
process.env.NARRATION_LOCAL_BASE_URL = "http://127.0.0.1:8796/";

let server;
try {
  const out = await build({ entryPoints: [path.join(root, "src/routes/kingdomStories.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [plugin], external: ["express"] });
  const file = path.join(tmp, "route.mjs");
  writeFileSync(file, out.outputFiles[0].text);
  const { default: router } = await import(pathToFileURL(file).href);
  const express = createRequire(path.join(root, "package.json"))("express");
  const app = express(); app.use("/k", router);
  server = app.listen(0); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/k`;
  const get = async (p, user) => { const r = await fetch(base + p, { headers: user ? { "x-test-user": user } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; };

  ok("signed out → 401", (await get(`/${S}/chapters/${OPEN}/narration`)).status === 401);
  const open = await get(`/${S}/chapters/${OPEN}/narration`, "READER");
  ok("an open chapter → its recording link and word timings", open.status === 200 && open.body.narration?.url === `http://127.0.0.1:8796/${S}/${OPEN}.mp3` && open.body.narration.voice === "Jon" && open.body.narration.starts.length === 3);
  ok("a locked chapter → no narration (the database's rule)", (await get(`/${S}/chapters/${LOCKED}/narration`, "READER")).body?.narration === null);
  ok("an editor hears a locked chapter's narration", (await get(`/${S}/chapters/${LOCKED}/narration`, "ED")).body?.narration?.url.endsWith(`${LOCKED}.mp3`));
  ok("a chapter without a recording → no narration", (await get(`/${S}/chapters/${NONE}/narration`, "READER")).body?.narration === null);
  ok("an unpublished story → 404 for readers", (await get(`/${DRAFT}/chapters/${OPEN}/narration`, "READER")).status === 404);
  ok("a chapter of another story → 404", (await get(`/${S}/chapters/66666666-6666-4666-8666-666666666666/narration`, "READER")).status === 404);
  ok("not an id → 404", (await get(`/${S}/chapters/abc/narration`, "READER")).status === 404);
  const de = await get(`/${S}/chapters/${OPEN}/narration?lang=de`, "READER");
  ok("German (?lang=de): the German narrator's recording from the language folder", de.body?.narration?.voice === "Alexander" && de.body.narration.url === `http://127.0.0.1:8796/${S}/de/${OPEN}.mp3`);
  ok("German: a chapter without German → no narration (never English instead, never a mislabelled file)", (await get(`/${S}/chapters/${NONE}/narration?lang=de`, "READER")).body?.narration === null
    && (await get(`/${S}/chapters/${LOCKED}/narration?lang=de`, "READER")).body?.narration === null);
  ok("English still served from the first upload's place", (await get(`/${S}/chapters/${OPEN}/narration?lang=en`, "READER")).body?.narration?.voice === "Jon");
  ok("German: a locked chapter stays locked", (await get(`/${S}/chapters/${LOCKED}/narration?lang=de`, "READER")).body?.narration === null);
  ok("a nonsense language → no narration", (await get(`/${S}/chapters/${OPEN}/narration?lang=../x`, "READER")).body?.narration === null);
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`storyNarration: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
