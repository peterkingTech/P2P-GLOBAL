// Scripture Listening Library (migration 227) — routes/scriptureLibrary.ts and
// the 227 additions to routes/scriptureCollections.ts, run for real over HTTP
// against an in-memory database, plus the pure rules in lib/scriptureLibrary.ts:
//   • one passage saved / favourited / added to several playlists is never
//     stored twice; duplicates in a playlist are refused unless asked for;
//   • personal title, tags and memorisation on Saved Scriptures (old saved
//     passages keep working);
//   • favourites for passages, playlists and collections — removing one never
//     deletes the passage or playlist; a revoked share drops out;
//   • listening history (one row per passage, reused while still listening),
//     completion, clearing;
//   • resume state per person, checked against the playlist's real items;
//   • ownership: nobody reads or changes anyone else's library;
//   • private notes / highlights are never read.
// Synthetic ids only; no network beyond localhost, no database.
// Run: node tests/scriptureLibrary.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmpDir = path.join(root, "tests", `.tmp-library-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });

const mocks = {
  supabase: "export const supabaseServiceRole = globalThis.__sc.db; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;",
  bibleReader: `const BOOKS = { JHN: { code: 'JHN', name: 'John', chapters: 21 }, PSA: { code: 'PSA', name: 'Psalms', chapters: 150 }, GEN: { code: 'GEN', name: 'Genesis', chapters: 50 } };
    export const bookByCode = (c) => BOOKS[String(c || '').toUpperCase()];
    export const licensedTranslations = async () => [{ translation_code: 'BSB' }];
    export const getChapter = async (b, ch, t) => ({ translation: { code: t, name: 'Berean Standard Bible', textCopyAllowed: true }, book: BOOKS[b], chapter: ch,
      verses: Array.from({ length: 40 }, (_, i) => ({ verse: i + 1, text: 'Verse text ' + (i + 1), paragraph: 0, poetry: false })), headings: [], copyright: 'BSB ©', previous: null, next: null });`,
  minors: "export const childUserIds = async (ids) => new Set(ids.filter((i) => globalThis.__sc.children.has(i)));",
  studyPartnerAuth: "export const getEligibleStudyPartners = async (_db, u) => new Map((globalThis.__sc.partners[u] || []).map((p) => [p, 'connection']));",
  groupLearning: "export const canManageGroupLearning = async (t, g, u) => globalThis.__sc.leaders.has(t + ':' + g + ':' + u); export const isGroupMember = async () => false;",
  pushDispatch: "export const dispatchNotificationNow = async () => {};",
};
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)(supabase|bibleReader|minors|studyPartnerAuth|groupLearning|pushDispatch)$/ }, (a) => ({ path: a.path.split("/").pop(), namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: mocks[a.path] }));
} };
const bundle = async (entry, name) => {
  const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const f = path.join(tmpDir, name); writeFileSync(f, out.outputFiles[0].text); return import(pathToFileURL(f).href);
};

// ── In-memory database ─────────────────────────────────────────────────────
const T = {};
const now = () => new Date().toISOString();
const DEFAULTS = {
  p2p_scripture_collections: () => ({ kind: "collection", description: null, origin_collection_id: null, origin_owner_id: null, copied_at: null, revision: 1, created_at: now(), updated_at: now(), deleted_at: null }),
  p2p_scripture_collection_items: () => ({ position: 0, shared_note: null, added_by: null, created_at: now() }),
  p2p_scripture_collection_shares: () => ({ target_id: null, user_id: null, can_reshare: false, shared_by: null, via_link_id: null, status: "active", created_at: now(), revoked_at: null, revoked_by: null }),
  p2p_scripture_collection_links: () => ({ max_uses: null, uses: 0, expires_at: null, created_at: now(), revoked_at: null }),
  p2p_scripture_collection_activity: () => ({ detail: {}, created_at: now() }),
  p2p_bible_bookmarks: () => ({ title: null, tags: [], memorisation_status: null, created_at: now(), updated_at: now() }),
  p2p_scripture_favourites: () => ({ collection_id: null, translation_code: null, book_code: null, chapter: null, start_verse: null, end_verse: null, created_at: now() }),
  p2p_scripture_listening_history: () => ({ collection_id: null, item_id: null, source: "library", started_at: now(), completed_at: null, listened_seconds: null }),
  p2p_scripture_listening_state: () => ({ item_id: null, part_key: null, part_offset: 0, queue: [], shuffle: false, repeat_mode: "off", rate: 1, updated_at: now() }),
};
const reads = [];
function makeDb() {
  return { from(table) {
    reads.push(table);
    const q = { op: "select", f: [], payload: null, single: false, lim: null, orders: [] };
    const rows = () => (T[table] ??= []);
    const match = (r) => q.f.every(([op, k, v]) => op === "eq" ? r[k] === v : op === "is" ? (r[k] ?? null) === v : op === "in" ? v.includes(r[k]) : true);
    const exec = () => {
      let data;
      if (q.op === "insert") {
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p) => ({ id: randomUUID(), ...(DEFAULTS[table]?.() ?? {}), ...p }));
        rows().push(...list); data = list;
      } else if (q.op === "update") { const hit = rows().filter(match); hit.forEach((r) => Object.assign(r, q.payload)); data = hit; }
      else if (q.op === "delete") { const hit = rows().filter(match); T[table] = rows().filter((r) => !hit.includes(r)); data = hit; }
      else {
        data = rows().filter(match);
        for (const [k, asc] of [...q.orders].reverse()) data = [...data].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
        if (q.lim) data = data.slice(0, q.lim);
      }
      data = data.map((r) => ({ ...r }));
      return { data: q.single ? data[0] ?? null : data, error: null };
    };
    const c = {
      select() { return c; }, insert(p) { q.op = "insert"; q.payload = p; return c; }, update(p) { q.op = "update"; q.payload = p; return c; }, delete() { q.op = "delete"; return c; },
      eq(k, v) { q.f.push(["eq", k, v]); return c; }, is(k, v) { q.f.push(["is", k, v]); return c; }, in(k, v) { q.f.push(["in", k, v]); return c; },
      order(k, o) { q.orders.push([k, o?.ascending !== false]); return c; }, limit(n) { q.lim = n; return c; },
      maybeSingle() { q.single = true; return c; }, single() { q.single = true; return c; },
      then(res, rej) { try { res(exec()); } catch (e) { rej(e); } },
    };
    return c;
  } };
}
globalThis.__sc = { db: makeDb(), children: new Set(), partners: {}, leaders: new Set() };
// In-memory private storage bucket (migration 228 photos): objects by path → size.
const objects = new Map();
globalThis.__sc.db.storage = { from: (bucket) => ({
  createSignedUploadUrl: async (p) => ({ data: { signedUrl: `https://upload.invalid/${bucket}/${p}` }, error: null }),
  list: async (dir, o) => ({ data: [...objects.keys()].filter((k) => k.startsWith(`${dir}/`) && k.slice(dir.length + 1).includes(o?.search ?? "")).map((k) => ({ name: k.slice(dir.length + 1), metadata: { size: objects.get(k) } })), error: null }),
  remove: async (paths) => { for (const p of paths) objects.delete(p); return { data: [], error: null }; },
  createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: objects.has(p) ? `https://signed.invalid/${p}?ttl` : null })), error: null }),
}) };

// People: A owner · B, G peers of A/B · C stranger · D and E in A's Family · K a child.
const [A, B, C, D, E, G, K] = Array.from({ length: 7 }, () => randomUUID());
const FAM = randomUUID();
T.p2p_profiles = [[A, "Ann Owner"], [B, "Ben Peer"], [C, "Cal Stranger"], [D, "Dee Family"], [E, "Eve Family"], [G, "Gus Peer"], [K, "Kid Child"]].map(([id, full_name]) => ({ id, full_name, photo_url: null }));
T.p2p_family_members = [A, D, E].map((user_id) => ({ family_id: FAM, user_id, status: "active" }));
T.p2p_families = [{ id: FAM, name: "The Owners" }];
globalThis.__sc.partners = { [A]: [B, G], [B]: [A, G], [G]: [A, B] };
globalThis.__sc.children.add(K);

let server, base;
const call = async (method, p, user, body) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, body: json };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ref = (book, chapter, sv, ev = sv) => ({ translationCode: "BSB", bookCode: book, chapter, startVerse: sv, endVerse: ev });

try {
  // ── Pure rules ───────────────────────────────────────────────────────────
  const L = await bundle("src/lib/scriptureLibrary.ts", "rules.mjs");
  ok("rules: tags trimmed, de-duplicated (any case), max 20 of 30 chars", JSON.stringify(L.cleanTags(["  Faith ", "faith", "Hope  and   love", "", 3])) === JSON.stringify(["Faith", "Hope and love"])
    && L.cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length === 20 && L.cleanTags(["x".repeat(50)])[0].length === 30 && L.cleanTags("faith") === null);
  ok("rules: personal title trimmed; empty clears", L.cleanTitle("  My   verse ") === "My verse" && L.cleanTitle("   ") === null && L.cleanTitle(null) === null && L.cleanTitle("x".repeat(200)).length === 120);
  ok("rules: memorisation statuses", L.memorisation("practising") === "practising" && L.memorisation(null) === null && L.memorisation("done") === undefined);
  const U = randomUUID();
  ok("rules: covers — built-in artwork / theme colour by NAME; never a raw colour", L.cleanCover({ kind: "artwork", ref: "dawn-hills" }, U).ref === "dawn-hills" && L.cleanCover({ kind: "colour", ref: "accent-green" }, U).kind === "colour"
    && typeof L.cleanCover({ kind: "colour", ref: "#ff0000" }, U) === "string" && typeof L.cleanCover({ kind: "logo", ref: "x" }, U) === "string" && L.cleanCover(null, U) === null);
  ok("rules: an uploaded cover must be in the owner's own folder", L.cleanCover({ kind: "image", ref: `${U}/cover.jpg` }, U).kind === "image"
    && typeof L.cleanCover({ kind: "image", ref: `${randomUUID()}/cover.jpg` }, U) === "string" && typeof L.cleanCover({ kind: "image", ref: `${U}/../x.jpg` }, U) === "string");
  const r1 = { translation_code: "BSB", book_code: "JHN", chapter: 3, start_verse: 16, end_verse: 16 }, r2 = { ...r1, end_verse: 17 };
  const plan = L.planAdd([r1], [r1, r2, r2], false);
  ok("rules: duplicates skipped (already there, or twice in one request)", plan.add.length === 1 && plan.add[0] === r2 && plan.skipped.length === 2);
  ok("rules: an explicit repeat is allowed", L.planAdd([r1], [r1], true).add.length === 1);
  const t0 = Date.parse("2026-11-03T10:00:00Z");
  ok("rules: history row reused only while open and recent", L.reuseHistoryRow({ started_at: new Date(t0).toISOString(), completed_at: null }, t0 + 60_000)
    && !L.reuseHistoryRow({ started_at: new Date(t0).toISOString(), completed_at: null }, t0 + L.HISTORY_REUSE_MS + 1)
    && !L.reuseHistoryRow({ started_at: new Date(t0).toISOString(), completed_at: new Date(t0).toISOString() }, t0 + 1000) && !L.reuseHistoryRow(null));
  ok("rules: listened seconds never exceed the time that actually passed", L.listenedSeconds(9999, new Date(t0).toISOString(), t0 + 120_000) === 120 && L.listenedSeconds(30.7, new Date(t0).toISOString(), t0 + 120_000) === 30 && L.listenedSeconds(-1, new Date(t0).toISOString(), t0) === null);
  const [i1, i2, i3] = [randomUUID(), randomUUID(), randomUUID()];
  const rs = L.cleanResume({ itemId: i2, partKey: "p", offset: 12, queue: [i3, "nope", i1, i1, i2], shuffle: true, repeat: "all", rate: 1.25 }, [i1, i2, i3]);
  ok("rules: resume keeps only the playlist's own items (each once), shuffle/repeat/rate", rs.itemId === i2 && JSON.stringify(rs.queue) === JSON.stringify([i3, i1, i2]) && rs.shuffle && rs.repeat === "all" && rs.rate === 1.25);
  const rd = L.cleanResume({ itemId: "zzz", repeat: "forever", rate: 3, offset: -5 }, [i1]);
  ok("rules: bad resume values fall back safely", rd.itemId === null && rd.repeat === "off" && rd.rate === 1 && rd.offset === 0 && rd.shuffle === false);
  ok("rules: a playlist that repeats a passage may queue it twice", L.cleanResume({ queue: [i1, i1] }, [i1, i1]).queue.length === 2);
  ok("rules: an oversized queue is refused", typeof L.cleanResume({ queue: Array(201).fill(i1) }, [i1]) === "string");

  // ── The routes over HTTP ─────────────────────────────────────────────────
  const express = createRequire(path.join(root, "package.json"))("express");
  const { default: coll } = await bundle("src/routes/scriptureCollections.ts", "coll.mjs");
  const { default: lib } = await bundle("src/routes/scriptureLibrary.ts", "lib.mjs");
  const app = express(); app.use(express.json()); app.use("/c", coll); app.use("/l", lib);
  server = app.listen(0); await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  ok("signed out → 401", (await call("GET", "/l/saved")).status === 401 && (await call("POST", "/l/save", null, { ref: ref("JHN", 3, 16) })).status === 401);

  // An old saved passage (before 227: no title / tags / memorisation filled in).
  T.p2p_bible_bookmarks = [{ id: randomUUID(), user_id: A, translation_code: "BSB", book_code: "PSA", chapter: 23, start_verse: 1, end_verse: 6, created_at: "2026-10-01T00:00:00Z" }];
  const old = await call("GET", "/l/saved", A);
  ok("existing saved passages still listed (empty personal fields)", old.status === 200 && old.body.items.length === 1 && old.body.items[0].reference === "Psalms 23:1–6" && old.body.items[0].title == null && Array.isArray(old.body.items[0].tags) && old.body.items[0].tags.length === 0);

  const pl = (await call("POST", "/c", A, { kind: "playlist", title: "Morning with God" })).body.id;
  const co = (await call("POST", "/c", A, { title: "Promises of God" })).body.id;
  const saved = await call("POST", "/l/save", A, { ref: ref("JHN", 3, 16), favourite: true, collectionIds: [pl, co] });
  ok("save to several places at once", saved.status === 200 && saved.body.saved && saved.body.favourite && saved.body.collections.every((x) => x.status === "added") && saved.body.reference === "John 3:16", JSON.stringify(saved.body));
  const again = await call("POST", "/l/save", A, { ref: ref("JHN", 3, 16), favourite: true, collectionIds: [pl, co] });
  ok("saving again stores nothing twice (same saved row, same favourite, 'already' in each playlist)",
    again.body.saved === saved.body.saved && again.body.favourite === saved.body.favourite && again.body.collections.every((x) => x.status === "already")
    && T.p2p_bible_bookmarks.filter((b) => b.user_id === A && b.book_code === "JHN").length === 1 && T.p2p_scripture_favourites.length === 1
    && T.p2p_scripture_collection_items.filter((i) => i.collection_id === pl).length === 1 && T.p2p_scripture_collection_items.filter((i) => i.collection_id === co).length === 1);
  ok("one Scripture in two playlists = the same reference, no Scripture copies", T.p2p_scripture_collection_items.filter((i) => i.book_code === "JHN" && i.chapter === 3).length === 2 && T.p2p_bible_bookmarks.length === 2);
  const dup = await call("POST", `/c/${pl}/items`, A, { refs: [ref("JHN", 3, 16)] });
  ok("adding a passage already in the playlist is skipped", dup.status === 200 && dup.body.added === 0 && dup.body.skipped === 1);
  const rep = await call("POST", `/c/${pl}/items`, A, { refs: [ref("JHN", 3, 16)], allowRepeat: true });
  ok("…unless the person chooses to add a repeat", rep.body.added === 1 && T.p2p_scripture_collection_items.filter((i) => i.collection_id === pl).length === 2);
  const cSave = await call("POST", "/l/save", C, { ref: ref("GEN", 1, 1), collectionIds: [pl] });
  ok("save: a playlist I can't edit fails on its own without undoing the rest", cSave.status === 200 && !!cSave.body.saved && cSave.body.collections[0].status === "failed");
  ok("save: a bad passage is refused", (await call("POST", "/l/save", A, { ref: ref("JHN", 99, 1) })).status === 400);
  ok("save into a playlist without keeping it in Saved", (await call("POST", "/l/save", A, { ref: ref("JHN", 1, 1), saved: false, collectionIds: [pl] })).body.saved === null
    && !T.p2p_bible_bookmarks.some((b) => b.user_id === A && b.book_code === "JHN" && b.chapter === 1));

  // Personal details on a saved passage.
  const sid = saved.body.saved;
  const patched = await call("PATCH", `/l/saved/${sid}`, A, { title: " For God so loved ", tags: ["Love", "love", "Faith"], memorisation: "to_learn" });
  ok("title, tags and memorisation saved on the passage", patched.status === 200 && patched.body.title === "For God so loved" && JSON.stringify(patched.body.tags) === '["Love","Faith"]' && patched.body.memorisation === "to_learn");
  ok("bad memorisation refused", (await call("PATCH", `/l/saved/${sid}`, A, { memorisation: "done" })).status === 400);
  ok("nobody else can change my saved passage", (await call("PATCH", `/l/saved/${sid}`, B, { title: "mine now" })).status === 404 && T.p2p_bible_bookmarks.find((b) => b.id === sid).title === "For God so loved");
  const byTag = await call("GET", "/l/saved?tag=love", A), byQ = await call("GET", "/l/saved?q=psalms", A), favOnly = await call("GET", "/l/saved?favourites=1", A);
  ok("saved: filter by tag / search by reference / favourites only", byTag.body.items.length === 1 && byTag.body.items[0].id === sid && byQ.body.items.length === 1 && favOnly.body.items.length === 1 && favOnly.body.items[0].favourite === true
    && JSON.stringify(byTag.body.tags) === '["Faith","Love"]');
  ok("saved: my library is mine alone", (await call("GET", "/l/saved", B)).body.items.length === 0);

  // Favourites.
  const favPl = await call("PUT", "/l/favourites", A, { collectionId: pl });
  ok("favourite a playlist (idempotent)", favPl.status === 200 && (await call("PUT", "/l/favourites", A, { collectionId: pl })).body.id === favPl.body.id);
  ok("can't favourite a playlist I can't see", (await call("PUT", "/l/favourites", B, { collectionId: pl })).status === 404);
  await call("POST", `/c/${pl}/shares`, A, { targets: [{ type: "peer", id: B }], permission: "view" });
  ok("a recipient can favourite a shared playlist", (await call("PUT", "/l/favourites", B, { collectionId: pl })).status === 200);
  const favs = await call("GET", "/l/favourites", A);
  ok("favourites list: passages + playlists + collections", favs.body.passages.length === 1 && favs.body.playlists.length === 1 && favs.body.playlists[0].title === "Morning with God" && favs.body.collections.length === 0);
  const shareId = T.p2p_scripture_collection_shares.find((s) => s.user_id === B).id;
  await call("DELETE", `/c/${pl}/shares/${shareId}`, A);
  ok("a revoked share drops out of the recipient's favourites at once", (await call("GET", "/l/favourites", B)).body.playlists.length === 0);
  ok("removing a favourite keeps the passage and the playlist", (await call("DELETE", `/l/favourites/${favPl.body.id}`, A)).status === 200
    && T.p2p_scripture_collections.some((c) => c.id === pl && !c.deleted_at) && (await call("GET", "/l/favourites", A)).body.playlists.length === 0 && (await call("GET", "/l/saved", A)).body.items.length === 2);
  ok("can't remove someone else's favourite", (await call("DELETE", `/l/favourites/${saved.body.favourite}`, B)).status === 404);

  // Listening history.
  const h1 = await call("POST", "/l/history", A, { ref: ref("JHN", 3, 16), collectionId: pl, source: "playlist" });
  const h2 = await call("POST", "/l/history", A, { ref: ref("JHN", 3, 16), collectionId: pl, source: "playlist" });
  ok("history: one row per passage — a quick restart continues it", h1.status === 200 && h2.body.id === h1.body.id && h2.body.reused === true && T.p2p_scripture_listening_history.length === 1);
  ok("history: someone else can't complete my row", (await call("POST", `/l/history/${h1.body.id}/complete`, B, { listenedSeconds: 5 })).status === 404);
  await call("POST", `/l/history/${h1.body.id}/complete`, A, { listenedSeconds: 99999 });
  const hrow = T.p2p_scripture_listening_history[0];
  ok("history: completion recorded; seconds capped at real time", !!hrow.completed_at && hrow.listened_seconds <= 2);
  ok("history: after completion a new listen is a new row", (await call("POST", "/l/history", A, { ref: ref("JHN", 3, 16), collectionId: pl })).body.reused === false && T.p2p_scripture_listening_history.length === 2);
  ok("history: a playlist I can't see is refused", (await call("POST", "/l/history", B, { ref: ref("JHN", 3, 16), collectionId: pl })).status === 404);
  const hist = await call("GET", "/l/history", A);
  ok("history list names the playlist", hist.body.items.length === 2 && hist.body.items.every((x) => x.collection?.title === "Morning with God") && hist.body.items[0].reference === "John 3:16");
  ok("history is private", (await call("GET", "/l/history", B)).body.items.length === 0);

  // Resume.
  const items = (await call("GET", `/c/${pl}`, A)).body.items;
  const st = await call("PUT", `/l/state/${pl}`, A, { itemId: items[1].id, partKey: `${items[1].id}:16`, offset: 4, queue: [items[2].id, items[0].id, "x", items[1].id], shuffle: true, repeat: "all", rate: 1.5 });
  const got = await call("GET", `/l/state/${pl}`, A);
  ok("resume: saved and read back (unknown queue ids dropped)", st.status === 200 && got.body.state.itemId === items[1].id && got.body.state.queue.length === 3 && got.body.state.shuffle && got.body.state.repeat === "all" && got.body.state.rate === 1.5, JSON.stringify(got.body));
  const order0 = T.p2p_scripture_collection_items.filter((i) => i.collection_id === pl).map((i) => `${i.id}:${i.position}`).join();
  await call("PUT", `/l/state/${pl}`, A, { itemId: items[0].id });
  ok("resume: one row per person per playlist (updated in place)", T.p2p_scripture_listening_state.length === 1 && T.p2p_scripture_listening_state[0].item_id === items[0].id);
  ok("resume: a shuffled queue never changes the saved playlist order", order0 === T.p2p_scripture_collection_items.filter((i) => i.collection_id === pl).map((i) => `${i.id}:${i.position}`).join());
  ok("resume: strangers can't read or write it", (await call("GET", `/l/state/${pl}`, C)).status === 404 && (await call("PUT", `/l/state/${pl}`, C, {})).status === 404);
  const recent = await call("GET", "/l/recent", A);
  ok("recently played lists the playlist with its place", recent.body.items.length === 1 && recent.body.items[0].id === pl && recent.body.items[0].state.itemId === items[0].id);

  // Covers and tags on playlists.
  const rev = (await call("GET", `/c/${pl}`, A)).body.revision;
  ok("playlist cover + tags (owner)", (await call("PATCH", `/c/${pl}`, A, { cover: { kind: "artwork", ref: "dawn-hills" }, tags: ["Morning", "morning", "Prayer"], revision: rev })).status === 200);
  const det = await call("GET", `/c/${pl}`, A);
  ok("…shown on the playlist and in the list", det.body.cover?.ref === "dawn-hills" && JSON.stringify(det.body.tags) === '["Morning","Prayer"]' && (await call("GET", "/c", A)).body.mine.find((m) => m.id === pl).cover.kind === "artwork");
  ok("a raw colour or someone else's image is refused as a cover", (await call("PATCH", `/c/${pl}`, A, { cover: { kind: "colour", ref: "#123456" }, revision: det.body.revision })).status === 400
    && (await call("PATCH", `/c/${pl}`, A, { cover: { kind: "image", ref: `${B}/x.jpg` }, revision: det.body.revision })).status === 400);
  ok("default cover restored with null", (await call("PATCH", `/c/${pl}`, A, { cover: null, revision: det.body.revision })).status === 200 && (await call("GET", `/c/${pl}`, A)).body.cover === null);
  ok("only the owner sets the cover", (await call("PATCH", `/c/${pl}`, C, { cover: null, revision: 99 })).status === 404);

  // Sharing updates (Phase 7): a collaborator's addition tells the owner — once per window, never noisy.
  await call("POST", `/c/${co}/shares`, A, { targets: [{ type: "peer", id: B }], permission: "collaborate" });
  const notes0 = (T.p2p_notifications ?? []).length;
  ok("collaborator adds a passage", (await call("POST", `/c/${co}/items`, B, { refs: [ref("PSA", 23, 1, 6)] })).body.added === 1);
  const upd = (T.p2p_notifications ?? []).slice(notes0).filter((n) => n.notification_type === "scripture_collection_updated");
  ok("…the owner is told who added what (and the collaborator isn't told about their own change)", upd.length === 1 && upd[0].user_id === A && /added Psalms 23:1–6 to "Promises of God"/.test(upd[0].message) && upd[0].data.collectionId === co, JSON.stringify(upd));
  await call("POST", `/c/${co}/items`, B, { refs: [ref("PSA", 23, 6)] });
  ok("…a second change soon after doesn't notify again", (T.p2p_notifications ?? []).slice(notes0).filter((n) => n.notification_type === "scripture_collection_updated").length === 1);
  ok("…and the bookkeeping never shows in the activity history", !(await call("GET", `/c/${co}`, A)).body.activity.some((x) => x.action === "update_notified"));
  ok("a private playlist the owner edits notifies nobody", (await (async () => { const n0 = (T.p2p_notifications ?? []).length; const own = (await call("POST", "/c", A, { title: "Private", kind: "playlist" })).body.id; await call("POST", `/c/${own}/items`, A, { refs: [ref("GEN", 1, 1)] }); return (T.p2p_notifications ?? []).length === n0; })()));

  // Your own photos (migration 228): a square cover and a wide header photo.
  ok("photo rules: images only, up to 8 MB, cover or header", L.photoProblem("cover", "image/jpeg", 1000) === null && typeof L.photoProblem("cover", "image/gif", 1000) === "string"
    && typeof L.photoProblem("cover", "image/png", 9 * 1024 * 1024) === "string" && typeof L.photoProblem("banner", "image/png", 10) === "string");
  const ph = (await call("POST", "/c", A, { kind: "playlist", title: "Photo playlist", refs: [ref("JHN", 3, 16)] })).body.id;
  ok("only the owner can add photos", (await call("POST", `/c/${ph}/photos`, B, { slot: "cover", mimeType: "image/jpeg", sizeBytes: 1000 })).status === 404
    && (await call("POST", `/c/${ph}/photos`, A, { slot: "cover", mimeType: "image/gif", sizeBytes: 1000 })).status === 400);
  const up = await call("POST", `/c/${ph}/photos`, A, { slot: "cover", mimeType: "image/jpeg", sizeBytes: 200_000 });
  ok("owner gets a one-off upload link to a server-chosen path in their own folder", up.status === 200 && up.body.uploadUrl.startsWith("https://upload.invalid/scripture-library-images/") && up.body.path.startsWith(`${A}/cover-${ph}-`) && up.body.path.endsWith(".jpg"));
  ok("completing before the upload arrived is refused", (await call("POST", `/c/${ph}/photos/complete`, A, { slot: "cover", path: up.body.path })).status === 409);
  objects.set(up.body.path, 200_000);
  ok("a path for another playlist or person is refused", (await call("POST", `/c/${ph}/photos/complete`, A, { slot: "cover", path: up.body.path.replace(ph, pl) })).status === 400
    && (await call("POST", `/c/${ph}/photos/complete`, A, { slot: "header", path: up.body.path })).status === 400);
  ok("cover photo set", (await call("POST", `/c/${ph}/photos/complete`, A, { slot: "cover", path: up.body.path })).status === 200);
  const hd = await call("POST", `/c/${ph}/photos`, A, { slot: "header", mimeType: "image/png", sizeBytes: 900_000 });
  objects.set(hd.body.path, 900_000);
  await call("POST", `/c/${ph}/photos/complete`, A, { slot: "header", path: hd.body.path });
  let phd = await call("GET", `/c/${ph}`, A);
  ok("the playlist shows the cover photo and the wide header photo (short-lived links)", phd.body.cover?.kind === "image" && phd.body.cover.url.startsWith("https://signed.invalid/") && phd.body.header?.url.includes(hd.body.path));
  ok("the library list shows the cover photo too", (await call("GET", "/c", A)).body.mine.find((m) => m.id === ph).cover.url.includes(up.body.path));
  ok("a photo can't be set by naming a path in PATCH", (await call("PATCH", `/c/${ph}`, A, { cover: { kind: "image", ref: `${A}/cover-${ph}-x.jpg` }, revision: phd.body.revision })).status === 400);
  ok("stranger: no playlist, no photo links", (await call("GET", `/c/${ph}`, C)).status === 404);
  await call("POST", `/c/${ph}/shares`, A, { targets: [{ type: "peer", id: B }], permission: "view" });
  ok("someone it's shared with sees the photos", (await call("GET", `/c/${ph}`, B)).body.header?.url.includes(hd.body.path));
  const big = await call("POST", `/c/${ph}/photos`, A, { slot: "header", mimeType: "image/png", sizeBytes: 1000 });
  objects.set(big.body.path, 20 * 1024 * 1024);
  ok("an upload bigger than 8 MB is refused and deleted", (await call("POST", `/c/${ph}/photos/complete`, A, { slot: "header", path: big.body.path })).status === 400 && !objects.has(big.body.path));
  phd = await call("GET", `/c/${ph}`, A);
  ok("choosing built-in artwork deletes the old cover photo", (await call("PATCH", `/c/${ph}`, A, { cover: { kind: "artwork", ref: "dawn-hills" }, revision: phd.body.revision })).status === 200 && !objects.has(up.body.path));
  ok("removing the header photo deletes it", (await call("DELETE", `/c/${ph}/photos/header`, A)).status === 200 && !objects.has(hd.body.path) && (await call("GET", `/c/${ph}`, A)).body.header === null);
  const up2 = await call("POST", `/c/${ph}/photos`, A, { slot: "cover", mimeType: "image/webp", sizeBytes: 1000 });
  objects.set(up2.body.path, 1000);
  await call("POST", `/c/${ph}/photos/complete`, A, { slot: "cover", path: up2.body.path });
  await call("DELETE", `/c/${ph}`, A);
  ok("deleting the playlist deletes its photos", !objects.has(up2.body.path));

  // Deleting a playlist: it leaves Recently played and favourites; history stays (unnamed).
  await call("PUT", "/l/favourites", A, { collectionId: pl });
  await call("DELETE", `/c/${pl}`, A);
  ok("a deleted playlist leaves Recently played and favourites", (await call("GET", "/l/recent", A)).body.items.length === 0 && (await call("GET", "/l/favourites", A)).body.playlists.length === 0);
  ok("…its history stays but no longer names it; saved passages untouched", (await call("GET", "/l/history", A)).body.items.every((x) => x.collection === null) && (await call("GET", "/l/saved", A)).body.items.length === 2);
  ok("clear history removes history only", (await call("DELETE", "/l/history", A)).body.cleared === 2 && T.p2p_scripture_listening_history.length === 0
    && T.p2p_scripture_collections.some((c) => c.id === co) && T.p2p_bible_bookmarks.length === 3 && T.p2p_scripture_favourites.length >= 1);

  ok("private notes, highlights and prayers are never read", !reads.some((t) => /p2p_user_notes|p2p_user_highlights|prayer|reflection/.test(t)));
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`scriptureLibrary: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
