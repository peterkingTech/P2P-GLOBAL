// Listen: a Kingdom School / Core Curriculum / Learning Plan lesson as
// speakable sections — exactly the text the lesson screen shows, with spoken
// signposts so a listener knows where they are: "Lesson: <title>",
// "Scripture", each lesson section (heading + paragraphs), then "Personal
// Reflections" and "Comprehensive Check", each question announced
// ("Question 1. …"). Only QUESTIONS are read — never anyone's answers — and
// reading them answers nothing: the lesson completes only through the normal
// submissions. Nothing is invented: a lesson with no text gives nothing.
import type { ListenSection } from "./chunking";
import { NO_LABELS, type SpokenLabels } from "./labels";

export type QuestionKind = "reflections" | "check";
export interface QuestionGroup {
  id: string;
  kind: QuestionKind;
  /** Shown in the player. */
  title: string;
  /** The group's own name (e.g. a check's title), spoken after its label when different. */
  name?: string | null;
  questions: { id: string; question: string }[];
}

export interface LessonListenInput {
  title: string;
  /** `text` null when the shown wording isn't in the lesson's language (only the reference is read). */
  scriptures: { id: string; reference: string; text: string | null }[];
  sections: { id: string; title: string; content: string }[];
  /** Personal Reflections and the Comprehensive Check — questions only. */
  questionGroups?: QuestionGroup[];
}

const sentence = (s: string) => (/[.!?:;…]$/.test(s) ? s : `${s}.`);

/** Question groups as sections: the spoken label, then "Question 1. …". Empty questions are skipped. */
export function questionSections(groups: QuestionGroup[] | undefined, labels: SpokenLabels = NO_LABELS): ListenSection[] {
  const out: ListenSection[] = [];
  for (const g of groups ?? []) {
    const qs = g.questions.filter((q) => (q.question ?? "").trim());
    if (!qs.length) continue;
    const label = g.kind === "check" ? labels.check : labels.personalReflections;
    const name = g.name?.trim() && g.name.trim().toLowerCase() !== (label ?? "").toLowerCase() ? g.name.trim() : null;
    const intro = [label, name].filter(Boolean).map((x) => sentence(x as string)).join(" ");
    out.push({
      id: g.id, title: g.title,
      parts: [
        ...(intro ? [{ key: `${g.id}:label`, text: intro }] : []),
        ...qs.map((q, i) => {
          const lead = labels.question(i + 1) ?? (qs.length > 1 ? `${i + 1}` : null);
          return { key: `${g.id}:${q.id}`, text: `${lead ? `${lead}. ` : ""}${q.question.trim()}` };
        }),
      ],
    });
  }
  return out;
}

export function lessonListenSections(l: LessonListenInput, labels: SpokenLabels = NO_LABELS): ListenSection[] {
  const out: ListenSection[] = [];
  const verses = l.scriptures.filter((s) => (s.reference ?? "").trim());
  out.push({
    id: "scripture", title: verses.length ? "Scripture" : "Lesson",
    parts: [
      { key: "title", text: sentence(labels.lesson ? `${labels.lesson}: ${l.title}` : l.title) },
      ...(verses.length && labels.scripture ? [{ key: "scripture-label", text: sentence(labels.scripture) }] : []),
      ...verses.map((s) => ({ key: `s:${s.id}`, text: s.text?.trim() ? `${s.reference}. ${s.text.trim()}` : `${s.reference}.` })),
    ],
  });
  for (const sec of l.sections) {
    const paras = String(sec.content ?? "").split("\n\n").map((p) => p.trim()).filter(Boolean);
    if (!paras.length && !sec.title.trim()) continue;
    out.push({
      id: sec.id, title: sec.title.trim() || "Lesson",
      parts: [
        ...(sec.title.trim() ? [{ key: `${sec.id}:title`, text: sentence(sec.title.trim()) }] : []),
        ...paras.map((p, i) => ({ key: `${sec.id}:${i}`, text: p })),
      ],
    });
  }
  // Only a title and nothing else to read → nothing to listen to.
  if (out.length === 1 && out[0].parts.length === 1 && !(l.questionGroups ?? []).some((g) => g.questions.some((q) => q.question?.trim()))) return [];
  out.push(...questionSections(l.questionGroups, labels));
  return out;
}
