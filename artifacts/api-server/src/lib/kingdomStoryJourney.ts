// Kingdom Stories: the reader's place in the biblical order, and what to read
// next. Pure functions over data the discovery route already loads — nothing
// is stored, nothing is invented.
//
// The order is the editors' order: categories by display_order, and within a
// category by topic_number (then publication date for unnumbered stories).
// Each category keeps its own sequence; categories are never merged into one
// timeline. Only published stories take part, so an unpublished topic is
// simply skipped (the reader moves on to the next published one).
//
// Next in the journey, in the category the reader was last active in:
//   1. the earliest story they started but haven't finished (continue first);
//   2. else the first unstarted story after the furthest one they finished;
//   3. else any earlier unfinished story in that category;
//   4. else the first unfinished story of the next category, in order;
//   5. no progress anywhere: the first story of the first category.
// A story counts as finished when every chapter is submitted or completed —
// the storybook's own rule (lib/kingdomStoryLearning.ts).

export interface JourneyCategory { id: string; title: string; displayOrder: number }
export interface JourneyStory { id: string; categoryId: string; topicNumber: number | null; publishedAt: string | null; relatedStoryId: string | null }
export interface JourneyProgress { totalChapters: number; doneChapters: number; started: boolean }

export type JourneyState = "start" | "continue" | "next";
export interface Journey {
  storyId: string;
  state: JourneyState;
  categoryId: string;
  /** 1-based place of the story among its category's published stories. */
  position: number;
  categoryTotal: number;
  /** Published stories that follow it in the same category (not finished). */
  upNext: string[];
}

export type RecommendationReason = "next_in_journey" | "related" | "same_category" | "other_category" | "for_journey";
export interface Recommendation { storyId: string; reason: RecommendationReason; label: string }

const FILL_TO = 6;
const time = (v:string | null | undefined) => (v ? new Date(v).getTime() || 0 : 0);

/** Each category's published stories in the editorial order (categories with none are left out). */
export function sequences(categories: JourneyCategory[], stories: JourneyStory[]): { category: JourneyCategory; ids: string[] }[] {
  return [...categories].sort((a, b) => a.displayOrder - b.displayOrder)
    .map((category) => ({
      category,
      ids: stories.filter((s) => s.categoryId === category.id)
        .sort((a, b) => (a.topicNumber ?? 1e6) - (b.topicNumber ?? 1e6) || time(a.publishedAt) - time(b.publishedAt) || a.id.localeCompare(b.id))
        .map((s) => s.id),
    }))
    .filter((r) => r.ids.length > 0);
}

export const isFinished = (p: JourneyProgress | undefined) => !!p && p.totalChapters > 0 && p.doneChapters >= p.totalChapters;
const isStarted = (p: JourneyProgress | undefined) => !!p && p.started && !isFinished(p);
const touched = (p: JourneyProgress | undefined) => !!p && (p.started || isFinished(p));

/**
 * The reader's next story in the biblical order, or null when there is
 * nothing published or every published story is finished.
 * `lastActive`: storyId → last time the reader opened it (Recently viewed).
 */
export function nextInJourney(
  categories: JourneyCategory[], stories: JourneyStory[],
  progress: Map<string, JourneyProgress>, lastActive: Map<string, string | null | undefined> = new Map(),
): Journey | null {
  const seqs = sequences(categories, stories);
  if (!seqs.length) return null;
  const build = (ci: number, idx: number, state: JourneyState): Journey => {
    const ids = seqs[ci].ids;
    return {
      storyId: ids[idx], state, categoryId: seqs[ci].category.id, position: idx + 1, categoryTotal: ids.length,
      upNext: ids.slice(idx + 1).filter((id) => !isFinished(progress.get(id))),
    };
  };

  const anyProgress = seqs.some((r) => r.ids.some((id) => touched(progress.get(id))));
  if (!anyProgress) return build(0, 0, "start");

  // The category the reader was last active in: the most recently opened story
  // with real progress; else the first category in which they have progress.
  let current = -1, best = -1;
  seqs.forEach((r, ci) => r.ids.forEach((id) => {
    if (!touched(progress.get(id))) return;
    const t = time(lastActive.get(id) ?? null);
    if (t > best) { best = t; current = ci; }
  }));
  if (current < 0) current = seqs.findIndex((r) => r.ids.some((id) => touched(progress.get(id))));

  const inCategory = (ci: number): Journey | null => {
    const ids = seqs[ci].ids;
    const started = ids.findIndex((id) => isStarted(progress.get(id)));
    if (started >= 0) return build(ci, started, "continue");
    let furthest = -1;
    ids.forEach((id, i) => { if (isFinished(progress.get(id))) furthest = i; });
    const after = ids.findIndex((id, i) => i > furthest && !isFinished(progress.get(id)));
    if (after >= 0) return build(ci, after, furthest < 0 ? "start" : "next");
    const earlier = ids.findIndex((id) => !isFinished(progress.get(id)));
    return earlier >= 0 ? build(ci, earlier, "next") : null;
  };

  const here = inCategory(current);
  if (here) return here;
  // That category is finished: the following categories in order, then any earlier one.
  for (const ci of [...seqs.keys()].slice(current + 1).concat([...seqs.keys()].slice(0, current))) {
    const j = inCategory(ci);
    if (j) return { ...j, state: "next" };
  }
  return null;
}

/**
 * Recommended stories, each with its reason, most useful first:
 * next in the journey → the editor-linked related story → later stories in
 * the same category → the first unfinished story of other categories → other
 * unfinished stories. Finished stories and anything in `exclude` (the hero,
 * Continue) are left out; each story appears once.
 */
export function recommend(
  categories: JourneyCategory[], stories: JourneyStory[], progress: Map<string, JourneyProgress>,
  journey: Journey | null, titles: Map<string, string>, exclude: Set<string> = new Set(), limit = 12,
): Recommendation[] {
  const seqs = sequences(categories, stories);
  const byId = new Map(stories.map((s) => [s.id, s]));
  const catTitle = new Map(categories.map((c) => [c.id, c.title]));
  const out: Recommendation[] = [];
  const used = new Set<string>();
  const add = (id: string | null | undefined, reason: RecommendationReason, label: string) => {
    if (!id || used.has(id) || exclude.has(id) || !byId.has(id) || isFinished(progress.get(id)) || out.length >= limit) return;
    used.add(id);
    out.push({ storyId: id, reason, label });
  };

  if (journey) {
    add(journey.storyId, "next_in_journey", "Next in your biblical journey");
    const related = byId.get(journey.storyId)?.relatedStoryId;
    add(related, "related", `Related to ${titles.get(journey.storyId) ?? "your next story"}`);
    // Other stories the reader is reading point to their related stories too.
    for (const s of stories) if (isStarted(progress.get(s.id)) && s.relatedStoryId) add(s.relatedStoryId, "related", `Related to ${titles.get(s.id) ?? "a story you're reading"}`);
    const label = `Continue exploring ${catTitle.get(journey.categoryId) ?? "this category"}`;
    for (const id of journey.upNext.slice(0, 4)) add(id, "same_category", label);
  }
  for (const r of seqs) {
    if (journey && r.category.id === journey.categoryId) continue;
    const first = r.ids.find((id) => !isFinished(progress.get(id)) && !exclude.has(id) && !used.has(id));
    add(first, "other_category", `Explore ${r.category.title}`);
  }
  // Only top up a short row — the category rows already list everything else.
  for (const r of seqs) for (const id of r.ids) if (out.length < FILL_TO) add(id, "for_journey", "Recommended for your journey");
  return out;
}

/** The published stories just before and after this one in its category's order. */
export function neighbours(categories: JourneyCategory[], stories: JourneyStory[], storyId: string): { previous: string | null; next: string | null } {
  for (const r of sequences(categories, stories)) {
    const i = r.ids.indexOf(storyId);
    if (i >= 0) return { previous: r.ids[i - 1] ?? null, next: r.ids[i + 1] ?? null };
  }
  return { previous: null, next: null };
}
