import type { Router, Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "./supabase";
import { buildLessonFields, mapCustomLesson, LESSON_STATUSES, type CustomLessonStatus } from "./customLessons";

// Custom lesson authoring routes, mounted by BOTH routes/familyStudies.ts and
// routes/churchStudies.ts (same behaviour; each passes its own table and its
// own authorization: Family Shepherd/Co-Shepherd, or church leadership).
//
//   POST   <base>/:studyId/lessons                     create (draft unless status: 'published')
//   PUT    <base>/:studyId/lessons/:lessonId           edit; a PUBLISHED lesson's content edit bumps version
//   POST   <base>/:studyId/lessons/:lessonId/status    { status: draft | published | archived }
//   DELETE <base>/:studyId/lessons/:lessonId           only a never-published draft; otherwise archive (409)
//
// Before migration 200 (no status/version/tags/resources columns) writes
// fall back to the original columns, so deploying first never breaks anything.

const PRE_200_COLUMNS = ["status", "published_at", "archived_at", "version", "tags", "resources"];
const missingColumn = (e: unknown) => ["42703", "PGRST204"].includes(((e ?? {}) as { code?: string }).code ?? "");
const withoutPre200 = (f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).filter(([k]) => !PRE_200_COLUMNS.includes(k)));

export interface CustomLessonRouteOptions {
  base: string;
  table: "p2p_family_study_lessons" | "p2p_church_study_lessons";
  loadForManage: (studyId: string, userId: string) => Promise<{ study: unknown; authorized: boolean }>;
  who: string; // e.g. "the Family Shepherd or a Co-Shepherd"
}

export function mountCustomLessonRoutes(router: Router, o: CustomLessonRouteOptions) {
  const ok = (res: Response, data: unknown) => res.json(data);
  const err = (res: Response, message: string, status = 400) => res.status(status).json({ error: message });

  async function guard(req: { params: Record<string, string> } & Parameters<typeof verifyCaller>[0], res: Response, action: string) {
    const userId = await verifyCaller(req);
    if (!userId) { err(res, "Unauthorized", 401); return null; }
    const { study, authorized } = await o.loadForManage(req.params.studyId, userId);
    if (!study) { err(res, "Study not found", 404); return null; }
    if (!authorized) { err(res, `Only ${o.who} can ${action}`, 403); return null; }
    return userId;
  }
  async function loadLesson(studyId: string, lessonId: string) {
    const { data } = await db.from(o.table).select("*").eq("id", lessonId).eq("study_id", studyId).maybeSingle();
    return data as Record<string, unknown> | null;
  }

  router.post(`${o.base}/:studyId/lessons`, async (req, res) => {
    if (!(await guard(req, res, "add lessons to this study"))) return;
    const built = buildLessonFields(req.body ?? {}, null);
    if (typeof built === "string") return err(res, built);
    const publish = (req.body as { status?: string })?.status === "published";
    const row: Record<string, unknown> = { ...built.fields, study_id: req.params.studyId, status: publish ? "published" : "draft", published_at: publish ? new Date().toISOString() : null };
    let { data, error } = await db.from(o.table).insert(row).select().single();
    if (error && missingColumn(error)) ({ data, error } = await db.from(o.table).insert(withoutPre200(row)).select().single());
    if (error || !data) return err(res, error?.message ?? "Failed to add the lesson", 500);
    return ok(res, mapCustomLesson(data as Record<string, unknown>));
  });

  router.put(`${o.base}/:studyId/lessons/:lessonId`, async (req, res) => {
    if (!(await guard(req, res, "edit this lesson"))) return;
    const existing = await loadLesson(req.params.studyId, req.params.lessonId);
    if (!existing) return err(res, "Lesson not found", 404);
    const built = buildLessonFields(req.body ?? {}, existing);
    if (typeof built === "string") return err(res, built);
    const updates: Record<string, unknown> = { ...built.fields, updated_at: new Date().toISOString() };
    // Editing a published lesson is allowed; its version goes up so answers
    // already given keep pointing at the version (and question text) they answered.
    if (built.contentChanged && existing.status === "published") updates.version = ((existing.version as number | undefined) ?? 1) + 1;
    let { data, error } = await db.from(o.table).update(updates).eq("id", req.params.lessonId).eq("study_id", req.params.studyId).select().single();
    if (error && missingColumn(error)) ({ data, error } = await db.from(o.table).update(withoutPre200(updates)).eq("id", req.params.lessonId).eq("study_id", req.params.studyId).select().single());
    if (error || !data) return err(res, error?.message ?? "Failed to update the lesson", 500);
    return ok(res, mapCustomLesson(data as Record<string, unknown>));
  });

  router.post(`${o.base}/:studyId/lessons/:lessonId/status`, async (req, res) => {
    if (!(await guard(req, res, "change this lesson"))) return;
    const status = (req.body as { status?: string })?.status as CustomLessonStatus;
    if (!LESSON_STATUSES.includes(status)) return err(res, "status must be draft, published or archived");
    const existing = await loadLesson(req.params.studyId, req.params.lessonId);
    if (!existing) return err(res, "Lesson not found", 404);
    if (existing.status === undefined) return err(res, "Lesson publishing isn't available yet", 409); // before migration 200
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { status, updated_at: now };
    if (status === "published" && !existing.published_at) updates.published_at = now;
    updates.archived_at = status === "archived" ? now : null;
    const { data, error } = await db.from(o.table).update(updates).eq("id", req.params.lessonId).eq("study_id", req.params.studyId).select().single();
    if (error || !data) return err(res, error?.message ?? "Failed to update the lesson", 500);
    return ok(res, mapCustomLesson(data as Record<string, unknown>));
  });

  router.delete(`${o.base}/:studyId/lessons/:lessonId`, async (req, res) => {
    if (!(await guard(req, res, "remove this lesson"))) return;
    const existing = await loadLesson(req.params.studyId, req.params.lessonId);
    if (!existing) return err(res, "Lesson not found", 404);
    // Before 200 every lesson was visible with its study: treat as published.
    const everPublished = existing.status === undefined ? true : !!existing.published_at || existing.status !== "draft";
    if (everPublished) return err(res, "This lesson has been published — archive it instead so nothing people wrote is lost", 409);
    const { error } = await db.from(o.table).delete().eq("id", req.params.lessonId).eq("study_id", req.params.studyId);
    if (error) return err(res, error.message, 500);
    return ok(res, { removed: true });
  });
}

/** Lessons a viewer may see: leaders see everything; members only published lessons. */
export function visibleLessons(rows: Record<string, unknown>[], canManage: boolean) {
  const mapped = rows.map(mapCustomLesson);
  return canManage ? mapped : mapped.filter((l) => l.status === "published");
}
