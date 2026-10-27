import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { requireAdmin, requireRole } from "../middleware/adminAuth";
import { storiesProgress } from "../lib/kingdomStoryLearning";
import { heroesFor, libraryNotReady, storyCards } from "../lib/kingdomStoryLibrary";
import { moveToBin, sendRecycleError } from "../lib/recycleBin";

// Kingdom Stories discovery (migration 215), mounted inside /kingdom-stories
// before the story routes.
//   GET /discover — the homepage in one call, from real data only:
//     featured (an editor's Featured story, with its hero image), the
//     reader's Continue Learning / Favourites / Saved for Later / Recently
//     viewed, published editorial collections, a row per category (topic
//     order) and Recently added. Only published stories; no invented
//     popularity or recommendations.
//   Editors (admin_content / super_admin): /admin/collections CRUD; deleting
//   a collection moves it to the Admin Recycle Bin.

const router = Router();
const editor = [requireAdmin, requireRole("admin_content")];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW = 12;

async function caller(req: Request, res: Response): Promise<string | null> {
  const userId = await verifyCaller(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return userId;
}

router.get("/discover", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  const [{ data: pub, error }, { data: cats }] = await Promise.all([
    db.from("p2p_kingdom_stories").select("*").eq("status", "published"),
    db.from("p2p_kingdom_story_categories").select("id,slug,title,icon,display_order").eq("status", "published").order("display_order", { ascending: true }),
  ]);
  if (error) return res.status(500).json({ error: "Couldn't load Kingdom Stories." });
  const stories = (pub ?? []) as any[];
  // Compare real times (a driver may hand back Date objects, whose String() starts with the weekday).
  const at = (v: unknown) => (v ? new Date(v as string).getTime() || 0 : 0);
  const byTopic = (a: any, b: any) => (a.topic_number ?? 1e6) - (b.topic_number ?? 1e6) || at(a.published_at) - at(b.published_at);
  const newest = [...stories].sort((a, b) => at(b.published_at) - at(a.published_at));
  const featured = newest.find((s) => s.is_featured) ?? null;

  // Personal shelves (empty when migration 215 isn't applied yet).
  const ids = stories.map((s) => s.id as string);
  const [progress, savesRes, viewsRes] = await Promise.all([
    storiesProgress(ids, userId),
    db.from("p2p_kingdom_story_saves").select("story_id,kind,created_at").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("p2p_kingdom_story_views").select("story_id,last_opened_at,last_chapter_id").eq("user_id", userId).order("last_opened_at", { ascending: false }).limit(30),
  ]);
  const saves = savesRes.error ? [] : ((savesRes.data ?? []) as any[]);
  const views = viewsRes.error ? [] : ((viewsRes.data ?? []) as any[]);
  const published = new Set(ids);
  const seen = new Map(views.map((v) => [v.story_id as string, v]));
  const continueIds = ids.filter((id) => { const p = progress.get(id); return !!p && p.totalChapters > 0 && p.started && p.doneChapters < p.totalChapters; })
    .sort((a, b) => at(seen.get(b)?.last_opened_at) - at(seen.get(a)?.last_opened_at));
  const favouriteIds = saves.filter((s) => s.kind === "favourite" && published.has(s.story_id)).map((s) => s.story_id as string);
  const laterIds = saves.filter((s) => s.kind === "later" && published.has(s.story_id)).map((s) => s.story_id as string);
  const recentIds = views.filter((v) => published.has(v.story_id)).map((v) => v.story_id as string);

  // Editorial collections (published, with their published stories in order).
  let collections: { id: string; slug: string; title: string; description: string | null; ids: string[] }[] = [];
  const { data: cols, error: colErr } = await db.from("p2p_kingdom_story_collections").select("id,slug,title,description,display_order").eq("status", "published").order("display_order", { ascending: true });
  if (!colErr && cols?.length) {
    const { data: items } = await db.from("p2p_kingdom_story_collection_items").select("collection_id,story_id,display_order").in("collection_id", cols.map((c: any) => c.id)).order("display_order", { ascending: true });
    collections = (cols as any[]).map((c) => ({ id: c.id, slug: c.slug, title: c.title, description: c.description ?? null,
      ids: ((items ?? []) as any[]).filter((i) => i.collection_id === c.id && published.has(i.story_id)).map((i) => i.story_id as string) }))
      .filter((c) => c.ids.length > 0);
  }

  const catRows = ((cats ?? []) as any[]).map((c) => ({ category: { id: c.id, slug: c.slug, title: c.title, icon: c.icon ?? null },
    ids: stories.filter((s) => s.category_id === c.id).sort(byTopic).slice(0, ROW).map((s) => s.id as string),
    total: stories.filter((s) => s.category_id === c.id).length })).filter((r) => r.ids.length > 0);
  const recentlyAdded = newest.slice(0, 10).map((s) => s.id as string);

  // One card build for every story shown; resume chapter number where known.
  const all = [...new Set([...(featured ? [featured.id] : []), ...continueIds.slice(0, ROW), ...favouriteIds.slice(0, ROW), ...laterIds.slice(0, ROW), ...recentIds.slice(0, ROW),
    ...collections.flatMap((c) => c.ids.slice(0, ROW)), ...catRows.flatMap((r) => r.ids), ...recentlyAdded])];
  const lastChapterIds = [...new Set(views.map((v) => v.last_chapter_id).filter(Boolean))] as string[];
  const { data: chNums } = lastChapterIds.length ? await db.from("p2p_kingdom_story_chapters").select("id,chapter_number").in("id", lastChapterIds) : { data: [] as any[] };
  const numOf = new Map(((chNums ?? []) as any[]).map((c) => [c.id as string, c.chapter_number as number]));
  const extra = new Map(views.map((v) => [v.story_id as string, { lastOpenedAt: v.last_opened_at, lastChapterId: v.last_chapter_id ?? null, lastChapterNumber: v.last_chapter_id ? numOf.get(v.last_chapter_id) ?? null : null }]));
  const cardList = await storyCards(userId, all, extra);
  const card = new Map(cardList.map((c) => [c.id as string, c]));
  const pick = (list: string[]) => list.map((id) => card.get(id)).filter(Boolean);
  const heroes = featured ? await heroesFor([featured.id]) : new Map();

  return res.json({
    featured: featured && card.get(featured.id) ? { ...card.get(featured.id), hero: heroes.get(featured.id) ?? null } : null,
    continueLearning: pick(continueIds.slice(0, ROW)),
    favourites: pick(favouriteIds.slice(0, ROW)),
    later: pick(laterIds.slice(0, ROW)),
    recentlyViewed: pick(recentIds.slice(0, ROW)),
    collections: collections.map((c) => ({ id: c.id, slug: c.slug, title: c.title, description: c.description, stories: pick(c.ids.slice(0, ROW)), total: c.ids.length })),
    categoryRows: catRows.map((r) => ({ category: r.category, stories: pick(r.ids), total: r.total })),
    recentlyAdded: pick(recentlyAdded),
    totalPublished: stories.length,
    libraryAvailable: !savesRes.error || !libraryNotReady(savesRes.error),
  });
});

// One published collection with all its stories (the "See all" page).
router.get("/collections/:slug", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  const { data: col } = await db.from("p2p_kingdom_story_collections").select("id,slug,title,description,status").eq("slug", String(req.params.slug)).eq("status", "published").maybeSingle();
  if (!col) return res.status(404).json({ error: "Collection not found" });
  const { data: items } = await db.from("p2p_kingdom_story_collection_items").select("story_id,display_order").eq("collection_id", col.id).order("display_order", { ascending: true });
  return res.json({ id: col.id, slug: col.slug, title: col.title, description: col.description ?? null, stories: await storyCards(userId, ((items ?? []) as any[]).map((i) => i.story_id)) });
});

// ── Editors: collections ───────────────────────────────────────────────────
function mapCol(c: any, items: any[] = []) {
  return { id: c.id, slug: c.slug, title: c.title, description: c.description ?? null, displayOrder: c.display_order, status: c.status, updatedAt: c.updated_at,
    storyIds: items.filter((i) => i.collection_id === c.id).sort((a, b) => a.display_order - b.display_order).map((i) => i.story_id) };
}
router.get("/admin/collections", ...editor, async (_req, res) => {
  const { data, error } = await db.from("p2p_kingdom_story_collections").select("*").order("display_order", { ascending: true });
  if (error) return res.status(libraryNotReady(error) ? 503 : 500).json({ error: libraryNotReady(error) ? "Collections aren't set up on this server yet." : "Couldn't load collections." });
  const { data: items } = data?.length ? await db.from("p2p_kingdom_story_collection_items").select("collection_id,story_id,display_order").in("collection_id", data.map((c: any) => c.id)) : { data: [] as any[] };
  return res.json({ collections: (data ?? []).map((c) => mapCol(c, (items ?? []) as any[])) });
});
router.post("/admin/collections", ...editor, async (req, res) => {
  const { title, slug, description, displayOrder } = req.body as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim() || title.length > 120) return res.status(400).json({ error: "title is required (up to 120 characters)" });
  const s = (typeof slug === "string" && slug.trim() ? slug : title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (!s) return res.status(400).json({ error: "slug must contain letters or numbers" });
  const { data, error } = await db.from("p2p_kingdom_story_collections").insert({ title: title.trim(), slug: s, description: typeof description === "string" ? description.trim() || null : null,
    display_order: Number.isInteger(displayOrder) ? displayOrder : 0, created_by: (req as any).adminUserId }).select().single();
  if (error?.code === "23505") return res.status(409).json({ error: "A collection with that name already exists." });
  if (error || !data) return res.status(500).json({ error: "Couldn't create the collection." });
  return res.status(201).json(mapCol(data));
});
router.put("/admin/collections/:id", ...editor, async (req, res) => {
  if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: "Not found" });
  const { title, description, displayOrder, status } = req.body as Record<string, unknown>;
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) { if (typeof title !== "string" || !title.trim() || title.length > 120) return res.status(400).json({ error: "title must be 1–120 characters" }); upd.title = title.trim(); }
  if (description !== undefined) upd.description = typeof description === "string" ? description.trim() || null : null;
  if (displayOrder !== undefined) { if (!Number.isInteger(displayOrder)) return res.status(400).json({ error: "displayOrder must be a whole number" }); upd.display_order = displayOrder; }
  if (status !== undefined) { if (!["draft", "published", "archived"].includes(String(status))) return res.status(400).json({ error: "status must be draft, published or archived" }); upd.status = status; }
  const { data, error } = await db.from("p2p_kingdom_story_collections").update(upd).eq("id", req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: "Collection not found" });
  return res.json(mapCol(data));
});
// Replace the collection's stories (in this order). Only existing stories; any status (drafts never show to readers).
router.put("/admin/collections/:id/stories", ...editor, async (req, res) => {
  if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: "Not found" });
  const ids = (req.body as { storyIds?: unknown })?.storyIds;
  if (!Array.isArray(ids) || ids.length > 100 || ids.some((i) => typeof i !== "string" || !UUID_RE.test(i)) || new Set(ids).size !== ids.length) return res.status(400).json({ error: "storyIds must be a list of up to 100 different story ids" });
  const { data: col } = await db.from("p2p_kingdom_story_collections").select("id").eq("id", req.params.id).maybeSingle();
  if (!col) return res.status(404).json({ error: "Collection not found" });
  if (ids.length) {
    const { data: found } = await db.from("p2p_kingdom_stories").select("id").in("id", ids as string[]);
    if ((found ?? []).length !== ids.length) return res.status(400).json({ error: "Some of those stories don't exist." });
  }
  const del = await db.from("p2p_kingdom_story_collection_items").delete().eq("collection_id", req.params.id);
  if (del.error) return res.status(500).json({ error: "Couldn't update the collection." });
  for (const [i, sid] of (ids as string[]).entries()) {
    const ins = await db.from("p2p_kingdom_story_collection_items").insert({ collection_id: req.params.id, story_id: sid, display_order: i });
    if (ins.error) return res.status(500).json({ error: "Couldn't update the collection." });
  }
  await db.from("p2p_kingdom_story_collections").update({ updated_at: new Date().toISOString() }).eq("id", req.params.id);
  return res.json({ storyIds: ids });
});
router.delete("/admin/collections/:id", ...editor, async (req, res) => {
  if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: "Not found" });
  try { await moveToBin((req as any).adminUserId as string, "kingdom_story_collection", String(req.params.id)); }
  catch (e) { return sendRecycleError(res, e); }
  return res.json({ removed: true, movedToRecycleBin: true });
});

export default router;
