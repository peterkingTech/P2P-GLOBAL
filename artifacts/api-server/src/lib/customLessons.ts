import crypto from "node:crypto";

// Custom lessons (Family + Church studies; migrations 134/135/200) — one
// validator / mapper for both scopes so the two authoring APIs can't drift.
// Custom lessons are the group's own content: never central P2P curriculum.

export type CustomLessonStatus = "draft" | "published" | "archived";
export const LESSON_STATUSES: readonly CustomLessonStatus[] = ["draft", "published", "archived"];
export type QuestionKind = "discussion" | "reflection";
export interface LessonQuestion { id: string; text: string; kind: QuestionKind }
export interface ScriptureRef { book: string; chapter: number; startVerse: number; endVerse: number; translation: string | null }
export interface LessonResource { title: string; url: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITS = { questions: 30, questionText: 500, passages: 10, resources: 10, resourceTitle: 120, url: 500, tags: 8, tag: 30, title: 160, description: 600, teaching: 20000, prayer: 1000 };

/** Questions as stored/returned: legacy plain strings read as discussion questions. */
export function readQuestions(raw: unknown): LessonQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q, i): LessonQuestion[] => {
    if (typeof q === "string") return q.trim() ? [{ id: `legacy-${i}`, text: q.trim(), kind: "discussion" }] : [];
    if (q && typeof q === "object" && typeof (q as LessonQuestion).text === "string" && (q as LessonQuestion).text.trim()) {
      const o = q as Partial<LessonQuestion>;
      return [{ id: typeof o.id === "string" && o.id ? o.id : `legacy-${i}`, text: o.text!.trim(), kind: o.kind === "reflection" ? "reflection" : "discussion" }];
    }
    return [];
  });
}

/** Normalise questions from a client: keep known ids (stable across edits), new ones get a uuid. */
export function normalizeQuestions(input: unknown, existing: unknown): LessonQuestion[] | string {
  if (!Array.isArray(input)) return "questions must be a list";
  const known = new Set(readQuestions(existing).map((q) => q.id));
  const out: LessonQuestion[] = [];
  for (const q of input) {
    const text = (typeof q === "string" ? q : (q as { text?: unknown })?.text);
    if (typeof text !== "string" || !text.trim()) continue;
    if (text.trim().length > LIMITS.questionText) return `Each question can be at most ${LIMITS.questionText} characters`;
    const rawId = typeof q === "object" && q ? (q as { id?: unknown }).id : undefined;
    const id = typeof rawId === "string" && (known.has(rawId) || UUID_RE.test(rawId)) ? rawId : crypto.randomUUID();
    const kind: QuestionKind = typeof q === "object" && q && (q as { kind?: unknown }).kind === "reflection" ? "reflection" : "discussion";
    out.push({ id, text: text.trim(), kind });
  }
  if (out.length > LIMITS.questions) return `At most ${LIMITS.questions} questions`;
  if (new Set(out.map((q) => q.id)).size !== out.length) return "Duplicate question ids";
  return out;
}

const int = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

export function normalizeScripture(input: unknown): ScriptureRef[] | string {
  if (input == null) return [];
  if (!Array.isArray(input)) return "scriptureReferences must be a list";
  if (input.length > LIMITS.passages) return `At most ${LIMITS.passages} passages`;
  const out: ScriptureRef[] = [];
  for (const r of input) {
    const o = (r ?? {}) as Record<string, unknown>;
    const book = typeof o.book === "string" ? o.book.trim() : "";
    const chapter = int(o.chapter), start = int(o.startVerse), end = o.endVerse == null || o.endVerse === "" ? start : int(o.endVerse);
    if (!book || book.length > 40) return "Each passage needs a book";
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 150) return `${book}: chapter must be 1–150`;
    if (!Number.isInteger(start) || start < 1 || start > 176 || !Number.isInteger(end) || end < start || end > 176) return `${book} ${chapter}: check the verse numbers`;
    const translation = typeof o.translation === "string" && o.translation.trim() ? o.translation.trim().slice(0, 20) : null;
    out.push({ book, chapter, startVerse: start, endVerse: end, translation });
  }
  return out;
}

export function normalizeResources(input: unknown): LessonResource[] | string {
  if (input == null) return [];
  if (!Array.isArray(input)) return "resources must be a list";
  if (input.length > LIMITS.resources) return `At most ${LIMITS.resources} links`;
  const out: LessonResource[] = [];
  for (const r of input) {
    const o = (r ?? {}) as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!url) continue;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return "Each link must be a full web address (https://…)"; }
    if (parsed.protocol !== "https:" || url.length > LIMITS.url) return "Links must start with https://";
    const title = (typeof o.title === "string" && o.title.trim() ? o.title.trim() : parsed.hostname).slice(0, LIMITS.resourceTitle);
    out.push({ title, url: parsed.toString() });
  }
  return out;
}

export function normalizeTags(input: unknown): string[] | string {
  if (input == null) return [];
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : null;
  if (!list) return "tags must be a list";
  const tags = Array.from(new Set(list.map((t) => (typeof t === "string" ? t.trim().toLowerCase().replace(/^#/, "") : "")).filter(Boolean)));
  if (tags.length > LIMITS.tags) return `At most ${LIMITS.tags} tags`;
  if (tags.some((t) => t.length > LIMITS.tag)) return `Each tag can be at most ${LIMITS.tag} characters`;
  return tags;
}

/** YouTube only (the app's existing secure player): accepts an id or a youtube.com / youtu.be link. */
export function normalizeMedia(input: unknown): { provider: "youtube"; id: string; url: null } | null | string {
  if (input == null) return null;
  const o = input as { provider?: unknown; id?: unknown; url?: unknown };
  const raw = String(o.id ?? o.url ?? "").trim();
  if (!raw) return null;
  if (o.provider != null && o.provider !== "youtube") return "Only YouTube videos are supported";
  let id = raw;
  const m = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
  if (m) id = m[1];
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return "That doesn't look like a YouTube video link";
  return { provider: "youtube", id, url: null };
}

type Body = Record<string, unknown>;
/**
 * DB column values for a create (existing null) or partial update. Returns
 * { fields, contentChanged } or an error message. Never touches status.
 */
export function buildLessonFields(body: Body, existing: Record<string, unknown> | null): { fields: Record<string, unknown>; contentChanged: boolean } | string {
  const f: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const text = (k: string, max: number, required = false): string | null | undefined | Error => {
    if (!has(k)) return undefined;
    const v = body[k];
    if (v == null || (typeof v === "string" && !v.trim())) return required ? new Error(`${k} is required`) : null;
    if (typeof v !== "string") return new Error(`${k} must be text`);
    if (v.trim().length > max) return new Error(`${k} is too long`);
    return v.trim();
  };
  if (!existing && !has("title")) return "title is required";
  for (const [k, col, max, req] of [["title", "title", LIMITS.title, true], ["description", "description", LIMITS.description, false],
    ["teachingMaterial", "teaching_material", LIMITS.teaching, false], ["prayerFocus", "prayer_focus", LIMITS.prayer, false]] as const) {
    const v = text(k, max, req);
    if (v instanceof Error) return v.message.replace("teachingMaterial", "Teaching content").replace("prayerFocus", "Prayer focus").replace(/^title/, "Title");
    if (v !== undefined) f[col] = v;
  }
  if (has("questions")) { const q = normalizeQuestions(body.questions, existing?.questions); if (typeof q === "string") return q; f.questions = q; }
  if (has("scriptureReferences")) { const s = normalizeScripture(body.scriptureReferences); if (typeof s === "string") return s; f.scripture_references = s; }
  if (has("resources")) { const r = normalizeResources(body.resources); if (typeof r === "string") return r; f.resources = r; }
  if (has("tags")) { const t = normalizeTags(body.tags); if (typeof t === "string") return t; f.tags = t; }
  if (has("media")) {
    const m = normalizeMedia(body.media);
    if (typeof m === "string") return m;
    f.media_provider = m?.provider ?? null; f.media_id = m?.id ?? null; f.media_url = null;
  }
  if (has("orderIndex")) { const n = int(body.orderIndex); if (!Number.isInteger(n) || n < 0) return "orderIndex must be a whole number"; f.order_index = n; }
  const contentKeys = Object.keys(f).filter((k) => k !== "order_index");
  const contentChanged = !!existing && contentKeys.some((k) => JSON.stringify(existing[k] ?? null) !== JSON.stringify(f[k] ?? null));
  return { fields: f, contentChanged };
}

export function mapCustomLesson(row: Record<string, unknown>) {
  return {
    id: row.id, studyId: row.study_id, title: row.title, description: row.description ?? null,
    scriptureReferences: (row.scripture_references as unknown[] | null) ?? [], teachingMaterial: row.teaching_material ?? null,
    questions: readQuestions(row.questions), prayerFocus: row.prayer_focus ?? null,
    media: row.media_provider ? { provider: row.media_provider, id: row.media_id, url: row.media_url ?? null } : null,
    resources: (row.resources as LessonResource[] | null) ?? [], tags: (row.tags as string[] | null) ?? [],
    // Before migration 200 a lesson had no own status: it was visible with its study.
    status: ((row.status as CustomLessonStatus | undefined) ?? "published"), publishedAt: row.published_at ?? null, version: (row.version as number | undefined) ?? 1,
    orderIndex: row.order_index, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
