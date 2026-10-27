import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { storiesProgress } from "../lib/kingdomStoryLearning";
import { SAVE_KINDS, libraryNotReady, recordOpened, storyCards as cards, type SaveKind } from "../lib/kingdomStoryLibrary";

// Kingdom Stories personal library (migration 215), mounted inside
// /kingdom-stories before the story routes:
//   GET    /me/library?shelf=favourites|later|recent|in_progress|completed
//   POST   /:id/save        { kind: "favourite" | "later" }
//   DELETE /:id/save/:kind
//   POST   /:id/opened      { chapterId? }   — Recently viewed + resume
// Only published stories appear on shelves or can be saved. Identity always
// comes from the token; a reader only ever touches their own rows.

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHELVES = ["favourites", "later", "recent", "in_progress", "completed"] as const;
type Shelf = (typeof SHELVES)[number];

async function caller(req: Request, res: Response): Promise<string | null> {
  const userId = await verifyCaller(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return userId;
}
async function publishedStory(id: string) {
  if (!UUID_RE.test(id)) return null;
  const { data } = await db.from("p2p_kingdom_stories").select("id,status").eq("id", id).eq("status", "published").maybeSingle();
  return data;
}

router.get("/me/library", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  const shelf = String(req.query.shelf ?? "favourites") as Shelf;
  if (!SHELVES.includes(shelf)) return res.status(400).json({ error: `shelf must be one of: ${SHELVES.join(", ")}` });
  const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 30) || 30));

  if (shelf === "favourites" || shelf === "later") {
    const { data, error } = await db.from("p2p_kingdom_story_saves").select("story_id,created_at").eq("user_id", userId)
      .eq("kind", shelf === "favourites" ? "favourite" : "later").order("created_at", { ascending: false }).limit(limit);
    if (error) return libraryNotReady(error) ? res.json({ shelf, stories: [], available: false }) : res.status(500).json({ error: "Couldn't load your library." });
    return res.json({ shelf, stories: await cards(userId, ((data ?? []) as any[]).map((r) => r.story_id)), available: true });
  }
  if (shelf === "recent") {
    const { data, error } = await db.from("p2p_kingdom_story_views").select("story_id,last_opened_at,last_chapter_id").eq("user_id", userId)
      .order("last_opened_at", { ascending: false }).limit(limit);
    if (error) return libraryNotReady(error) ? res.json({ shelf, stories: [], available: false }) : res.status(500).json({ error: "Couldn't load your library." });
    const extra = new Map(((data ?? []) as any[]).map((r) => [r.story_id as string, { lastOpenedAt: r.last_opened_at, lastChapterId: r.last_chapter_id ?? null }]));
    return res.json({ shelf, stories: await cards(userId, ((data ?? []) as any[]).map((r) => r.story_id), extra), available: true });
  }
  // In progress / completed: the storybook's real progress over published stories.
  const { data: pub } = await db.from("p2p_kingdom_stories").select("id").eq("status", "published");
  const ids = ((pub ?? []) as any[]).map((r) => r.id as string);
  const progress = await storiesProgress(ids, userId);
  const pick = ids.filter((id) => {
    const p = progress.get(id);
    if (!p || !p.totalChapters) return false;
    const finished = p.doneChapters >= p.totalChapters;
    return shelf === "completed" ? finished : p.started && !finished;
  });
  // Most recently opened first, where known.
  const { data: views } = await db.from("p2p_kingdom_story_views").select("story_id,last_opened_at").eq("user_id", userId).in("story_id", pick.length ? pick : ["00000000-0000-0000-0000-000000000000"]);
  const seen = new Map(((views ?? []) as any[]).map((v) => [v.story_id as string, v.last_opened_at as string]));
  pick.sort((a, b) => (seen.get(b) ?? "").localeCompare(seen.get(a) ?? ""));
  return res.json({ shelf, stories: await cards(userId, pick.slice(0, limit)), available: true });
});

router.post("/:id/save", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  const kind = (req.body as { kind?: string })?.kind as SaveKind;
  if (!SAVE_KINDS.includes(kind)) return res.status(400).json({ error: "kind must be favourite or later" });
  if (!(await publishedStory(String(req.params.id)))) return res.status(404).json({ error: "Story not found" });
  const { error } = await db.from("p2p_kingdom_story_saves").insert({ user_id: userId, story_id: req.params.id, kind });
  if (error && error.code !== "23505") {
    return libraryNotReady(error) ? res.status(503).json({ error: "Saving stories isn't available yet." }) : res.status(500).json({ error: "Couldn't save." });
  }
  return res.json({ saved: true, kind });
});

router.delete("/:id/save/:kind", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  const kind = String(req.params.kind) as SaveKind;
  if (!SAVE_KINDS.includes(kind) || !UUID_RE.test(String(req.params.id))) return res.status(400).json({ error: "Invalid request" });
  const { error } = await db.from("p2p_kingdom_story_saves").delete().eq("user_id", userId).eq("story_id", req.params.id).eq("kind", kind);
  if (error) return libraryNotReady(error) ? res.json({ saved: false, kind }) : res.status(500).json({ error: "Couldn't update." });
  return res.json({ saved: false, kind });
});

router.post("/:id/opened", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  const story = await publishedStory(String(req.params.id));
  if (!story) return res.json({ recorded: false }); // drafts (editor preview) are not tracked
  const chapterId = (req.body as { chapterId?: string })?.chapterId ?? null;
  if (chapterId !== null) {
    if (!UUID_RE.test(chapterId)) return res.status(400).json({ error: "invalid chapterId" });
    const { data: ch } = await db.from("p2p_kingdom_story_chapters").select("id").eq("id", chapterId).eq("story_id", req.params.id).maybeSingle();
    if (!ch) return res.status(400).json({ error: "That chapter isn't part of this story." });
  }
  const r = await recordOpened(userId, String(req.params.id), chapterId);
  return res.json({ recorded: r.ok });
});

export default router;
