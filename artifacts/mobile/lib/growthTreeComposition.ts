// MY GROWTH TREE — the deterministic composition plan (owner brief 2026-11-12, "26 botanical assets").
// Turns the VERIFIED tree data (GET /growth/me/tree) into WHAT the 3D tree shows and WHERE — the same
// data always gives the same tree (positions come from stable evidence ids, never random). Pure: the
// Three.js viewer places the plan's attachments on the body's sockets once the modular assets exist.
//
// Meaning (never a second score — only the Growth Milestone Matrix decides stages):
//   • body          ← the verified stage (Seed … Forest Builder); Forest of Nations is collective, never here;
//   • roots         ← Foundations passed/total (server) and learning units (more root detail as they grow — a view, not points);
//   • leaves        ← active weeks (canopy fills as participation accumulates; NEVER thinned by inactivity);
//   • branches      ← P2P areas with verified evidence (one per area, strongest first);
//   • fruit         ← ONE per verified contribution (ledger record id); a group session is one fruit;
//                     withdrawn / rejected → no fruit; awaiting review → a closed bud, labelled as such;
//   • seeds         ← people I helped who now verifiably help others;
//   • micro-growth  ← recent VERIFIED evidence only: a green tip / unfurling shoot for new development, an
//                     active root tip for new learning — never because time passed, never a streak;
//   • dormant bud, June-drop fruitlet, golden autumn leaf: seasonal/botanical presentation ONLY — they are
//     never used for inactivity, failure, removed fruit or lost progress (see SEASONAL_ONLY).
import type { GrowthTree } from "@/lib/growthApi";

export type AttachKind = "fruit" | "fruit_bud" | "blossom" | "leaf_cluster" | "branch" | "root_tip" | "green_tip" | "shoot_tip" | "seed";
export interface Attachment {
  /** Stable identity (evidence id, area, or counter) — the same every time the tree opens. */
  id: string;
  kind: AttachKind;
  /** The asset to use (ids from lib/growthTreeAssets.ts). */
  asset: string;
  /** Where on the body: which branch (0…), how far along it (0–1) and around it (0–1) — deterministic. */
  slot: { branch: number; along: number; around: number };
  /** What it stands for, shown when selected. */
  meaning: string;
  /** The record it comes from (fruit → its evidence id). */
  ref?: string;
}
export interface TreePlan {
  body: string;
  stage: number;
  rootDetail: 0 | 1 | 2 | 3;
  leafClusters: number;
  attachments: Attachment[];
  /** Verified fruit beyond what is drawn individually — shown as one cluster with the exact count. */
  fruitCluster: { count: number } | null;
  seeds: number;
}

/** Seasonal/botanical assets: presentation only, never driven by a participant's activity. */
export const SEASONAL_ONLY = ["asset-micro-6-dormant-winter-bud", "asset-micro-8-june-drop-fruitlet", "asset-micro-9-golden-autumn-leaf"] as const;

export const STAGE_BODIES: Record<number, string> = {
  1: "asset-00-germinating-seed", 2: "asset-02-sprout", 3: "asset-03-young-apple-tree", 4: "asset-04-fruitful-apple-tree", 5: "asset-05-forest-builder-apple-tree",
};
/** How many fruits each body can carry individually (more → one cluster with the exact count; nothing dropped). */
const FRUIT_CAPACITY: Record<number, number> = { 1: 0, 2: 0, 3: 12, 4: 40, 5: 60 };
export const BRANCHES: Record<number, number> = { 1: 0, 2: 1, 3: 5, 4: 9, 5: 12 };
/** Ripe apple variants — chosen per fruit by its id for natural variety (variety carries NO meaning).
 *  Owner 2026-11-13: a later visual ripening progression (fruitlet → green → … → ripe) is APPEARANCE ONLY —
 *  never a growth rank, and never changing a fruit's evidence status or what its contribution counts for. */
const RIPE = ["asset-apple-stage-5-ripe-red", "asset-apple-stage-6-striped-red", "asset-04d-blushed-apple"];
const RECENT_DAYS = 14;

/** Deterministic 0–1 numbers from a stable id (FNV-1a; same id → same numbers on every device). */
export function unitHash(id: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  // `^` yields a signed 32-bit int in JS: keep every step unsigned (>>> 0) so the result is always 0–1.
  h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h = (h ^ (h >>> 12)) >>> 0;
  return h / 0xffffffff;
}
const slotFor = (id: string, branches: number) => ({
  branch: branches ? Math.floor(unitHash(id, 1) * branches) : 0,
  along: 0.35 + unitHash(id, 2) * 0.6,      // fruit sits on the outer part of a branch, never the trunk
  around: unitHash(id, 3),
});
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export function composeTree(t: GrowthTree, today: string): TreePlan {
  const stage = Math.min(5, Math.max(1, t.stage.stage));
  const branches = BRANCHES[stage];
  const attachments: Attachment[] = [];

  // Branches: the P2P areas with verified evidence (only as many as the body has).
  t.branches.slice(0, branches).forEach((b, i) => attachments.push({ id: `branch:${b.area}`, kind: "branch", asset: "asset-06-fruiting-spur-socket", slot: { branch: i, along: 0.5, around: unitHash(b.area, 4) }, meaning: `${b.label}: ${b.verified} verified` }));

  // Fruit: one per verified contribution, oldest first (positions never move when new fruit arrives).
  const verified = t.fruits.filter((f) => f.countsTowardMilestone).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const cap = FRUIT_CAPACITY[stage];
  for (const f of verified.slice(0, cap)) {
    attachments.push({ id: `fruit:${f.id}`, kind: "fruit", asset: RIPE[Math.floor(unitHash(f.id, 5) * RIPE.length)], slot: slotFor(f.id, branches), ref: f.id,
      meaning: `${f.label} · ${f.date}${f.kind === "group" ? " · group session (one fruit)" : ""}` });
  }
  // Awaiting review: a closed bud — honestly not yet fruit.
  if (cap > 0) for (const f of t.fruits.filter((x) => x.status === "pending_review")) {
    attachments.push({ id: `bud:${f.id}`, kind: "fruit_bud", asset: "asset-micro-7-balloon-stage-bud", slot: slotFor(f.id, branches), ref: f.id, meaning: `${f.label} · awaiting verification (not yet fruit)` });
  }

  // Micro-growth from RECENT verified evidence only.
  const recentFruit = verified.filter((f) => daysBetween(f.date, today) <= RECENT_DAYS);
  if (recentFruit.length && branches) attachments.push({ id: "green-tip", kind: "green_tip", asset: "asset-micro-1-green-tip-bud", slot: slotFor(`tip:${recentFruit[recentFruit.length - 1].id}`, branches), meaning: "New verified contribution recently" });
  const lastStage = t.history[t.history.length - 1];
  if (lastStage && daysBetween(lastStage.achievedAt.slice(0, 10), today) <= RECENT_DAYS && branches) attachments.push({ id: "shoot-tip", kind: "shoot_tip", asset: "asset-micro-3-unfurling-shoot-tip", slot: slotFor(`shoot:${lastStage.stage}`, branches), meaning: `New milestone: ${lastStage.name}` });

  // Roots: detail grows with Foundations and learning units (never shrinks).
  // The Foundations total comes from the server (every published Foundations lesson), never a fixed number.
  const lessons = t.roots.coreLessons.passed, units = t.roots.learningUnits, total = t.roots.coreLessons.total;
  const rootDetail = (total > 0 && lessons >= total ? 3 : (total > 0 && lessons >= total / 2) || units >= 50 ? 2 : lessons > 0 || units > 0 ? 1 : 0) as TreePlan["rootDetail"];
  if (units > 0) attachments.push({ id: "root-tip", kind: "root_tip", asset: "asset-micro-5-active-root-tip", slot: { branch: 0, along: 0, around: unitHash(`roots:${units}`, 6) }, meaning: `Foundations ${lessons}/${t.roots.coreLessons.total} · ${units} learning units passed` });

  // Leaves: one cluster per two active weeks, up to what the body holds (inactivity removes none).
  const leafClusters = Math.min(branches * 8, Math.ceil(t.roots.activeWeeks / 2));

  return {
    body: STAGE_BODIES[stage], stage, rootDetail, leafClusters, attachments,
    fruitCluster: verified.length > cap && cap > 0 ? { count: verified.length - cap } : verified.length && cap === 0 ? { count: verified.length } : null,
    seeds: t.seeds.filter((s) => s.nowHelpingOthers).length,
  };
}
