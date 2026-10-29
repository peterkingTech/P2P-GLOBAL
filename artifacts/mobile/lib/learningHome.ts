// The Learning Centre's "Continue Learning": one list built from the real
// state each learning experience already keeps — nothing is stored here and
// no progress is invented. Each item opens its own authoritative screen.
//   • Kingdom School: the current Foundations module (DataContext modules).
//   • Kingdom Stories: stories with real progress (GET /kingdom-stories/discover).
//   • Study Together: active shared studies (GET /study-together/mine).
//   • Bible: the last chapter read on this device (lib/bibleReadingPrefs).
// Order: work already under way first (a module with finished lessons, then
// the most recently opened story, then shared studies), then the Bible
// position, then a Kingdom School module not yet begun.

export type ContinueKind = "school" | "story" | "together" | "bible";
export interface ContinueItem {
  key: string;
  kind: ContinueKind;
  typeLabel: string;
  title: string;
  detail: string | null;
  /** 0..1 from real progress, or null when that experience has none to show. */
  progress: number | null;
  icon: string;
  imagePath?: string | null;
  route: { pathname: string; params?: Record<string, string> };
}

export interface ContinueInputs {
  modules?: { id: string; title: string; lessonCount: number; completedLessons: number; isLocked: boolean }[];
  stories?: { id: string; title: string; category?: { title: string } | null; myProgress?: { totalChapters: number; doneChapters: number; started: boolean } | null; lastChapterNumber?: number | null; media?: { mediaPath: string }[] }[];
  studies?: { id: string; title: string; contentType: string; destination: { type: string; name: string | null }; lastOpenedAt: string | null; updatedAt: string }[];
  bible?: { book: string; bookName: string; chapter: number; translation: string } | null;
}

const TYPE = { school: "Kingdom School", story: "Kingdom Stories", together: "Study Together", bible: "Bible Study" } as const;

export function continueItems(i: ContinueInputs, max = 6): ContinueItem[] {
  const out: ContinueItem[] = [];
  const mod = (i.modules ?? []).find((m) => !m.isLocked && m.lessonCount > 0 && m.completedLessons < m.lessonCount) ?? null;
  const moduleItem = (m: NonNullable<typeof mod>): ContinueItem => ({
    key: `school:${m.id}`, kind: "school", typeLabel: TYPE.school, title: m.title,
    detail: `${m.completedLessons} of ${m.lessonCount} lessons`, progress: m.completedLessons / m.lessonCount, icon: "school-outline",
    route: { pathname: "/module/[id]", params: { id: m.id } },
  });
  if (mod && mod.completedLessons > 0) out.push(moduleItem(mod));
  for (const s of i.stories ?? []) {
    const p = s.myProgress;
    if (!p || !p.started || !p.totalChapters || p.doneChapters >= p.totalChapters) continue;
    out.push({
      key: `story:${s.id}`, kind: "story", typeLabel: TYPE.story, title: s.title,
      detail: [s.category?.title, `Chapter ${s.lastChapterNumber ?? p.doneChapters + 1} of ${p.totalChapters}`].filter(Boolean).join(" · "),
      progress: p.doneChapters / p.totalChapters, icon: "library-outline", imagePath: s.media?.[0]?.mediaPath ?? null,
      route: { pathname: "/kingdom-stories/[id]", params: { id: s.id, open: "next" } },
    });
  }
  for (const s of i.studies ?? []) {
    out.push({
      key: `together:${s.id}`, kind: "together", typeLabel: TYPE.together, title: s.title,
      detail: [s.contentType === "lesson" ? "Kingdom School lesson" : "Kingdom Story", s.destination.name].filter(Boolean).join(" · "),
      progress: null, icon: "people-outline", route: { pathname: "/study-together/[id]", params: { id: s.id } },
    });
  }
  if (i.bible) {
    out.push({
      key: "bible", kind: "bible", typeLabel: TYPE.bible, title: `${i.bible.bookName} ${i.bible.chapter}`,
      detail: i.bible.translation, progress: null, icon: "book-outline", route: { pathname: "/bible" },
    });
  }
  if (mod && mod.completedLessons === 0) out.push({ ...moduleItem(mod), detail: `${mod.lessonCount} lessons · not started`, progress: 0 });
  return out.slice(0, max);
}
