// BOTANICAL DEVELOPMENT (owner brief 2026-11-13) — what a person's tree LOOKS like, kept apart from their
// participant GROWTH STAGE.
//
//   • Growth Stage (Seed, Sprout, Young Tree, Fruitful Tree, Forest Builder; Forest of Nations is collective)
//     comes only from the Growth Milestone Matrix on the server. Nothing here reads or changes it.
//   • Botanical development describes the features the tree composition already draws from VERIFIED data
//     (lib/growthTreeComposition.ts): fruit (one per verified contribution), closed buds (awaiting
//     verification — not fruit), new growth / a new shoot (recent verified evidence or milestone), roots
//     (learning), fruiting branches (areas with verified evidence), foliage (weeks of taking part).
//     No schedule, no timer, no points; it never awards anything and never counts toward a milestone.
//   • The apple's own lifecycle (blossom, fruitlet, green → golden → ripe, seasons) is taught separately
//     (lib/botanicalLifecycle.ts) and is never applied to a person's tree on a schedule.
import type { TreePlan } from "@/lib/growthTreeComposition";

/** What each stage's own Meshy model shows (its fixed appearance, not an achievement). */
export const STAGE_APPEARANCE = [
  "A germinating seed sending down its first root",
  "A seedling with its first leaves above a fan of fine roots",
  "A young tree: slender trunk, open branches and fresh leaves",
  "A mature apple tree with a full canopy and spreading roots",
  "A veteran apple tree: broad trunk, rich foliage and deep foundation roots",
] as const;

export type BotanicalFeatureId = "fruit" | "buds" | "new_growth" | "new_shoot" | "roots" | "branches" | "foliage" | "seeds";
export interface BotanicalFeature {
  id: BotanicalFeatureId;
  /** Short, for the summary line ("6 fruit"). */
  label: string;
  /** What it stands for — always the record type, never a judgement. */
  explains: string;
  count?: number;
  /** The registry asset that draws it, or null when it is part of the stage model / not drawn. */
  asset: string | null;
}
export interface BotanicalDevelopment {
  /** The stage model's own appearance. */
  appearance: string;
  features: BotanicalFeature[];
  /** "Botanical development: 6 fruit, 1 bud awaiting verification, roots growing". */
  summary: string;
  /** Said with it everywhere it is shown. */
  note: string;
}
export const BOTANICAL_NOTE = "How your tree looks — not a rank or a milestone. Your Growth Stage comes only from your verified milestones.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The botanical development of a person's tree, from its composition plan (null while it hasn't loaded). */
export function botanicalDevelopment(stageIndex: number, plan: TreePlan | null): BotanicalDevelopment {
  const appearance = STAGE_APPEARANCE[Math.min(4, Math.max(0, stageIndex))];
  const features: BotanicalFeature[] = [];
  if (plan) {
    const of = (k: string) => plan.attachments.filter((x) => x.kind === k);
    const fruit = of("fruit").length + (plan.fruitCluster?.count ?? 0);
    const buds = of("fruit_bud").length;
    if (fruit) features.push({ id: "fruit", label: plural(fruit, "fruit", "fruit"), count: fruit, asset: "asset-apple-stage-5-ripe-red", explains: "One fruit for each verified contribution. A group session is one fruit." });
    if (buds) features.push({ id: "buds", label: plural(buds, "bud awaiting verification", "buds awaiting verification"), count: buds, asset: "asset-micro-7-balloon-stage-bud", explains: "Contributions waiting to be verified. They are not fruit yet." });
    if (of("green_tip").length) features.push({ id: "new_growth", label: "new growth", asset: "asset-micro-1-green-tip-bud", explains: "A contribution was verified in the last two weeks." });
    if (of("shoot_tip").length) features.push({ id: "new_shoot", label: "a new shoot", asset: "asset-micro-3-unfurling-shoot-tip", explains: "You reached a new milestone in the last two weeks." });
    const root = of("root_tip")[0];
    if (root) features.push({ id: "roots", label: "roots growing", asset: "asset-micro-5-active-root-tip", explains: `From your learning: ${root.meaning}.` });
    const branches = of("branch").length;
    if (branches) features.push({ id: "branches", label: plural(branches, "fruiting branch", "fruiting branches"), count: branches, asset: "asset-06-fruiting-spur-socket", explains: "Areas of P2P where you have verified evidence." });
    if (plan.leafClusters) features.push({ id: "foliage", label: "foliage from your weeks of taking part", asset: null, explains: "Leaves fill in as you take part over time. They never thin when you rest or pause." });
    if (plan.seeds) features.push({ id: "seeds", label: plural(plan.seeds, "seed growing elsewhere", "seeds growing elsewhere"), count: plan.seeds, asset: null, explains: "People you helped who now verifiably help others." });
  }
  const summary = `Botanical development: ${features.length ? features.map((x) => x.label).join(", ") : appearance.charAt(0).toLowerCase() + appearance.slice(1)}`;
  return { appearance, features, summary, note: BOTANICAL_NOTE };
}
