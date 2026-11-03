import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { bookByCode } from "../lib/bibleReader";
import { isUuid } from "../lib/sharedStudy";
import { refKey, type ItemRef } from "../lib/scriptureAccess";
import {
  SOURCES, cleanResume, cleanTags, cleanTitle, listenedSeconds, memorisation, reuseHistoryRow,
  type Source,
} from "../lib/scriptureLibrary";
import { CollError, access, addToCollection, collectionFail as fail, readRefs } from "./scriptureCollections";

// Scripture Listening Library (migration 227), mounted at /scripture-library.
// Personal, owner-only data around the existing Saved Scriptures (bookmarks),
// playlists and collections (220): favourites, listening history and resume.
// Rules live in lib/scriptureLibrary.ts; access to any playlist/collection
// named here is checked with the SAME rule as /scripture-collections on every
// request (a revoked or left share stops working at once).
//   GET    /saved                    my Saved Scriptures with title, tags, memorisation, favourite (?q, tag, memorisation, favourites, offset)
//   PATCH  /saved/:id                { title?, tags?, memorisation? }
//   POST   /save                     { ref, saved?, favourite?, collectionIds?, allowRepeat? } one passage → several places at once
//   GET    /favourites               my favourite passages, playlists and collections
//   PUT    /favourites               { ref } | { collectionId } (idempotent)
//   DELETE /favourites/:id           removes the favourite only — never the passage or playlist
//   GET    /history                  recently listened passages (?limit)
//   POST   /history                  { ref, collectionId?, itemId?, source } a passage started (reuses an open row)
//   POST   /history/:id/complete     { listenedSeconds? } that passage finished
//   DELETE /history                  clear my listening history (playlists and saved passages stay)
//   GET    /recent                   playlists/collections I listened to recently, with where I was
//   GET    /state/:collectionId      where I am in a playlist (to resume)
//   PUT    /state/:collectionId      { itemId, partKey, offset, queue, shuffle, repeat, rate }
// Only references are stored — never Bible text or audio. None of this is
// ever shown to anyone else, including the owner of a shared playlist.

const router = Router();

async function caller(req: Request, res: Response): Promise<string | null> {
  const userId = await verifyCaller(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return userId;
}
const must = <T>(r: { data: T | null; error: unknown }): T => { if (r.error) throw r.error; return r.data as T; };
const notFound = () => new CollError(404, "Not found.");
const REF_COLS = "translation_code,book_code,chapter,start_verse,end_verse";

const reference = (r: ItemRef) => {
  const b = bookByCode(r.book_code);
  return `${b?.name ?? r.book_code} ${r.chapter}:${r.start_verse}${r.end_verse > r.start_verse ? `–${r.end_verse}` : ""}`;
};
const refOut = (r: ItemRef) => ({
  translationCode: r.translation_code, bookCode: r.book_code, bookName: bookByCode(r.book_code)?.name ?? r.book_code,
  chapter: r.chapter, startVerse: r.start_verse, endVerse: r.end_verse, reference: reference(r),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Supabase filter chain (its generic types are too deep to name here)
const sameRef = (q: any, r: ItemRef): any =>
  q.eq("translation_code", r.translation_code).eq("book_code", r.book_code).eq("chapter", r.chapter).eq("start_verse", r.start_verse).eq("end_verse", r.end_verse);
async function oneRef(raw: unknown): Promise<ItemRef> { return (await readRefs([raw]))[0]; }

/** The collection if the caller can still see it, else null (never revealing why). */
async function visible(userId: string, collectionId: string | null | undefined) {
  if (!collectionId || !isUuid(collectionId)) return null;
  try { return await access(userId, collectionId); } catch { return null; }
}

// ── Saved Scriptures (p2p_bible_bookmarks + 227's personal columns) ─────────

interface SavedRow extends ItemRef { id: string; title: string | null; tags: string[] | null; memorisation_status: string | null; created_at: string; updated_at: string | null }
const SAVED_COLS = `id,${REF_COLS},title,tags,memorisation_status,created_at,updated_at`;

async function favouritePassageKeys(userId: string): Promise<Set<string>> {
  const rows = (must(await db.from("p2p_scripture_favourites").select(`id,collection_id,${REF_COLS}`).eq("user_id", userId)) ?? []) as (ItemRef & { collection_id: string | null })[];
  return new Set(rows.filter((r) => !r.collection_id).map(refKey));
}

router.get("/saved", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const PAGE = 50;
    const offset = Math.max(0, Math.min(10_000, Number(req.query.offset ?? 0) | 0));
    const q = String(req.query.q ?? "").trim().toLocaleLowerCase().slice(0, 80);
    const tag = String(req.query.tag ?? "").trim().toLocaleLowerCase();
    const memo = memorisation(req.query.memorisation ?? undefined);
    const onlyFav = req.query.favourites === "1";
    const sort = req.query.sort === "reference" ? "reference" : req.query.sort === "updated" ? "updated" : "added";
    const [res0, fav] = await Promise.all([
      db.from("p2p_bible_bookmarks").select(SAVED_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(2000),
      favouritePassageKeys(userId),
    ]);
    const rows = must(res0) as SavedRow[] | null;
    let list = (rows ?? []).map((r) => ({ r, ref: reference(r), fav: fav.has(refKey(r)) }));
    if (q) list = list.filter((x) => x.ref.toLocaleLowerCase().includes(q) || (x.r.title ?? "").toLocaleLowerCase().includes(q) || (x.r.tags ?? []).some((t) => t.toLocaleLowerCase().includes(q)));
    if (tag) list = list.filter((x) => (x.r.tags ?? []).some((t) => t.toLocaleLowerCase() === tag));
    if (memo) list = list.filter((x) => x.r.memorisation_status === memo);
    if (onlyFav) list = list.filter((x) => x.fav);
    if (sort === "reference") list.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
    if (sort === "updated") list.sort((a, b) => (b.r.updated_at ?? b.r.created_at).localeCompare(a.r.updated_at ?? a.r.created_at));
    const page = list.slice(offset, offset + PAGE);
    return res.json({
      total: list.length, nextOffset: offset + PAGE < list.length ? offset + PAGE : null,
      tags: Array.from(new Set((rows ?? []).flatMap((r) => r.tags ?? []))).sort((a, b) => a.localeCompare(b)),
      items: page.map(({ r, fav: f }) => ({ id: r.id, ...refOut(r), title: r.title, tags: r.tags ?? [], memorisation: r.memorisation_status, favourite: f, savedAt: r.created_at, updatedAt: r.updated_at ?? r.created_at })),
    });
  } catch (e) { return fail(res, e); }
});

router.patch("/saved/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { title?: unknown; tags?: unknown; memorisation?: unknown };
  try {
    if (!isUuid(req.params.id)) throw notFound();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.title !== undefined) patch.title = cleanTitle(b.title);
    if (b.tags !== undefined) { const t = cleanTags(b.tags); if (!t) throw new CollError(400, "Tags must be a list."); patch.tags = t; }
    if (b.memorisation !== undefined) { const m = memorisation(b.memorisation); if (m === undefined) throw new CollError(400, "Choose To learn, Practising or Memorised."); patch.memorisation_status = m; }
    // Owner only: the row must be the caller's own.
    const rows = must(await db.from("p2p_bible_bookmarks").update(patch).eq("id", req.params.id).eq("user_id", userId).select(SAVED_COLS)) as SavedRow[] | null;
    if (!rows?.length) throw notFound();
    const r = rows[0];
    return res.json({ id: r.id, ...refOut(r), title: r.title, tags: r.tags ?? [], memorisation: r.memorisation_status });
  } catch (e) { return fail(res, e); }
});

/** Save a passage (once — the unique range means a second save returns the same row). */
async function saveBookmark(userId: string, r: ItemRef): Promise<string> {
  const find = async () => (must(await sameRef(db.from("p2p_bible_bookmarks").select("id").eq("user_id", userId), r).maybeSingle()) as { id: string } | null);
  const existing = await find();
  if (existing) return existing.id;
  const { data, error } = await db.from("p2p_bible_bookmarks").insert({ user_id: userId, ...r }).select("id").single();
  if ((error as { code?: string } | null)?.code === "23505") { const again = await find(); if (again) return again.id; }
  if (error || !data) throw error ?? new Error("save failed");
  return (data as { id: string }).id;
}
async function addFavourite(userId: string, target: { ref: ItemRef } | { collectionId: string }): Promise<string> {
  const q = db.from("p2p_scripture_favourites").select("id").eq("user_id", userId);
  const find = async () => (must(await ("collectionId" in target ? q.eq("collection_id", target.collectionId) : sameRef(q.is("collection_id", null), target.ref)).maybeSingle()) as { id: string } | null);
  const existing = await find();
  if (existing) return existing.id;
  const row: Record<string, unknown> = "collectionId" in target ? { user_id: userId, collection_id: target.collectionId } : { user_id: userId, collection_id: null, ...target.ref };
  const { data, error } = await db.from("p2p_scripture_favourites").insert(row).select("id").single();
  if ((error as { code?: string } | null)?.code === "23505") { const again = await find(); if (again) return again.id; }
  if (error || !data) throw error ?? new Error("favourite failed");
  return (data as { id: string }).id;
}

/**
 * One passage → several places in one go (Saved, Favourites, playlists,
 * collections). Every destination reports its own result, so one that fails
 * (e.g. view-only) never undoes or hides the others. No passage is stored twice.
 */
router.post("/save", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { ref?: unknown; saved?: unknown; favourite?: unknown; collectionIds?: unknown; allowRepeat?: unknown };
  try {
    const r = await oneRef(b.ref);
    const ids = Array.isArray(b.collectionIds) ? Array.from(new Set(b.collectionIds.filter(isUuid))).slice(0, 20) : [];
    const out: { saved: string | null; favourite: string | null; collections: { id: string; status: "added" | "already" | "failed"; error?: string }[] } = { saved: null, favourite: null, collections: [] };
    if (b.saved !== false) out.saved = await saveBookmark(userId, r);
    if (b.favourite === true) out.favourite = await addFavourite(userId, { ref: r });
    for (const id of ids) {
      try {
        const x = await addToCollection(userId, id, [refOut(r)], { allowRepeat: b.allowRepeat === true });
        out.collections.push({ id, status: x.added ? "added" : "already" });
      } catch (e) {
        out.collections.push({ id, status: "failed", error: e instanceof CollError ? e.message : "Couldn't add it there." });
      }
    }
    return res.json({ reference: reference(r), ...out });
  } catch (e) { return fail(res, e); }
});

// ── Favourites ──────────────────────────────────────────────────────────────

router.get("/favourites", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const rows = (must(await db.from("p2p_scripture_favourites").select(`id,collection_id,${REF_COLS},created_at`).eq("user_id", userId).order("created_at", { ascending: false }).limit(500)) ?? []) as (ItemRef & { id: string; collection_id: string | null; created_at: string })[];
    const passages = rows.filter((r) => !r.collection_id).map((r) => ({ id: r.id, ...refOut(r), favouritedAt: r.created_at }));
    const collections: { id: string; collectionId: string; kind: string; title: string; favouritedAt: string }[] = [];
    for (const r of rows.filter((x) => x.collection_id)) {
      // Only what the person can still open (a revoked share disappears here too).
      const v = await visible(userId, r.collection_id);
      if (v) collections.push({ id: r.id, collectionId: v.coll.id, kind: v.coll.kind, title: v.coll.title, favouritedAt: r.created_at });
    }
    return res.json({ passages, playlists: collections.filter((c) => c.kind === "playlist"), collections: collections.filter((c) => c.kind === "collection") });
  } catch (e) { return fail(res, e); }
});

router.put("/favourites", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { ref?: unknown; collectionId?: unknown };
  try {
    if (b.collectionId !== undefined) {
      const v = await visible(userId, String(b.collectionId));
      if (!v) throw new CollError(404, "This collection isn't available.");
      return res.json({ id: await addFavourite(userId, { collectionId: v.coll.id }) });
    }
    return res.json({ id: await addFavourite(userId, { ref: await oneRef(b.ref) }) });
  } catch (e) { return fail(res, e); }
});

router.delete("/favourites/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!isUuid(req.params.id)) throw notFound();
    const rows = must(await db.from("p2p_scripture_favourites").delete().eq("id", req.params.id).eq("user_id", userId).select("id")) as unknown[] | null;
    if (!rows?.length) throw notFound();
    return res.json({ removed: true });
  } catch (e) { return fail(res, e); }
});

// ── Listening history ───────────────────────────────────────────────────────

interface HistRow extends ItemRef { id: string; collection_id: string | null; item_id: string | null; source: string; started_at: string; completed_at: string | null; listened_seconds: number | null }
const HIST_COLS = `id,collection_id,item_id,${REF_COLS},source,started_at,completed_at,listened_seconds`;

router.get("/history", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 30) | 0));
    const rows = (must(await db.from("p2p_scripture_listening_history").select(HIST_COLS).eq("user_id", userId).order("started_at", { ascending: false }).limit(limit)) ?? []) as HistRow[];
    const titles = new Map<string, string>();
    for (const id of Array.from(new Set(rows.map((r) => r.collection_id).filter((x): x is string => !!x)))) {
      const v = await visible(userId, id);
      if (v) titles.set(id, v.coll.title);
    }
    return res.json({
      items: rows.map((r) => ({
        id: r.id, ...refOut(r), source: r.source, startedAt: r.started_at, completedAt: r.completed_at, listenedSeconds: r.listened_seconds,
        // A playlist that's gone or no longer shared with me is not named.
        collection: r.collection_id && titles.has(r.collection_id) ? { id: r.collection_id, title: titles.get(r.collection_id)! } : null,
      })),
    });
  } catch (e) { return fail(res, e); }
});

router.post("/history", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { ref?: unknown; collectionId?: unknown; itemId?: unknown; source?: unknown };
  try {
    const r = await oneRef(b.ref);
    const source: Source = (SOURCES as readonly unknown[]).includes(b.source) ? (b.source as Source) : "library";
    const v = b.collectionId ? await visible(userId, String(b.collectionId)) : null;
    if (b.collectionId && !v) throw new CollError(404, "This collection isn't available.");
    const itemId = v && isUuid(b.itemId) ? String(b.itemId) : null;
    // Still listening to the same passage (e.g. after a pause)? Continue that row.
    const recent = (must(await sameRef(db.from("p2p_scripture_listening_history").select(HIST_COLS).eq("user_id", userId), r).order("started_at", { ascending: false }).limit(1)) ?? []) as HistRow[];
    const open = recent[0];
    if (open && reuseHistoryRow(open) && (open.collection_id ?? null) === (v?.coll.id ?? null)) return res.json({ id: open.id, reused: true });
    const row = must(await db.from("p2p_scripture_listening_history").insert({ user_id: userId, collection_id: v?.coll.id ?? null, item_id: itemId, ...r, source }).select("id").single()) as { id: string };
    return res.json({ id: row.id, reused: false });
  } catch (e) { return fail(res, e); }
});

router.post("/history/:id/complete", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!isUuid(req.params.id)) throw notFound();
    const row = must(await db.from("p2p_scripture_listening_history").select(HIST_COLS).eq("id", req.params.id).eq("user_id", userId).maybeSingle()) as HistRow | null;
    if (!row) throw notFound();
    if (row.completed_at) return res.json({ completed: true });
    const now = Date.now();
    must(await db.from("p2p_scripture_listening_history").update({ completed_at: new Date(Math.max(now, Date.parse(row.started_at))).toISOString(), listened_seconds: listenedSeconds(req.body?.listenedSeconds, row.started_at, now) })
      .eq("id", row.id).eq("user_id", userId).select("id"));
    return res.json({ completed: true });
  } catch (e) { return fail(res, e); }
});

router.delete("/history", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    // History only: playlists, collections, saved passages, favourites and resume places stay.
    const rows = must(await db.from("p2p_scripture_listening_history").delete().eq("user_id", userId).select("id")) as unknown[] | null;
    return res.json({ cleared: rows?.length ?? 0 });
  } catch (e) { return fail(res, e); }
});

// ── Resume ──────────────────────────────────────────────────────────────────

interface StateRow { collection_id: string; item_id: string | null; part_key: string | null; part_offset: number; queue: string[] | null; shuffle: boolean; repeat_mode: string; rate: number | string; updated_at: string }
const stateOut = (s: StateRow) => ({ itemId: s.item_id, partKey: s.part_key, offset: s.part_offset, queue: s.queue ?? [], shuffle: s.shuffle, repeat: s.repeat_mode, rate: Number(s.rate), updatedAt: s.updated_at });

router.get("/recent", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const rows = (must(await db.from("p2p_scripture_listening_state").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).limit(20)) ?? []) as StateRow[];
    const out = [];
    for (const s of rows) {
      const v = await visible(userId, s.collection_id);
      if (!v) continue;
      out.push({ id: v.coll.id, kind: v.coll.kind, title: v.coll.title, cover: v.coll.cover_kind && v.coll.cover_ref ? { kind: v.coll.cover_kind, ref: v.coll.cover_ref } : null, state: stateOut(s) });
      if (out.length === 10) break;
    }
    return res.json({ items: out });
  } catch (e) { return fail(res, e); }
});

router.get("/state/:collectionId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const v = await visible(userId, req.params.collectionId);
    if (!v) throw new CollError(404, "This collection isn't available.");
    const s = must(await db.from("p2p_scripture_listening_state").select("*").eq("user_id", userId).eq("collection_id", v.coll.id).maybeSingle()) as StateRow | null;
    return res.json({ state: s ? stateOut(s) : null });
  } catch (e) { return fail(res, e); }
});

router.put("/state/:collectionId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const v = await visible(userId, req.params.collectionId);
    if (!v) throw new CollError(404, "This collection isn't available.");
    const itemIds = ((must(await db.from("p2p_scripture_collection_items").select("id").eq("collection_id", v.coll.id)) ?? []) as { id: string }[]).map((i) => i.id);
    const s = cleanResume(req.body, itemIds);
    if (typeof s === "string") throw new CollError(400, s);
    const row = { item_id: s.itemId, part_key: s.partKey, part_offset: s.offset, queue: s.queue, shuffle: s.shuffle, repeat_mode: s.repeat, rate: s.rate, updated_at: new Date().toISOString() };
    const existing = must(await db.from("p2p_scripture_listening_state").select("collection_id").eq("user_id", userId).eq("collection_id", v.coll.id).maybeSingle());
    if (existing) must(await db.from("p2p_scripture_listening_state").update(row).eq("user_id", userId).eq("collection_id", v.coll.id).select("collection_id"));
    else {
      const { error } = await db.from("p2p_scripture_listening_state").insert({ user_id: userId, collection_id: v.coll.id, ...row }).select("collection_id");
      // Saved by a parallel request: write over it (last write wins — it's one person's own place).
      if ((error as { code?: string } | null)?.code === "23505") must(await db.from("p2p_scripture_listening_state").update(row).eq("user_id", userId).eq("collection_id", v.coll.id).select("collection_id"));
      else if (error) throw error;
    }
    return res.json({ saved: true });
  } catch (e) { return fail(res, e); }
});

export default router;
