// Custom lessons (Family + Church) — shared shapes and form logic for the
// authoring UI (components/study/CustomLessonEditor.tsx / CustomLessonSection.tsx).
// The server (api-server lib/customLessons.ts) validates everything again;
// this only prepares what the editor sends.

export type LessonStatus = "draft" | "published" | "archived";
export type QuestionKind = "discussion" | "reflection";
export interface LessonQuestion { id?: string; text: string; kind: QuestionKind }
export interface ScriptureRef { book: string; chapter: number; startVerse: number; endVerse: number; translation: string | null }
export interface LessonResource { title: string; url: string }

export interface CustomLesson {
  id: string; studyId: string; title: string; description: string | null;
  scriptureReferences: unknown[]; teachingMaterial: string | null; questions: unknown[]; prayerFocus: string | null;
  media: { provider: string; id: string; url: string | null } | null;
  resources?: LessonResource[]; tags?: string[];
  status?: LessonStatus; publishedAt?: string | null; version?: number;
  orderIndex: number; createdAt: string; updatedAt: string;
}

/** Payload the authoring routes accept (POST / PUT …/lessons). */
export interface LessonInput {
  title?: string; description?: string | null; teachingMaterial?: string | null; prayerFocus?: string | null;
  scriptureReferences?: ScriptureRef[]; questions?: LessonQuestion[]; resources?: LessonResource[]; tags?: string[];
  media?: { provider: "youtube"; id: string; url: null } | null; orderIndex?: number; status?: "published";
}

/** Adapter each scope's screen passes in (family / church study APIs). */
export interface LessonApi {
  add(input: LessonInput): Promise<CustomLesson>;
  update(lessonId: string, input: LessonInput): Promise<CustomLesson>;
  setStatus(lessonId: string, status: LessonStatus): Promise<CustomLesson>;
  remove(lessonId: string): Promise<unknown>;
}

export interface PassageForm { book: string; chapter: string; startVerse: string; endVerse: string; translation: string }
export interface LessonForm {
  title: string; description: string; teachingMaterial: string; prayerFocus: string; tags: string; media: string;
  passages: PassageForm[]; questions: LessonQuestion[]; resources: LessonResource[];
}

/** Questions as the server returns them; legacy plain strings read as discussion questions. */
export function readQuestions(raw: unknown[] | undefined): LessonQuestion[] {
  return (raw ?? []).flatMap((q): LessonQuestion[] => {
    if (typeof q === "string") return q.trim() ? [{ text: q.trim(), kind: "discussion" }] : [];
    const o = q as Partial<LessonQuestion> | null;
    return o && typeof o.text === "string" && o.text.trim() ? [{ id: o.id, text: o.text, kind: o.kind === "reflection" ? "reflection" : "discussion" }] : [];
  });
}

export function readPassages(raw: unknown[] | undefined): ScriptureRef[] {
  return (raw ?? []).flatMap((r): ScriptureRef[] => {
    const o = r as Partial<ScriptureRef> | null;
    if (!o || typeof o.book !== "string" || !o.chapter || !o.startVerse) return [];
    return [{ book: o.book, chapter: Number(o.chapter), startVerse: Number(o.startVerse), endVerse: Number(o.endVerse ?? o.startVerse), translation: o.translation ?? null }];
  });
}

export function passageLabel(r: ScriptureRef): string {
  const range = r.endVerse && r.endVerse !== r.startVerse ? `${r.startVerse}-${r.endVerse}` : `${r.startVerse}`;
  return `${r.book} ${r.chapter}:${range}${r.translation ? ` (${r.translation})` : ""}`;
}

const blankPassage = (translation = ""): PassageForm => ({ book: "", chapter: "", startVerse: "", endVerse: "", translation });

export function lessonToForm(lesson?: CustomLesson | null): LessonForm {
  const passages = readPassages(lesson?.scriptureReferences).map((p) => ({
    book: p.book, chapter: String(p.chapter), startVerse: String(p.startVerse), endVerse: String(p.endVerse), translation: p.translation ?? "",
  }));
  return {
    title: lesson?.title ?? "", description: lesson?.description ?? "", teachingMaterial: lesson?.teachingMaterial ?? "",
    prayerFocus: lesson?.prayerFocus ?? "", tags: (lesson?.tags ?? []).join(", "),
    media: lesson?.media?.id ? `https://youtu.be/${lesson.media.id}` : "",
    passages: passages.length ? passages : [blankPassage()],
    questions: readQuestions(lesson?.questions).length ? readQuestions(lesson?.questions) : [{ text: "", kind: "discussion" }],
    resources: lesson?.resources?.length ? lesson.resources : [],
  };
}

export const newPassage = blankPassage;

/** Build the server payload, or a message for the first problem the writer must fix. */
export function formToInput(form: LessonForm): LessonInput | string {
  if (!form.title.trim()) return "Give the lesson a title.";
  const scriptureReferences: ScriptureRef[] = [];
  for (const p of form.passages) {
    if (!p.book.trim() && !p.chapter.trim() && !p.startVerse.trim()) continue; // empty row
    const chapter = Number(p.chapter), start = Number(p.startVerse), end = p.endVerse.trim() ? Number(p.endVerse) : start;
    if (!p.book.trim()) return "Choose a book for each passage.";
    if (!Number.isInteger(chapter) || chapter < 1) return `${p.book}: enter a chapter number.`;
    if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) return `${p.book} ${p.chapter}: check the verse numbers.`;
    scriptureReferences.push({ book: p.book.trim(), chapter, startVerse: start, endVerse: end, translation: p.translation.trim() || null });
  }
  const resources = form.resources.filter((r) => r.url.trim()).map((r) => ({ title: r.title.trim(), url: r.url.trim() }));
  if (resources.some((r) => !/^https:\/\//i.test(r.url))) return "Links must start with https://";
  return {
    title: form.title.trim(), description: form.description.trim() || null, teachingMaterial: form.teachingMaterial.trim() || null,
    prayerFocus: form.prayerFocus.trim() || null, scriptureReferences,
    questions: form.questions.filter((q) => q.text.trim()).map((q) => ({ ...(q.id ? { id: q.id } : {}), text: q.text.trim(), kind: q.kind })),
    resources, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    media: form.media.trim() ? { provider: "youtube", id: form.media.trim(), url: null } : null,
  };
}

export function statusLabel(status: LessonStatus | undefined): string {
  return status === "draft" ? "Draft" : status === "archived" ? "Archived" : "Published";
}
