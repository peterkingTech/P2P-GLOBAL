import { supabaseServiceRole as db } from "./supabase";
import { storiesProgress } from "./kingdomStoryLearning";

// Kingdom Stories personal library (migration 215): Favourites, Saved for
// Later and Recently viewed (with the last chapter opened). Every row belongs
// to one reader and is only read/written for that reader here. Progress and
// completion are NOT stored here — they are the storybook's real learning
// progress (migration 212, lib/kingdomStoryLearning.ts).

export type SaveKind = "favourite" | "later";
export const SAVE_KINDS: SaveKind[] = ["favourite", "later"];
const NOT_READY = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
/** The 215 tables are not on this database yet: the library degrades to empty, never fails. */
export const libraryNotReady = (e: { code?: string } | null | undefined) => !!e && NOT_READY.has(String(e.code));

/** The reader's saves for these stories: storyId → { favourite, later }. */
export async function savesFor(userId: string, storyIds: string[]): Promise<Map<string, { favourite: boolean; later: boolean }>> {
  const out = new Map<string, { favourite: boolean; later: boolean }>();
  for (const id of storyIds) out.set(id, { favourite: false, later: false });
  if (!storyIds.length) return out;
  const { data, error } = await db.from("p2p_kingdom_story_saves").select("story_id,kind").eq("user_id", userId).in("story_id", storyIds);
  if (error) return out; // not ready / transient: show as not saved
  for (const r of (data ?? []) as { story_id: string; kind: SaveKind }[]) {
    const s = out.get(r.story_id);
    if (s) s[r.kind] = true;
  }
  return out;
}

/** Cover image (or hero, else first image) per story, in one query. */
export async function coversFor(storyIds: string[]): Promise<Map<string, { id: string; mediaPath: string; caption: string | null; altText: string | null; role: string | null }>> {
  const out = new Map<string, { id: string; mediaPath: string; caption: string | null; altText: string | null; role: string | null }>();
  if (!storyIds.length) return out;
  const { data } = await db.from("p2p_kingdom_story_media").select("*").in("story_id", storyIds).eq("media_type", "image").order("display_order", { ascending: true });
  const rank = (m: any) => (m.is_cover || m.role === "cover" ? 0 : m.role === "hero" ? 1 : m.chapter_id ? 3 : 2);
  for (const m of ((data ?? []) as any[]).sort((a, b) => rank(a) - rank(b))) {
    if (!out.has(m.story_id)) out.set(m.story_id, { id: m.id, mediaPath: m.media_path, caption: m.caption ?? null, altText: m.alt_text ?? null, role: m.role ?? null });
  }
  return out;
}

/** The hero image per story (role 'hero'), for the discovery homepage. */
export async function heroesFor(storyIds: string[]): Promise<Map<string, { id: string; mediaPath: string; altText: string | null }>> {
  const out = new Map<string, { id: string; mediaPath: string; altText: string | null }>();
  if (!storyIds.length) return out;
  const { data, error } = await db.from("p2p_kingdom_story_media").select("id,story_id,media_path,alt_text").in("story_id", storyIds).eq("role", "hero");
  if (error) return out;
  for (const m of (data ?? []) as any[]) out.set(m.story_id, { id: m.id, mediaPath: m.media_path, altText: m.alt_text ?? null });
  return out;
}

/** Opening a story (and optionally a chapter) — Recently viewed and resume. */
export async function recordOpened(userId: string, storyId: string, chapterId: string | null): Promise<{ ok: boolean }> {
  const now = new Date().toISOString();
  const { data: row, error } = await db.from("p2p_kingdom_story_views").select("id,open_count").eq("user_id", userId).eq("story_id", storyId).maybeSingle();
  if (error) return { ok: false };
  if (row) {
    const upd: Record<string, unknown> = { last_opened_at: now, open_count: ((row as any).open_count ?? 1) + 1 };
    if (chapterId) upd.last_chapter_id = chapterId;
    const r = await db.from("p2p_kingdom_story_views").update(upd).eq("id", (row as any).id);
    return { ok: !r.error };
  }
  const ins = await db.from("p2p_kingdom_story_views").insert({ user_id: userId, story_id: storyId, last_chapter_id: chapterId, first_opened_at: now, last_opened_at: now, open_count: 1 });
  if (ins.error?.code === "23505") return recordOpened(userId, storyId, chapterId); // opened twice at once
  return { ok: !ins.error };
}

export function formatTopicNumber(n: number | null | undefined): string | null {
  return n ? `Topic ${String(n).padStart(3, "0")}` : null;
}

/** Story cards for a shelf: published only, with cover, category, the reader's progress and saves. */
export async function storyCards(userId: string, ids: string[], extra?: Map<string, Record<string, unknown>>) {
  if (!ids.length) return [];
  const { data: rows } = await db.from("p2p_kingdom_stories").select("id,title,subtitle,category_id,topic_number,published_at,updated_at,status").in("id", ids).eq("status", "published");
  const byId = new Map(((rows ?? []) as any[]).map((r) => [r.id as string, r]));
  const present = ids.filter((id) => byId.has(id));
  const catIds = [...new Set(present.map((id) => byId.get(id).category_id as string))];
  const [{ data: cats }, covers, progress, saves] = await Promise.all([
    catIds.length ? db.from("p2p_kingdom_story_categories").select("id,slug,title").in("id", catIds) : Promise.resolve({ data: [] as any[] }),
    coversFor(present), storiesProgress(present, userId), savesFor(userId, present),
  ]);
  const catById = new Map(((cats ?? []) as any[]).map((c) => [c.id, { slug: c.slug, title: c.title }]));
  return present.map((id) => {
    const r = byId.get(id);
    const cover = covers.get(id);
    return {
      id, title: r.title, subtitle: r.subtitle ?? null, topicNumber: r.topic_number ?? null, publishedAt: r.published_at, updatedAt: r.updated_at,
      category: catById.get(r.category_id) ?? null,
      media: cover ? [{ id: cover.id, mediaType: "image", mediaPath: cover.mediaPath, caption: cover.caption, isCover: true, altText: cover.altText }] : [],
      myProgress: progress.get(id) ?? null, mine: saves.get(id) ?? { favourite: false, later: false },
      ...(extra?.get(id) ?? {}),
    };
  });
}
