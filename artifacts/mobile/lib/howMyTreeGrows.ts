// HOW MY TREE GROWS (owner brief 2026-11-14) — the apple tree's complete natural development, each step
// explained as part of the person's OWN growth journey, with their real, verified progress beside it.
//
// Three things are kept apart and never merged:
//   • the Growth Matrix decides the stage (GET /growth/me: `next` and `later` are the ENGINE's checklists;
//     nothing here calculates eligibility, a unit, a credit or a stage);
//   • the person's verified records (GET /growth/me/tree, the SAME shared data Home and My Tree use);
//   • the botanical lifecycle (lib/botanicalLifecycle.ts) — every existing step is kept. Its steps are
//     illustrations, never extra stages, and opening one never marks anything achieved.
// Every personal line comes from a server value; when that value isn't known the answer is "unknown",
// never a made-up zero. All wording lives in locales/en.json (treeGrows.*); this module returns keys.
import { APPLE_LIFECYCLE } from "@/lib/botanicalLifecycle";
import type { GrowthDimension, GrowthJourney, GrowthTree } from "@/lib/growthApi";
import type { TreePlan } from "@/lib/growthTreeComposition";

export type Dimension = GrowthDimension["dimension"];
/** achieved = supported by verified records · in_progress = some qualifying evidence, not yet enough ·
 *  upcoming = nothing yet · now / not_now = something the tree shows only while it is true (recent growth,
 *  awaiting verification) · season = nature's rhythm, never a loss · unknown = the data isn't available. */
export type PersonalState = "achieved" | "in_progress" | "upcoming" | "now" | "not_now" | "season" | "unknown";
export interface PersonalLine { key: string; params?: Record<string, string | number> }
export interface Personal { state: PersonalState; lines: PersonalLine[] }

/** Which Growth Matrix dimension(s) each lifecycle step illustrates (asset id → dimensions). */
export const STEP_DIMENSIONS: Record<string, Dimension[]> = {
  "asset-00-germinating-seed": ["consistency", "learning"],
  "asset-micro-5-active-root-tip": ["learning"],
  "extra-roots-young": ["learning"],
  "extra-roots-established": ["learning"],
  "extra-roots-deep": ["learning"],
  "asset-micro-6-dormant-winter-bud": ["consistency"],
  "asset-micro-1-green-tip-bud": ["service"],
  "asset-micro-3-unfurling-shoot-tip": ["consistency", "learning", "application", "service"],
  "asset-06-fruiting-spur-socket": ["application", "service"],
  "asset-07-single-leaf-particle": ["consistency"],
  "extra-leaf-cluster-small": ["consistency"],
  "extra-leaf-cluster-dense": ["consistency"],
  "asset-micro-9-golden-autumn-leaf": ["consistency"],
  "asset-micro-2-pink-bud-cluster": ["consistency", "learning", "application", "service"],
  "asset-micro-7-balloon-stage-bud": ["service"],
  "asset-apple-blossoms": ["consistency", "learning", "application", "service"],
  "asset-micro-4-petal-fall-fruitlet": ["service"],
  "asset-apple-stage-1-fruitlet": ["service"],
  "asset-micro-8-june-drop-fruitlet": ["service"],
  "asset-04c-young-green-applelet": ["service"],
  "asset-apple-stage-2-green": ["service"],
  "asset-apple-stage-3-yellow-green": ["service"],
  "asset-apple-stage-4-golden-yellow": ["service"],
  "asset-04d-blushed-apple": ["service"],
  "asset-apple-stage-5-ripe-red": ["service"],
  "asset-apple-stage-6-striped-red": ["service"],
};

/** A translation key for a lifecycle step ("asset-micro-5-active-root-tip" → "asset_micro_5_active_root_tip"). */
export const stepKey = (asset: string) => asset.replace(/[^a-z0-9]+/gi, "_");
/** Every step of the existing lifecycle, in order — the complete process, nothing dropped. */
export const ALL_STEPS = APPLE_LIFECYCLE.flatMap((s) => s.items.map((i) => ({ section: s.id, asset: i.asset })));

export interface TreeGrowsData { journey: GrowthJourney | null; tree: GrowthTree | null; plan: TreePlan | null }

interface Req { key: string; have: number; need: number; met: boolean }
/** The engine's requirement `key` for reaching `stage` (from `next` / `later`), or null when not sent. */
function engineReq(j: GrowthJourney | null, stage: number, key: string): Req | null {
  const s = j?.next?.stage === stage ? j.next : (j?.later ?? []).find((x) => x.stage === stage);
  const item = s?.dimensions.flatMap((d) => d.items).find((i) => i.key === key);
  return item ? { key, have: item.have, need: item.need, met: item.met } : null;
}
const stageName = (j: GrowthJourney | null, stage: number) =>
  j?.next?.stage === stage ? j.next.name : (j?.later ?? []).find((x) => x.stage === stage)?.name ?? (j?.history ?? []).find((h) => h.stage === stage)?.name ?? String(stage);

/** Where the person stands on one Matrix requirement for one stage — always the engine's own numbers. */
function stageReq(d: TreeGrowsData, stage: number, key: string): Personal {
  const j = d.journey;
  if (!j) return { state: "unknown", lines: [{ key: "treeGrows.personal.unknown" }] };
  const name = stageName(j, stage);
  if (j.stage.stage >= stage) {
    const h = j.history.find((x) => x.stage === stage);
    return { state: "achieved", lines: [h ? { key: h.kind === "legacy_import" ? "treeGrows.personal.partOfStageLegacy" : "treeGrows.personal.partOfStage", params: { stage: name, date: h.achievedAt.slice(0, 10) } }
      : { key: "treeGrows.personal.partOfStageUndated", params: { stage: name } }] };
  }
  const r = engineReq(j, stage, key);
  if (!r) return { state: "unknown", lines: [{ key: "treeGrows.personal.notInChecklist", params: { stage: name } }] };
  const line: PersonalLine = { key: `treeGrows.req.${key}`, params: { have: Math.min(r.have, r.need), need: r.need, remaining: Math.max(0, r.need - r.have), stage: name } };
  if (r.met) return { state: "achieved", lines: [line, { key: "treeGrows.personal.metOthersStill", params: { stage: name } }] };
  return { state: r.have > 0 ? "in_progress" : "upcoming", lines: [line] };
}
/** Several requirements as one step: achieved only when all are; in progress when any has started. */
function combine(parts: Personal[]): Personal {
  const lines = parts.flatMap((p) => p.lines);
  const states = parts.map((p) => p.state);
  if (states.includes("unknown")) return { state: states.every((s) => s === "unknown") ? "unknown" : "in_progress", lines };
  if (states.every((s) => s === "achieved")) return { state: "achieved", lines: dedupe(lines) };
  return { state: states.some((s) => s === "achieved" || s === "in_progress") ? "in_progress" : "upcoming", lines: dedupe(lines) };
}
const dedupe = (lines: PersonalLine[]) => lines.filter((l, i) => lines.findIndex((x) => JSON.stringify(x) === JSON.stringify(l)) === i);
/** The first of several stage tiers not yet achieved (or the last, when all are). */
function firstOpen(parts: Personal[]): Personal { return parts.find((p) => p.state !== "achieved") ?? parts[parts.length - 1]; }

const verifiedFruit = (t: GrowthTree) => (t.fruits ?? []).filter((f) => f.countsTowardMilestone).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
const unknown: Personal = { state: "unknown", lines: [{ key: "treeGrows.personal.unknown" }] };

/** The person's own progress for one lifecycle step. Pure; every number is a server value. */
export function personalFor(asset: string, d: TreeGrowsData): Personal {
  const t = d.tree, j = d.journey;
  const has = (kind: string) => !!d.plan?.attachments.some((a) => a.kind === kind);
  switch (asset) {
    // ── Roots: learning ──
    case "asset-00-germinating-seed": {
      if (!t) return unknown;
      const first = t.consistency?.firstActivityAt ?? null;
      return first ? { state: "achieved", lines: [{ key: "treeGrows.personal.journeyBegan", params: { date: first.slice(0, 10) } }] }
        : { state: "upcoming", lines: [{ key: "treeGrows.personal.journeyBegins" }] };
    }
    case "asset-micro-5-active-root-tip": {
      if (!t) return unknown;
      const m = (t.learningMilestones ?? []).find((x) => x.units === 1);
      if (m) return { state: "achieved", lines: [{ key: "treeGrows.personal.firstUnit", params: { date: m.date } }] };
      return t.roots.learningUnits > 0 ? { state: "achieved", lines: [{ key: "treeGrows.personal.unitsPassed", params: { count: t.roots.learningUnits } }] }
        : { state: "upcoming", lines: [{ key: "treeGrows.personal.firstUnitNext" }] };
    }
    case "extra-roots-young": return stageReq(d, 2, "learning_units");
    case "extra-roots-established": return firstOpen([stageReq(d, 3, "learning_units"), stageReq(d, 4, "learning_units")]);
    case "extra-roots-deep": {
      const p = combine([stageReq(d, 5, "learning_units"), stageReq(d, 5, "core_curriculum_complete")]);
      const core = t?.roots.coreLessons;
      return core && core.total > 0 && !(j && j.stage.stage >= 5) ? { ...p, lines: [...p.lines, { key: "treeGrows.personal.core", params: { passed: core.passed, total: core.total } }] } : p;
    }
    // ── Buds and shoots ──
    case "asset-micro-6-dormant-winter-bud":
      return { state: "season", lines: [{ key: j?.verified?.pausedNow || t?.consistency?.pausedNow ? "treeGrows.personal.pausedNow" : "treeGrows.personal.restNeverLoss" }] };
    case "asset-micro-1-green-tip-bud":
      if (!d.plan) return unknown;
      return has("green_tip") ? { state: "now", lines: [{ key: "treeGrows.personal.greenTipNow" }] } : { state: "not_now", lines: [{ key: "treeGrows.personal.greenTipNotNow" }] };
    case "asset-micro-3-unfurling-shoot-tip": {
      if (!d.plan || !t) return unknown;
      const last = [...(t.history ?? [])].sort((a, b) => a.achievedAt.localeCompare(b.achievedAt)).pop();
      return has("shoot_tip") && last ? { state: "now", lines: [{ key: "treeGrows.personal.shootNow", params: { stage: last.name, date: last.achievedAt.slice(0, 10) } }] }
        : { state: "not_now", lines: [{ key: "treeGrows.personal.shootNotNow" }] };
    }
    case "asset-06-fruiting-spur-socket": {
      if (!t) return unknown;
      const areas = (t.branches ?? []).filter((b) => b.verified > 0);
      return areas.length ? { state: "achieved", lines: [{ key: "treeGrows.personal.areas", params: { count: areas.length, areas: areas.map((a) => a.label).join(", ") } }] }
        : { state: "upcoming", lines: [{ key: "treeGrows.personal.areasNone" }] };
    }
    // ── Leaves: consistency ──
    case "asset-07-single-leaf-particle": {
      if (!t) return unknown;
      const weeks = t.consistency?.activeWeeks ?? t.roots.activeWeeks;
      if (weeks === null || weeks === undefined) return unknown;
      return weeks > 0 ? { state: "achieved", lines: [{ key: "treeGrows.personal.activeWeeks", params: { count: weeks } }] } : { state: "upcoming", lines: [{ key: "treeGrows.personal.firstWeekNext" }] };
    }
    case "extra-leaf-cluster-small": return stageReq(d, 2, "active_weeks");
    case "extra-leaf-cluster-dense": return firstOpen([stageReq(d, 3, "active_weeks_window"), stageReq(d, 4, "active_weeks_window")]);
    case "asset-micro-9-golden-autumn-leaf": return { state: "season", lines: [{ key: "treeGrows.personal.seasonNeverLoss" }] };
    // ── Blossom: the whole next stage ──
    case "asset-micro-2-pink-bud-cluster": {
      if (!j) return unknown;
      if (!j.next) return { state: "achieved", lines: [{ key: "treeGrows.personal.highestStage" }] };
      const items = j.next.dimensions.filter((x) => x.required).flatMap((x) => x.items);
      const met = items.filter((i) => i.met).length;
      return { state: met === items.length && items.length ? "achieved" : met || items.some((i) => i.have > 0) ? "in_progress" : "upcoming",
        lines: [{ key: "treeGrows.personal.requirementsMet", params: { met, total: items.length, stage: j.next.name } }] };
    }
    case "asset-micro-7-balloon-stage-bud": {
      if (!t) return unknown;
      const n = t.fruitTotals?.pendingReview ?? 0;
      return n > 0 ? { state: "now", lines: [{ key: "treeGrows.personal.awaiting", params: { count: n } }] } : { state: "not_now", lines: [{ key: "treeGrows.personal.awaitingNone" }] };
    }
    case "asset-apple-blossoms": {
      if (!j) return unknown;
      if (!j.next) return { state: "achieved", lines: [{ key: "treeGrows.personal.highestStage" }] };
      const dims = j.next.dimensions.filter((x) => x.required);
      const met = dims.filter((x) => x.met).length;
      return { state: met === dims.length && dims.length ? "achieved" : "in_progress",
        lines: [{ key: "treeGrows.personal.dimensionsMet", params: { met, total: dims.length, stage: j.next.name } }] };
    }
    case "asset-micro-4-petal-fall-fruitlet": {
      if (!t) return unknown;
      const any = (t.fruits ?? []).filter((f) => f.status === "verified" || f.status === "pending_review").sort((a, b) => a.date.localeCompare(b.date))[0];
      return any ? { state: "achieved", lines: [{ key: "treeGrows.personal.firstContributionRecorded", params: { date: any.date } }] } : { state: "upcoming", lines: [{ key: "treeGrows.personal.firstContributionNext" }] };
    }
    // ── Fruit: service & contribution ──
    case "asset-apple-stage-1-fruitlet": {
      if (!t) return unknown;
      const first = verifiedFruit(t)[0];
      return first ? { state: "achieved", lines: [{ key: "treeGrows.personal.firstFruit", params: { label: first.label, date: first.date } }] } : { state: "upcoming", lines: [{ key: "treeGrows.personal.firstFruitNext" }] };
    }
    case "asset-micro-8-june-drop-fruitlet": return { state: "season", lines: [{ key: "treeGrows.personal.juneDrop" }] };
    case "asset-04c-young-green-applelet": return stageReq(d, 2, "contributions");
    case "asset-apple-stage-2-green": return stageReq(d, 3, "contributions");
    case "asset-apple-stage-3-yellow-green": return combine([stageReq(d, 4, "contributions"), stageReq(d, 4, "learners_supported_developed"), stageReq(d, 4, "second_generation_contributors")]);
    case "asset-apple-stage-4-golden-yellow": return combine([stageReq(d, 5, "contributions"), stageReq(d, 5, "learners_supported_developed"), stageReq(d, 5, "second_generation_sustained")]);
    // Ripe, blushed and striped are the ripe varieties already on the tree: one per verified contribution.
    // Which variety a fruit shows carries no meaning (lib/growthTreeComposition.ts).
    case "asset-04d-blushed-apple": case "asset-apple-stage-5-ripe-red": case "asset-apple-stage-6-striped-red": {
      if (!t) return unknown;
      const fruit = verifiedFruit(t);
      const last = fruit[fruit.length - 1];
      return last ? { state: "achieved", lines: [{ key: "treeGrows.personal.ripeFruit", params: { count: fruit.length, label: last.label, date: last.date } }] }
        : { state: "upcoming", lines: [{ key: "treeGrows.personal.firstFruitNext" }] };
    }
  }
  return unknown;
}

// ── Sections 2–4: achieved, growing now, next ──
export interface BoardItem { dimension: Dimension | "stage"; key: string; params?: Record<string, string | number>; date?: string | null }
export interface Board { achieved: BoardItem[]; growing: BoardItem[]; next: { dimension: Dimension; label: string; met: boolean; required: boolean; items: { label: string; have: number; need: number; met: boolean; missing: string | null; explanation: string | null }[] }[]; nextStage: string | null; available: boolean }

/** What the person has achieved, what is growing now and what the next stage needs — all from the server. */
export function milestoneBoard(d: TreeGrowsData): Board {
  const j = d.journey, t = d.tree;
  const achieved: BoardItem[] = [], growing: BoardItem[] = [];
  if (!j && !t) return { achieved, growing, next: [], nextStage: null, available: false };
  for (const h of [...(j?.history ?? t?.history ?? [])].sort((a, b) => a.achievedAt.localeCompare(b.achievedAt)))
    achieved.push({ dimension: "stage", key: h.kind === "legacy_import" ? "treeGrows.board.stageLegacy" : "treeGrows.board.stage", params: { stage: h.name }, date: h.achievedAt.slice(0, 10) });
  if (t) {
    if (t.consistency?.firstActivityAt) achieved.push({ dimension: "consistency", key: "treeGrows.board.journeyBegan", date: t.consistency.firstActivityAt.slice(0, 10) });
    const weeks = t.consistency?.activeWeeks ?? t.roots.activeWeeks;
    if (weeks) achieved.push({ dimension: "consistency", key: "treeGrows.board.activeWeeks", params: { count: weeks } });
    for (const m of t.learningMilestones ?? []) achieved.push({ dimension: "learning", key: "treeGrows.board.unitsMilestone", params: { count: m.units }, date: m.date });
    if (t.roots.coreLessons.total > 0 && t.roots.coreLessons.passed > 0) achieved.push({ dimension: "learning", key: "treeGrows.board.core", params: { passed: t.roots.coreLessons.passed, total: t.roots.coreLessons.total } });
    const app = (t.application ?? []).filter((a) => a.countsTowardMilestone).sort((a, b) => a.date.localeCompare(b.date));
    if (app.length) achieved.push({ dimension: "application", key: "treeGrows.board.practical", params: { count: app.length }, date: app[0].date });
    else if (t.stems.practicalActions) achieved.push({ dimension: "application", key: "treeGrows.board.practical", params: { count: t.stems.practicalActions } });
    const fruit = verifiedFruit(t);
    if (fruit.length) achieved.push({ dimension: "service", key: "treeGrows.board.fruit", params: { count: fruit.length }, date: fruit[0].date });
    const pendingFruit = t.fruitTotals?.pendingReview ?? 0;
    if (pendingFruit) growing.push({ dimension: "service", key: "treeGrows.board.awaitingFruit", params: { count: pendingFruit } });
    const pendingApp = (t.application ?? []).filter((a) => a.status === "pending_review").length;
    if (pendingApp) growing.push({ dimension: "application", key: "treeGrows.board.awaitingApplication", params: { count: pendingApp } });
    if (d.plan?.attachments.some((a) => a.kind === "green_tip")) growing.push({ dimension: "service", key: "treeGrows.board.recentFruit" });
    if (d.plan?.attachments.some((a) => a.kind === "shoot_tip")) growing.push({ dimension: "stage", key: "treeGrows.board.recentStage" });
  }
  const next = (j?.next?.dimensions ?? []).map((x) => ({ dimension: x.dimension, label: x.label, met: x.met, required: x.required,
    items: x.items.map((i) => ({ label: i.label, have: Math.min(i.have, i.need), need: i.need, met: i.met, missing: i.missing ?? null, explanation: i.explanation ?? null })) }));
  for (const x of next) for (const i of x.items) {
    if (i.met) achieved.push({ dimension: x.dimension, key: "treeGrows.board.requirementMet", params: { label: i.label, stage: j!.next!.name } });
    else if (i.have > 0) growing.unshift({ dimension: x.dimension, key: "treeGrows.board.requirementGrowing", params: { label: i.label, have: i.have, need: i.need, remaining: i.need - i.have } });
  }
  return { achieved, growing, next, nextStage: j?.next?.name ?? null, available: true };
}

/** Existing destinations that genuinely help with each dimension — matched to the evidence types the
 *  engine actually counts (migration 239, p2p_growth_evidence_types). Routes that exist in the app. */
export const CONTINUE_LINKS: { dimension: Dimension; key: string; route: string; icon: string }[] = [
  // learning.assessment_passed — a lesson, story chapter or plan session, once its assessment is passed.
  { dimension: "learning", key: "coreFoundations", route: "/core-foundations", icon: "school-outline" },
  { dimension: "learning", key: "kingdomStories", route: "/kingdom-stories", icon: "book-outline" },
  { dimension: "learning", key: "plans", route: "/plans", icon: "calendar-outline" },
  // application.practical_answer_approved / group_practical_reviewed.
  { dimension: "application", key: "practical", route: "/core-foundations", icon: "hand-left-outline" },
  { dimension: "application", key: "family", route: "/family", icon: "home-outline" },
  // service.learning_feedback / shared_study_facilitated.
  { dimension: "service", key: "evaluations", route: "/evaluation", icon: "chatbubbles-outline" },
  { dimension: "service", key: "studyTogether", route: "/study-together", icon: "people-outline" },
  // consistency.scripture_listening — recorded by the server; screen views never count.
  { dimension: "consistency", key: "listen", route: "/bible", icon: "headset-outline" },
];
