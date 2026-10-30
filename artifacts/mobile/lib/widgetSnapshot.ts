import { currentModule, isStoryInProgress } from "@/lib/learningHome";

// Home-screen / Lock Screen widgets read ONE small snapshot that the app
// writes after it has loaded real data (lib/widgetSync). The widgets never
// fetch anything themselves, so everything here works offline and shows the
// last synchronised state. This file only BUILDS the snapshot from data the
// app already has — every rule comes from the canonical source:
//   • current Kingdom School module  → lib/learningHome.currentModule
//   • Core Curriculum progress       → DataContext modules (completedLessons /
//                                       lessonCount, the counts Kingdom School shows)
//   • Kingdom Story in progress      → lib/learningHome.isStoryInProgress
//   • Comprehensive Checks counts    → GET /learning/centre/overview
//   • Study Together                 → GET /study-together/mine (active)
//   • next church Gathering          → GET /churches/:id/calls (upcoming)
//   • daily verse                    → the app's own built-in verse list
// Nothing here creates, starts or completes anything.
//
// Privacy (widgets can be seen by anyone holding the phone): never journal
// text, prayer requests, messages, answers or feedback — only titles, counts
// and dates. Names of families/churches only when the person turns
// "Community on widgets" on. No tokens or account identifiers.

export const WIDGET_SNAPSHOT_VERSION = 1;

export interface WidgetLink { label: string; url: string }

export interface WidgetSnapshot {
  version: number;
  /** When the app last wrote this (ISO). Widgets show "may be out of date" when old. */
  updatedAt: string;
  signedIn: boolean;
  greeting: { name: string | null };
  /** The app's own verse list; widgets pick today's by the same rule as the app (day of month % length). url opens that chapter. */
  verses: { ref: string; text: string; url: string }[];
  verseUrl: string;
  school: {
    hasProgress: boolean;
    moduleTitle: string | null;
    completedLessons: number;
    lessonCount: number;
    modulesCompleted: number;
    totalModules: number;
    url: string;
  };
  plans: { activeCount: number; title: string | null; url: string };
  story: { title: string | null; detail: string | null; url: string };
  bible: { label: string | null; url: string };
  learning: { toDo: number; awaitingReview: number; feedback: number; toReview: number; known: boolean; url: string };
  together: { title: string | null; detail: string | null; activeCount: number; url: string };
  gathering: { title: string | null; startsAt: string | null; where: string | null; url: string };
  /** Kingdom School modules finished — the same count Kingdom School shows. No points or scores. */
  progress: { modulesCompleted: number; totalModules: number };
  reminders: { prayerUrl: string; journalUrl: string };
  privacy: { lockScreenDetails: boolean; showCommunity: boolean };
}

export interface WidgetPrefs {
  /** Show the person's first name in the greeting (off = "Welcome"). */
  personalGreeting: boolean;
  /** Show family / church names and gathering details on widgets. */
  showCommunity: boolean;
  /** Show titles on Lock Screen widgets (off = generic text only). */
  lockScreenDetails: boolean;
}
export const DEFAULT_WIDGET_PREFS: WidgetPrefs = { personalGreeting: true, showCommunity: false, lockScreenDetails: false };

export interface WidgetInputs {
  now: Date;
  signedIn: boolean;
  firstName: string | null;
  prefs: WidgetPrefs;
  link: (path: string) => string;
  verses: { ref: string; text: string; url: string }[];
  modules: { id: string; title: string; isLocked: boolean; lessonCount: number; completedLessons: number }[];
  activePlans: { id: string; title: string }[];
  stories: { id: string; title: string; myProgress?: { totalChapters: number; doneChapters: number; started: boolean } | null; lastChapterNumber?: number | null }[];
  bible: { bookName: string; chapter: number; translation: string; book: string } | null;
  overview: { toDo: number; awaitingReview: number; feedback: number; toReview: number } | null;
  studies: { id: string; title: string; destinationName: string | null }[];
  nextGathering: { title: string; startsAt: string; churchName: string | null } | null;
}

/** Builds the snapshot. Pure: same inputs → same snapshot (except updatedAt). */
export function buildWidgetSnapshot(i: WidgetInputs): WidgetSnapshot {
  const mod = currentModule(i.modules);
  const modulesCompleted = i.modules.filter((m) => m.lessonCount > 0 && m.completedLessons >= m.lessonCount).length;
  const totalModules = i.modules.filter((m) => m.lessonCount > 0).length;
  const story = i.stories.find(isStoryInProgress) ?? null;
  const sp = story?.myProgress;
  const plan = i.activePlans[0] ?? null;
  const study = i.studies[0] ?? null;
  const community = i.prefs.showCommunity;
  return {
    version: WIDGET_SNAPSHOT_VERSION,
    updatedAt: i.now.toISOString(),
    signedIn: i.signedIn,
    greeting: { name: i.prefs.personalGreeting && i.firstName ? i.firstName : null },
    verses: i.verses.map((v) => ({ ref: v.ref, text: v.text, url: v.url })),
    verseUrl: i.link("/bible-study"),
    school: {
      hasProgress: !!mod,
      moduleTitle: mod?.title ?? null,
      completedLessons: mod?.completedLessons ?? 0,
      lessonCount: mod?.lessonCount ?? 0,
      modulesCompleted,
      totalModules,
      url: i.link(mod ? `/module/${mod.id}` : "/kingdom-school"),
    },
    plans: {
      activeCount: i.activePlans.length,
      title: plan?.title ?? null,
      url: i.link(plan ? `/plan/${plan.id}` : "/plans"),
    },
    story: {
      title: story?.title ?? null,
      detail: story && sp ? `Chapter ${story.lastChapterNumber ?? sp.doneChapters + 1} of ${sp.totalChapters}` : null,
      url: i.link(story ? `/kingdom-stories/${story.id}?open=next` : "/kingdom-stories"),
    },
    bible: {
      label: i.bible ? `${i.bible.bookName} ${i.bible.chapter} · ${i.bible.translation}` : null,
      url: i.link(i.bible ? `/bible?book=${encodeURIComponent(i.bible.book)}&chapter=${i.bible.chapter}` : "/bible-study"),
    },
    learning: {
      toDo: i.overview?.toDo ?? 0,
      awaitingReview: i.overview?.awaitingReview ?? 0,
      feedback: i.overview?.feedback ?? 0,
      toReview: i.overview?.toReview ?? 0,
      known: !!i.overview,
      url: i.link("/learning"),
    },
    together: {
      title: study?.title ?? null,
      detail: community ? study?.destinationName ?? null : null,
      activeCount: i.studies.length,
      url: i.link(study ? `/study-together/${study.id}` : "/study-together"),
    },
    gathering: community && i.nextGathering
      ? { title: i.nextGathering.title, startsAt: i.nextGathering.startsAt, where: i.nextGathering.churchName, url: i.link("/church/calls") }
      : { title: null, startsAt: null, where: null, url: i.link("/community") },
    progress: { modulesCompleted, totalModules },
    reminders: { prayerUrl: i.link("/(tabs)/prayer"), journalUrl: i.link("/my-discipleship/journal") },
    privacy: { lockScreenDetails: i.prefs.lockScreenDetails, showCommunity: community },
  };
}

/** The signed-out snapshot: no personal data at all; widgets say "Open P2P Global". */
export function signedOutSnapshot(now: Date, link: (path: string) => string, verses: { ref: string; text: string; url: string }[]): WidgetSnapshot {
  return buildWidgetSnapshot({
    now, signedIn: false, firstName: null, prefs: DEFAULT_WIDGET_PREFS, link, verses,
    modules: [], activePlans: [], stories: [], bible: null, overview: null, studies: [], nextGathering: null,
  });
}

/** Today's verse by the app's own rule (day of month % list length) — the same verse Home shows. */
export function verseForDay(verses: { ref: string; text: string }[], day: Date) {
  return verses.length ? verses[day.getDate() % verses.length] : null;
}

/** Time-of-day greeting, as the widgets compute it on the phone (no network). */
export function greetingFor(hour: number): "Good morning" | "Good afternoon" | "Good evening" {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** Stable text for change detection: everything except the timestamp. */
export function snapshotKey(s: WidgetSnapshot): string {
  const { updatedAt: _ignored, ...rest } = s;
  return JSON.stringify(rest);
}
