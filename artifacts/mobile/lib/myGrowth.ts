// MY GROWTH (owner brief 2026-11-14) — pure helpers that ARRANGE what the server already verified.
// No calculation of stages, units or credit happens here: every number is read from GET /growth/me/tree
// (the same shared tree data Home and My Tree use, hooks/useGrowthTree) or GET /growth/me (the Matrix's
// requirement status). Missing values stay null ("Not available"), never a misleading zero.
import type { GrowthTree } from "@/lib/growthApi";

export type MyGrowthSection = "tree" | "roots" | "application" | "contributions" | "consistency" | "journey";
export const MY_GROWTH_SECTIONS: MyGrowthSection[] = ["tree", "roots", "application", "contributions", "consistency", "journey"];
export const isMyGrowthSection = (s: unknown): s is MyGrowthSection => MY_GROWTH_SECTIONS.includes(s as MyGrowthSection);

export interface SummaryRow { key: "stage" | "foundations" | "units" | "practical" | "contributions" | "pending" | "activeWeeks"; value: string | number | null; passed?: number; total?: number }

/** The Tree Summary, straight from the verified records (null = not available, shown as such). */
export function treeSummary(t: GrowthTree | null): SummaryRow[] {
  if (!t) return [];
  const cf = t.roots?.coreLessons;
  return [
    { key: "stage", value: t.stage?.name ?? null },
    { key: "foundations", value: cf && cf.total > 0 ? `${cf.passed}/${cf.total}` : null, passed: cf?.passed, total: cf?.total },
    { key: "units", value: t.roots?.learningUnits ?? null },
    { key: "practical", value: t.stems?.practicalActions ?? null },
    { key: "contributions", value: t.fruitTotals?.verified ?? null },
    { key: "pending", value: t.fruitTotals?.pendingReview ?? null },
    { key: "activeWeeks", value: t.consistency?.activeWeeks ?? t.roots?.activeWeeks ?? null },
  ];
}

/** A tap on the 3D tree → the ledger record it stands for ("fruit:<id>" / "bud:<id>"), or null. */
export function recordFromSelection(id: string | null): { kind: "fruit" | "bud"; evidenceId: string } | null {
  if (!id) return null;
  const m = /^(fruit|bud):(.+)$/.exec(id);
  return m ? { kind: m[1] as "fruit" | "bud", evidenceId: m[2] } : null;
}

// ── Growth Story: recorded events in SEPARATE kinds, each with its real date and source record ──────────
export type StoryKind = "stage" | "learning" | "application" | "fruit" | "botany";
export interface StoryEvent { date: string; kind: StoryKind; ref: string; stage?: number; units?: number; title?: string; detail?: string; legacy?: boolean }

export function storyEvents(t: GrowthTree | null): StoryEvent[] {
  if (!t) return [];
  const e: StoryEvent[] = [];
  // A. Official stage changes (p2p_growth_history).
  for (const h of t.history ?? []) e.push({ date: h.achievedAt.slice(0, 10), kind: "stage", ref: `stage:${h.stage}`, stage: h.stage, title: h.name, legacy: h.kind === "legacy_import" });
  // B. Learning milestones: the dated pass that made the 1st, 10th, 20th… unique unit (server-computed).
  for (const m of t.learningMilestones ?? []) e.push({ date: m.date, kind: "learning", ref: `units:${m.units}`, units: m.units });
  // C. Verified application (one per ledger record; awaiting/withdrawn never appear here).
  for (const a of t.application ?? []) if (a.countsTowardMilestone) e.push({ date: a.date, kind: "application", ref: a.id, title: a.label, detail: a.areaLabel });
  // D. Verified contributions (one fruit per record; a group session is one).
  for (const f of t.fruits ?? []) if (f.countsTowardMilestone) e.push({ date: f.date, kind: "fruit", ref: f.id, title: f.label, detail: `${f.areaLabel}${f.kind === "group" ? " · group" : ""}` });
  // E. Botanical: the first fruit (appearance only — dated by that fruit's record).
  const first = (t.fruits ?? []).filter((f) => f.countsTowardMilestone).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0];
  if (first) e.push({ date: first.date, kind: "botany", ref: `first-fruit:${first.id}` });
  return e.sort((a, b) => b.date.localeCompare(a.date) || a.ref.localeCompare(b.ref));
}
