// Explains WHY a Core lesson or module is locked and what unlocks it, using
// the same rules DataContext applies when it computes isLocked (it never
// changes them):
//   • a module opens when EVERY lesson of the previous module is completed
//     (completed = approved);
//   • the first lesson of an open module is always open;
//   • a lesson opens once the previous lesson is completed OR submitted
//     (all its questions sent for review — approval isn't required);
//   • a module's "Discussion & Review" lesson (order ≥ 999) opens only when
//     every earlier lesson of that module is completed (approved).
// Pure functions over the lesson/module data the app already has.

export interface LockLesson {
  id: string; moduleId: string; title: string; order: number;
  isCompleted: boolean; isLocked: boolean;
  evaluationStatus?: "pending" | "needs_revision" | null;
}
export interface LockModule { id: string; title: string; level?: number; isLocked: boolean }

export type LessonState = "completed" | "awaiting_review" | "needs_revision" | "open" | "locked";
export const isReviewLesson = (l: Pick<LockLesson, "order">) => l.order >= 999;

export function lessonState(l: LockLesson): LessonState {
  if (l.isCompleted) return "completed";
  if (l.evaluationStatus === "needs_revision") return "needs_revision";
  if (l.evaluationStatus === "pending") return "awaiting_review";
  return l.isLocked ? "locked" : "open";
}

export interface NextAction {
  kind: "open_lesson" | "fix_revision" | "wait_for_review" | "done";
  lessonId?: string;
  label: string;
}

export interface LockExplanation {
  locked: boolean;
  headline: string;
  /** Plain-language reasons, in order. */
  reasons: string[];
  /** What is still required, each with its current state. */
  remaining: { lesson: LockLesson; state: LessonState }[];
  next: NextAction;
}

const byOrder = (a: LockLesson, b: LockLesson) => a.order - b.order;

/**
 * The next lesson a learner should open in a set of modules (in course
 * order): a lesson returned for revision first, else the first open lesson
 * not yet completed or waiting for review. Never a locked lesson.
 */
export function nextAction(modules: LockModule[], lessons: LockLesson[]): NextAction {
  const ordered = modules.flatMap((m) => lessons.filter((l) => l.moduleId === m.id).sort(byOrder));
  const revision = ordered.find((l) => lessonState(l) === "needs_revision");
  if (revision) return { kind: "fix_revision", lessonId: revision.id, label: `Revise "${revision.title}"` };
  const open = ordered.find((l) => lessonState(l) === "open");
  if (open) return { kind: "open_lesson", lessonId: open.id, label: `Continue: ${open.title}` };
  if (ordered.some((l) => lessonState(l) === "awaiting_review")) return { kind: "wait_for_review", label: "Waiting for peer review" };
  return { kind: "done", label: ordered.length ? "All lessons complete" : "No lessons yet" };
}

function stateNote(s: LessonState): string {
  return s === "awaiting_review" ? "submitted — waiting for peer review"
    : s === "needs_revision" ? "returned for revision"
    : s === "open" ? "not finished yet"
    : s === "locked" ? "locked" : "completed";
}

/**
 * Why `lesson` is locked. `moduleLessons` = all lessons of its module;
 * `previousModule` / `previousModuleLessons` = the module before it in the
 * course (when known — otherwise the reason is stated without its name).
 */
export function explainLessonLock(input: {
  lesson: LockLesson;
  module: LockModule;
  moduleLessons: LockLesson[];
  previousModule?: LockModule | null;
  previousModuleLessons?: LockLesson[];
}): LockExplanation {
  const { lesson, module, previousModule } = input;
  const inModule = [...input.moduleLessons].sort(byOrder);
  if (!lesson.isLocked && !module.isLocked) {
    return { locked: false, headline: "This lesson is open", reasons: [], remaining: [], next: { kind: "open_lesson", lessonId: lesson.id, label: `Open: ${lesson.title}` } };
  }

  // 1) The whole module is locked: the previous module isn't finished.
  if (module.isLocked) {
    const prev = [...(input.previousModuleLessons ?? [])].sort(byOrder);
    const notDone = prev.filter((l) => !l.isCompleted);
    const done = prev.length - notDone.length;
    const reasons = [
      previousModule
        ? `"${module.title}" opens when every lesson of "${previousModule.title}" is complete.`
        : `"${module.title}" opens when every lesson of the previous module is complete.`,
    ];
    if (prev.length) reasons.push(`${done} of ${prev.length} lessons complete — ${notDone.length} to go.`);
    if (notDone.some((l) => lessonState(l) === "awaiting_review")) reasons.push("Submitted lessons count once a peer reviewer approves them.");
    return {
      locked: true,
      headline: previousModule ? `Finish "${previousModule.title}" first` : "Finish the previous module first",
      reasons,
      remaining: notDone.map((l) => ({ lesson: l, state: lessonState(l) })),
      next: previousModule ? nextAction([previousModule], prev) : { kind: "done", label: "Open the previous module" },
    };
  }

  // 2) The module's Discussion & Review lesson: every earlier lesson approved.
  const idx = inModule.findIndex((l) => l.id === lesson.id);
  const earlier = idx >= 0 ? inModule.slice(0, idx) : inModule.filter((l) => l.order < lesson.order);
  if (isReviewLesson(lesson)) {
    const notDone = earlier.filter((l) => !l.isCompleted);
    const reasons = [`"${lesson.title}" opens when every other lesson in "${module.title}" is complete.`,
      `${earlier.length - notDone.length} of ${earlier.length} complete — ${notDone.length} to go.`];
    if (notDone.some((l) => lessonState(l) === "awaiting_review")) reasons.push("Submitted lessons count once a peer reviewer approves them.");
    return { locked: true, headline: `${notDone.length} lesson${notDone.length === 1 ? "" : "s"} left before the review`, reasons,
      remaining: notDone.map((l) => ({ lesson: l, state: lessonState(l) })), next: nextAction([module], inModule) };
  }

  // 3) A regular lesson: the lesson before it must be completed or submitted.
  const prev = earlier[earlier.length - 1];
  if (!prev) {
    return { locked: true, headline: "This lesson will open soon", reasons: ["Its module is still opening — refresh and try again."], remaining: [], next: nextAction([module], inModule) };
  }
  const prevState = lessonState(prev);
  const reasons = [`"${lesson.title}" opens when you finish "${prev.title}" (${stateNote(prevState)}).`,
    "Finishing means answering and submitting every question — approval isn't needed to move on."];
  return { locked: true, headline: `Finish "${prev.title}" first`, reasons,
    remaining: [{ lesson: prev, state: prevState }], next: nextAction([module], inModule) };
}

/** Real progress for a set of lessons: completed (approved) and submitted counts. */
export function progressSummary(lessons: LockLesson[]) {
  const total = lessons.length;
  const completed = lessons.filter((l) => l.isCompleted).length;
  const awaiting = lessons.filter((l) => lessonState(l) === "awaiting_review").length;
  return { total, completed, awaiting, pct: total ? Math.round((completed / total) * 100) : 0 };
}

/**
 * Why a whole module is locked, from module-level counts only (the course
 * outline screen): the previous module's completed / total lessons.
 */
export function explainModuleLock(module: { title: string; isLocked: boolean },
  previous: { id: string; title: string; completedLessons: number; lessonCount: number; submittedLessons?: number } | null): LockExplanation & { openModuleId?: string } {
  if (!module.isLocked) return { locked: false, headline: "This module is open", reasons: [], remaining: [], next: { kind: "done", label: "Open" } };
  if (!previous) {
    return { locked: true, headline: "Finish the previous module first", reasons: [`"${module.title}" opens when the module before it is complete.`], remaining: [], next: { kind: "done", label: "Go back" } };
  }
  const left = Math.max(0, previous.lessonCount - previous.completedLessons);
  const waiting = Math.max(0, (previous.submittedLessons ?? 0) - previous.completedLessons);
  const reasons = [`"${module.title}" opens when every lesson of "${previous.title}" is complete.`,
    `${previous.completedLessons} of ${previous.lessonCount} complete — ${left} to go.`];
  if (waiting > 0) reasons.push(`${waiting} submitted lesson${waiting === 1 ? " is" : "s are"} waiting for peer review — they count once approved.`);
  return { locked: true, headline: `Finish "${previous.title}" first`, reasons, remaining: [],
    next: { kind: "open_lesson", label: `Continue "${previous.title}"` }, openModuleId: previous.id };
}
