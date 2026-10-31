// Listen: the spoken signposts ("Chapter 1", "Personal Reflections",
// "Comprehensive Check", "Story Lessons", "Question 2"…) so a listener always
// knows where they are. They come from the app's own translations (locales),
// in the language of the TEXT being read ("lesson.title", "lesson.assignment",
// "plan.overview", plus the "listen" block, which also holds "Personal
// Reflections" — the audio's name for reflection questions in every language). A language without a translation gets no spoken label
// (only the numbers) — never an English word dropped into another language.

export interface SpokenLabels {
  lesson: string | null;
  personalReflections: string | null;
  check: string | null;
  overview: string | null;
  introduction: string | null;
  scripture: string | null;
  storyLessons: string | null;
  chapter: (n: number) => string | null;
  question: (n: number) => string | null;
  lessonItem: (n: number) => string | null;
}

/** Labels from a resource lookup that does NOT fall back to another language. */
export function labelsFrom(get: (key: string) => string | null | undefined): SpokenLabels {
  const s = (k: string) => { const v = get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
  const n = (k: string) => (num: number) => { const v = s(k); return v ? v.replace(/\{\{\s*n\s*\}\}/g, String(num)) : null; };
  return {
    lesson: s("lesson.title"),
    // Always "Personal Reflections" in audio — never the screens' older "discussion questions" wording.
    personalReflections: s("listen.personalReflections"),
    check: s("lesson.assignment"),
    overview: s("plan.overview"),
    introduction: s("listen.introduction"),
    scripture: s("listen.scripture"),
    storyLessons: s("listen.storyLessons"),
    chapter: n("listen.chapter"),
    question: n("listen.question"),
    lessonItem: n("listen.lessonItem"),
  };
}

export const NO_LABELS: SpokenLabels = labelsFrom(() => null);
