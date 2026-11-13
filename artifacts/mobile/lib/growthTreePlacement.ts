// MY GROWTH TREE — where each attachment of a composition plan (lib/growthTreeComposition.ts) sits on
// the 3D body. The bodies are single fused meshes with no authored sockets, so anchor points were
// computed ONCE from each body's real branch surface (outer canopy, 12 sectors around the trunk,
// ordered by distance from it) and shipped beside the model as "<body>.anchors.json".
//
// Every position depends ONLY on that attachment's own stable id and slot — never on how many other
// attachments there are — so the same data always gives the same tree and a new fruit never moves an
// old one (two may share an anchor; each has its own small offset).
import type { TreePlan, AttachKind } from "@/lib/growthTreeComposition";
import { unitHash, BRANCHES } from "@/lib/growthTreeComposition";

export interface BodyAnchors {
  /** Base of the trunk axis [x, minY, z] in the body's own coordinates. */
  trunk: [number, number, number];
  height: number;
  rMax: number;
  /** Per sector: points [x, y, z, nx, ny, nz], nearest the trunk first. */
  sectors: number[][][];
}
/** One placed copy: position, outward normal, size (body heights) and turn. */
export interface Placement { id: string; asset: string; p: [number, number, number]; n: [number, number, number]; size: number; yaw: number; hang: boolean }

/** Size of each kind, as a share of the body's height (botanical proportion, kept legible on a phone). */
export const KIND_SIZE: Record<AttachKind, number> = {
  fruit: 0.05, fruit_bud: 0.03, blossom: 0.06, leaf_cluster: 0.1, branch: 0.06, root_tip: 0.06, green_tip: 0.035, shoot_tip: 0.045, seed: 0.03,
};
/** Leaves are drawn with the small-cluster part (an extra asset); hanging kinds hang below their anchor. */
export const LEAF_ASSET = "extra-leaf-cluster-small";
const HANGS: AttachKind[] = ["fruit", "fruit_bud"];

/** `bodyHasFoliage`: the stage body already carries its own leaves (all current v2 bodies do — "Bare"
 *  in their names means "without fruit"), so leaf clusters are not added on top of them. */
export function placeTree(plan: TreePlan, a: BodyAnchors, opts: { bodyHasFoliage?: boolean } = {}): Placement[] {
  const S = a.sectors.length, H = a.height;
  const out: Placement[] = [];
  const at = (id: string, kind: AttachKind, asset: string, slot: { branch: number; along: number; around: number }, branches: number) => {
    // A plan branch maps to a sector spread evenly around the trunk; "along" picks the point outward.
    const sector = ((Math.round((slot.branch * S) / Math.max(1, branches)) % S) + S) % S;
    const pts = a.sectors[sector].length ? a.sectors[sector] : a.sectors.find((s) => s.length) ?? [];
    if (!pts.length) return;
    const pt = pts[Math.min(pts.length - 1, Math.floor(slot.along * pts.length))];
    const size = KIND_SIZE[kind] * H, j = (k: number) => (unitHash(id, 10 + k) - 0.5) * size * 0.6;
    const hang = HANGS.includes(kind);
    out.push({ id, asset, size, yaw: slot.around * Math.PI * 2, hang,
      p: [pt[0] + pt[3] * size * 0.3 + j(0), pt[1] + (hang ? -size * 0.45 : 0) + j(1), pt[2] + pt[5] * size * 0.3 + j(2)], n: [pt[3], pt[4], pt[5]] });
  };
  // The stage's fixed branch count (never derived from the other attachments — positions stay independent).
  const branches = Math.max(1, BRANCHES[plan.stage] ?? 1);
  for (const x of plan.attachments) {
    if (x.kind === "root_tip") {
      // Root tip: at the lowest point of the trunk axis, where the body's own roots end (never floating beside it).
      const ang = x.slot.around * Math.PI * 2, size = KIND_SIZE.root_tip * H;
      out.push({ id: x.id, asset: x.asset, size, yaw: ang, hang: false, p: [a.trunk[0], a.trunk[1] + size * 0.5, a.trunk[2]], n: [0, -1, 0] });
    } else if (x.kind === "branch" && plan.stage < 3) {
      // A woody fruiting spur belongs to a tree, not a seed or a seedling (the area still counts in the plan).
    } else at(x.id, x.kind, x.asset, x.slot, branches);
  }
  if (!opts.bodyHasFoliage) for (let i = 0; i < plan.leafClusters; i++) {
    const id = `leaf:${i}`;
    at(id, "leaf_cluster", LEAF_ASSET, { branch: Math.floor(unitHash(id, 1) * S), along: 0.2 + unitHash(id, 2) * 0.8, around: unitHash(id, 3) }, S);
  }
  return out;
}

/** Group placements per asset for instanced drawing: { asset: [[x,y,z,nx,ny,nz,size,yaw,hang], …] }. */
export function instancesByAsset(ps: Placement[]): Record<string, number[][]> {
  const g: Record<string, number[][]> = {};
  for (const p of ps) (g[p.asset] ??= []).push([...p.p, ...p.n, p.size, p.yaw, p.hang ? 1 : 0].map((v) => Math.round(v * 1e5) / 1e5));
  return g;
}
