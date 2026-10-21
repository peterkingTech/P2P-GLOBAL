import { Router, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import {
  CANON, bookByCode, getChapter, searchBible, relatedLessons, licensedTranslations, publicTranslation, BibleError,
} from "../lib/bibleReader";

// The Bible reader API (mounted at /bible). Every route needs a signed-in
// caller. Reading routes serve licensed Scripture through lib/bibleReader.ts.
// "/me" routes are the caller's PRIVATE study data — highlights, notes and
// saved passages (migration 207): identity always comes from the token, and
// every query is filtered to that user, so nobody can read or change another
// person's records by sending other ids. Only references are stored, never
// Bible text.

const router = Router();
const ok = (res: Response, data: unknown) => res.json(data);
const err = (res: Response, message: string, status = 400) => res.status(status).json({ error: message });
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const HIGHLIGHT_COLORS = ["gold", "green", "blue", "rose", "violet"] as const;
const NOT_READY = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);
const notReady = (e: { code?: string } | null | undefined) => !!e && NOT_READY.has(String(e.code));

async function caller(req: import("express").Request, res: Response) {
  const userId = await verifyCaller(req);
  if (!userId) { err(res, "Please sign in.", 401); return null; }
  return userId;
}
function fail(res: Response, e: unknown) {
  if (e instanceof BibleError) return err(res, e.message, e.status);
  return err(res, "The Bible couldn't be loaded. Please try again.", 500);
}

/** Validates a passage reference against the canon and the licensed translations. */
async function readRef(body: Record<string, unknown>): Promise<{ t: string; book: { code: string; name: string; chapters: number }; chapter: number; sv: number; ev: number } | string> {
  const t = String(body.translationCode ?? "");
  const book = bookByCode(String(body.bookCode ?? ""));
  const chapter = Number(body.chapter), sv = Number(body.startVerse), ev = Number(body.endVerse ?? body.startVerse);
  if (!book) return "Unknown book";
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) return "Unknown chapter";
  if (!Number.isInteger(sv) || !Number.isInteger(ev) || sv < 1 || ev < sv || ev - sv > 199) return "Choose verses in order";
  if (!(await licensedTranslations()).some((r) => r.translation_code === t)) return "That translation isn't available";
  return { t, book, chapter, sv, ev };
}
const refLabel = (bookName: string, chapter: number, sv: number, ev: number) => `${bookName} ${chapter}:${sv}${ev > sv ? `-${ev}` : ""}`;
const mapRef = (r: Record<string, unknown>) => {
  const book = bookByCode(String(r.book_code ?? ""));
  return {
    translationCode: r.translation_code as string, bookCode: r.book_code as string, bookName: book?.name ?? (r.book_code as string),
    chapter: r.chapter as number, startVerse: r.start_verse as number, endVerse: r.end_verse as number,
    reference: book ? refLabel(book.name, r.chapter as number, r.start_verse as number, r.end_verse as number) : "",
  };
};

// ── Reading ──────────────────────────────────────────────────────────────────
router.get("/reader/translations", async (req, res) => {
  if (!(await caller(req, res))) return;
  try { return ok(res, { translations: (await licensedTranslations()).map(publicTranslation) }); } catch (e) { return fail(res, e); }
});
router.get("/reader/books", async (req, res) => {
  if (!(await caller(req, res))) return;
  return ok(res, { books: CANON });
});
router.get("/reader/chapter", async (req, res) => {
  if (!(await caller(req, res))) return;
  const { book, chapter, t } = req.query as { book?: string; chapter?: string; t?: string };
  try { return ok(res, await getChapter(String(book ?? ""), Number(chapter), String(t ?? ""))); } catch (e) { return fail(res, e); }
});
router.get("/reader/search", async (req, res) => {
  if (!(await caller(req, res))) return;
  const { q, t, offset } = req.query as { q?: string; t?: string; offset?: string };
  try { return ok(res, await searchBible(String(q ?? ""), String(t ?? ""), Number(offset ?? 0))); } catch (e) { return fail(res, e); }
});
router.get("/reader/related", async (req, res) => {
  if (!(await caller(req, res))) return;
  const { book, chapter } = req.query as { book?: string; chapter?: string };
  try { return ok(res, { lessons: await relatedLessons(String(book ?? ""), Number(chapter)) }); } catch (e) { return fail(res, e); }
});

// ── My study data for one chapter (one request when a chapter opens) ────────
router.get("/me/chapter", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const { t, book, chapter } = req.query as { t?: string; book?: string; chapter?: string };
  const b = bookByCode(String(book ?? "")); const ch = Number(chapter);
  if (!b || !Number.isInteger(ch)) return err(res, "Unknown passage");
  const [h, n, s] = await Promise.all([
    db.from("p2p_user_highlights").select("id,translation_code,book_code,chapter,start_verse,end_verse,color").eq("user_id", userId).eq("book_code", b.code).eq("chapter", ch).eq("translation_code", String(t ?? "")),
    db.from("p2p_user_notes").select("id,title,body,translation_code,book_code,chapter,start_verse,end_verse,updated_at").eq("user_id", userId).eq("book_code", b.code).eq("chapter", ch),
    db.from("p2p_bible_bookmarks").select("id,translation_code,book_code,chapter,start_verse,end_verse").eq("user_id", userId).eq("book_code", b.code).eq("chapter", ch),
  ]);
  if (notReady(h.error) || notReady(n.error) || notReady(s.error)) return ok(res, { available: false, highlights: [], notes: [], bookmarks: [] });
  if (h.error || n.error || s.error) return err(res, "Couldn't load your notes and highlights", 500);
  return ok(res, {
    available: true,
    highlights: (h.data ?? []).map((r) => ({ id: r.id, color: r.color, ...mapRef(r) })),
    notes: (n.data ?? []).map((r) => ({ id: r.id, title: r.title ?? null, body: r.body, updatedAt: r.updated_at, ...mapRef(r) })),
    bookmarks: (s.data ?? []).map((r) => ({ id: r.id, ...mapRef(r) })),
  });
});

// ── Highlights ───────────────────────────────────────────────────────────────
router.post("/me/highlights", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const ref = await readRef(req.body ?? {});
  if (typeof ref === "string") return err(res, ref);
  const color = String(req.body?.color ?? "");
  if (!(HIGHLIGHT_COLORS as readonly string[]).includes(color)) return err(res, "Choose a highlight colour");
  // One highlight per verse: overlapping highlights in this chapter/translation are replaced.
  const existing = await db.from("p2p_user_highlights").select("id,start_verse,end_verse").eq("user_id", userId)
    .eq("translation_code", ref.t).eq("book_code", ref.book.code).eq("chapter", ref.chapter);
  if (notReady(existing.error)) return err(res, "Highlights aren't available yet", 503);
  if (existing.error) return err(res, "Couldn't save the highlight", 500);
  const overlapping = (existing.data ?? []).filter((r) => (r.start_verse as number) <= ref.ev && (r.end_verse as number) >= ref.sv).map((r) => r.id as string);
  if (overlapping.length) await db.from("p2p_user_highlights").delete().eq("user_id", userId).in("id", overlapping);
  const { data, error } = await db.from("p2p_user_highlights").insert({
    user_id: userId, reference: `${refLabel(ref.book.name, ref.chapter, ref.sv, ref.ev)} (${ref.t})`, quote: null, color,
    translation_code: ref.t, book_code: ref.book.code, chapter: ref.chapter, start_verse: ref.sv, end_verse: ref.ev, updated_at: new Date().toISOString(),
  }).select("id,translation_code,book_code,chapter,start_verse,end_verse,color").single();
  if (error || !data) return err(res, "Couldn't save the highlight", 500);
  return ok(res, { id: data.id, color: data.color, ...mapRef(data) });
});
router.put("/me/highlights/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const color = String(req.body?.color ?? "");
  if (!isUuid(req.params.id)) return err(res, "Not found", 404);
  if (!(HIGHLIGHT_COLORS as readonly string[]).includes(color)) return err(res, "Choose a highlight colour");
  const { data, error } = await db.from("p2p_user_highlights").update({ color, updated_at: new Date().toISOString() })
    .eq("id", req.params.id).eq("user_id", userId).not("book_code", "is", null).select("id,translation_code,book_code,chapter,start_verse,end_verse,color").maybeSingle();
  if (notReady(error)) return err(res, "Highlights aren't available yet", 503);
  if (error) return err(res, "Couldn't update the highlight", 500);
  if (!data) return err(res, "Not found", 404);
  return ok(res, { id: data.id, color: data.color, ...mapRef(data) });
});
router.delete("/me/highlights/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  if (!isUuid(req.params.id)) return err(res, "Not found", 404);
  const { data, error } = await db.from("p2p_user_highlights").delete().eq("id", req.params.id).eq("user_id", userId).not("book_code", "is", null).select("id");
  if (error) return err(res, "Couldn't remove the highlight", 500);
  if (!data?.length) return err(res, "Not found", 404);
  return ok(res, { removed: true });
});

// ── Notes ────────────────────────────────────────────────────────────────────
const NOTE_COLS = "id,title,body,translation_code,book_code,chapter,start_verse,end_verse,updated_at";
const mapNote = (r: Record<string, unknown>) => ({ id: r.id, title: (r.title as string | null) ?? null, body: r.body, updatedAt: r.updated_at, ...mapRef(r) });
function noteText(body: Record<string, unknown>): { title: string | null; text: string } | string {
  const text = String(body.body ?? "").trim();
  const title = String(body.title ?? "").trim() || null;
  if (!text) return "Write something first";
  if (text.length > 10_000) return "That note is too long";
  if (title && title.length > 200) return "That title is too long";
  return { title, text };
}
router.post("/me/notes", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const ref = await readRef(req.body ?? {});
  if (typeof ref === "string") return err(res, ref);
  const n = noteText(req.body ?? {});
  if (typeof n === "string") return err(res, n);
  const { data, error } = await db.from("p2p_user_notes").insert({
    user_id: userId, title: n.title, body: n.text, translation_code: ref.t, book_code: ref.book.code, chapter: ref.chapter,
    start_verse: ref.sv, end_verse: ref.ev, updated_at: new Date().toISOString(),
  }).select(NOTE_COLS).single();
  if (notReady(error)) return err(res, "Bible notes aren't available yet", 503);
  if (error || !data) return err(res, "Couldn't save the note", 500);
  return ok(res, mapNote(data));
});
router.put("/me/notes/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  if (!isUuid(req.params.id)) return err(res, "Not found", 404);
  const n = noteText(req.body ?? {});
  if (typeof n === "string") return err(res, n);
  const { data, error } = await db.from("p2p_user_notes").update({ title: n.title, body: n.text, updated_at: new Date().toISOString() })
    .eq("id", req.params.id).eq("user_id", userId).not("book_code", "is", null).select(NOTE_COLS).maybeSingle();
  if (notReady(error)) return err(res, "Bible notes aren't available yet", 503);
  if (error) return err(res, "Couldn't save the note", 500);
  if (!data) return err(res, "Not found", 404);
  return ok(res, mapNote(data));
});
router.delete("/me/notes/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  if (!isUuid(req.params.id)) return err(res, "Not found", 404);
  const { data, error } = await db.from("p2p_user_notes").delete().eq("id", req.params.id).eq("user_id", userId).not("book_code", "is", null).select("id");
  if (error) return err(res, "Couldn't delete the note", 500);
  if (!data?.length) return err(res, "Not found", 404);
  return ok(res, { removed: true });
});

// ── Saved passages ───────────────────────────────────────────────────────────
router.post("/me/bookmarks", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const ref = await readRef(req.body ?? {});
  if (typeof ref === "string") return err(res, ref);
  const row = { user_id: userId, translation_code: ref.t, book_code: ref.book.code, chapter: ref.chapter, start_verse: ref.sv, end_verse: ref.ev };
  const COLS = "id,translation_code,book_code,chapter,start_verse,end_verse";
  // Saving the same passage twice returns the existing row (unique per range).
  const find = () => db.from("p2p_bible_bookmarks").select(COLS).eq("user_id", userId).eq("translation_code", ref.t)
    .eq("book_code", ref.book.code).eq("chapter", ref.chapter).eq("start_verse", ref.sv).eq("end_verse", ref.ev).maybeSingle();
  const existing = await find();
  if (notReady(existing.error)) return err(res, "Saved passages aren't available yet", 503);
  if (existing.data) return ok(res, { id: existing.data.id, ...mapRef(existing.data) });
  let { data, error } = await db.from("p2p_bible_bookmarks").insert(row).select(COLS).single();
  if (error?.code === "23505") ({ data, error } = await find());   // saved by a parallel request
  if (notReady(error)) return err(res, "Saved passages aren't available yet", 503);
  if (error || !data) return err(res, "Couldn't save the passage", 500);
  return ok(res, { id: data.id, ...mapRef(data) });
});
router.delete("/me/bookmarks/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  if (!isUuid(req.params.id)) return err(res, "Not found", 404);
  const { data, error } = await db.from("p2p_bible_bookmarks").delete().eq("id", req.params.id).eq("user_id", userId).select("id");
  if (notReady(error)) return err(res, "Saved passages aren't available yet", 503);
  if (error) return err(res, "Couldn't remove the saved passage", 500);
  if (!data?.length) return err(res, "Not found", 404);
  return ok(res, { removed: true });
});

// ── My study library (paged) ─────────────────────────────────────────────────
router.get("/me/library", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const kind = String(req.query.kind ?? "notes");
  const offset = Math.max(0, Math.min(10_000, Number(req.query.offset ?? 0) | 0));
  const PAGE = 30;
  const q = kind === "highlights"
    ? db.from("p2p_user_highlights").select("id,color,translation_code,book_code,chapter,start_verse,end_verse,updated_at,created_at").eq("user_id", userId).not("book_code", "is", null).order("created_at", { ascending: false })
    : kind === "saved"
      ? db.from("p2p_bible_bookmarks").select("id,translation_code,book_code,chapter,start_verse,end_verse,created_at").eq("user_id", userId).order("created_at", { ascending: false })
      : kind === "notes"
        ? db.from("p2p_user_notes").select(NOTE_COLS).eq("user_id", userId).not("book_code", "is", null).order("updated_at", { ascending: false })
        : null;
  if (!q) return err(res, "Unknown list");
  const { data, error } = await q.range(offset, offset + PAGE);
  if (notReady(error)) return ok(res, { available: false, items: [], hasMore: false });
  if (error) return err(res, "Couldn't load your library", 500);
  const rows = (data ?? []) as Record<string, unknown>[];
  const items = rows.slice(0, PAGE).map((r) => kind === "notes" ? mapNote(r) : kind === "highlights" ? { id: r.id, color: r.color, ...mapRef(r) } : { id: r.id, ...mapRef(r) });
  return ok(res, { available: true, items, hasMore: rows.length > PAGE });
});

export default router;
