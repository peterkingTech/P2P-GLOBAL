// Deterministic, seeded procedural geometry for My Tree's 2.5D scene.
// Every shape here is a pure function of stable inputs (the user's own id,
// and the tree's current stage/size numbers) — the same user always gets
// the same branch/root skeleton, and the same earned fruit always lands in
// the same place, across every app open and every re-render. Nothing here
// is randomized per-render; "randomness" is entirely seeded (deterministic)
// to produce natural-looking asymmetry, never actual Math.random().

// FNV-1a — a small, fast, deterministic string hash (same family already
// used by lib/agoraUid.ts for a different purpose; kept separate here since
// that one has Agora-specific truncation this doesn't need).
export function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32 — a tiny seeded PRNG. Given the same seed, produces the exact
// same sequence of [0,1) values every time, which is what lets the whole
// tree skeleton be "random-looking but stable."
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface BranchSegment {
  path: string;
  thickness: number;
  generation: number; // 0 = primary (off the trunk), 1 = secondary, 2 = twig
  tipX: number;
  tipY: number;
  angleDeg: number; // direction the tip is facing, for leaf/fruit orientation
}

export interface LeafCluster {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotationDeg: number;
  opacity: number;
}

export interface TreeGeometry {
  roots: string[]; // SVG path strings, fanned from the trunk base
  branches: BranchSegment[];
  leafClusters: LeafCluster[];
  // Candidate attachment points for fruit — always a real branch tip /
  // leaf-cluster location, never a floating point in empty space.
  canopyTips: { x: number; y: number; angleDeg: number }[];
}

export interface TreeGeometryParams {
  userId: string;
  stageIndex: number; // 0-7 (see constants/treeStages.ts)
  rootDepth: number; // 0-12
  trunkHeightPx: number;
  trunkWidthPx: number;
  branchCount: number; // desired primary-branch count (from canopy/mentee data)
  canopyRadius: number;
  cx: number; // trunk center x
  trunkBaseY: number; // soil line
  trunkTopY: number;
}

// How many branch "generations" (primary/secondary/twig) exist at each
// stage — matches the spec's own developmental language ("several natural
// branches" at Young Tree, "primary + secondary" at Growing Tree, "complex
// branching" from Developing Tree up).
function generationsForStage(stageIndex: number): number {
  if (stageIndex <= 2) return 1; // Seed/Root/Sprout — a stem at most, handled by caller
  if (stageIndex === 3) return 1; // Young Tree — primary branches only
  if (stageIndex <= 5) return 2; // Growing/Developing — + secondary
  return 3; // Mature/Flourishing — + twigs
}

export function generateTreeGeometry(params: TreeGeometryParams): TreeGeometry {
  const { userId, stageIndex, rootDepth, trunkHeightPx, trunkWidthPx, branchCount, canopyRadius, cx, trunkBaseY, trunkTopY } = params;
  const rand = mulberry32(fnv1a(userId));

  // ── Roots — fan from the trunk base, each with its own gentle, unequal
  // curve so the fan is never perfectly symmetric. ──
  const roots: string[] = [];
  const rootCount = Math.max(0, Math.min(12, rootDepth));
  for (let i = 0; i < rootCount; i++) {
    const t = rootCount === 1 ? 0.5 : i / (rootCount - 1);
    const baseAngle = lerp(-75, 75, t); // degrees from straight down
    const jitter = (rand() - 0.5) * 18;
    const angle = baseAngle + jitter;
    const length = lerp(30, 70, rand());
    const rad = (angle * Math.PI) / 180;
    const endX = cx + Math.sin(rad) * length;
    const endY = trunkBaseY + Math.cos(rad) * length * 0.55 + length * 0.25;
    const ctrlX = cx + Math.sin(rad) * length * 0.4 + (rand() - 0.5) * 10;
    const ctrlY = trunkBaseY + 10 + (rand() - 0.5) * 6;
    roots.push(`M ${cx} ${trunkBaseY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`);
  }

  // ── Branches — recursive, seeded, tapering. ──
  const branches: BranchSegment[] = [];
  const canopyTips: { x: number; y: number; angleDeg: number }[] = [];
  const maxGenerations = generationsForStage(stageIndex);
  const primaryCount = Math.max(0, Math.min(10, branchCount));

  function addBranch(x1: number, y1: number, angleDeg: number, length: number, thickness: number, generation: number) {
    const rad = (angleDeg * Math.PI) / 180;
    const x2 = x1 + Math.sin(rad) * length;
    const y2 = y1 - Math.cos(rad) * length;
    // A slight organic curve rather than a straight line — bow toward one
    // side, amount/direction seeded per-branch.
    const bow = (rand() - 0.5) * length * 0.4;
    const midX = (x1 + x2) / 2 + Math.cos(rad) * bow;
    const midY = (y1 + y2) / 2 + Math.sin(rad) * bow;
    branches.push({
      path: `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`,
      thickness,
      generation,
      tipX: x2, tipY: y2,
      angleDeg,
    });

    if (generation < maxGenerations - 1 && thickness > 2) {
      const childCount = generation === 0 ? (rand() < 0.5 ? 2 : 3) : (rand() < 0.6 ? 1 : 2);
      for (let c = 0; c < childCount; c++) {
        const spread = lerp(20, 45, rand());
        const dir = rand() < 0.5 ? -1 : 1;
        const childAngle = angleDeg + dir * spread + (rand() - 0.5) * 10;
        const childLength = length * lerp(0.55, 0.75, rand());
        addBranch(x2, y2, childAngle, childLength, thickness * 0.62, generation + 1);
      }
    } else {
      canopyTips.push({ x: x2, y: y2, angleDeg });
    }
  }

  for (let i = 0; i < primaryCount; i++) {
    const t = primaryCount === 1 ? 0.5 : i / (primaryCount - 1);
    const heightFrac = lerp(0.15, 0.85, t) + (rand() - 0.5) * 0.06; // where on the trunk this branch leaves from
    const y1 = lerp(trunkBaseY, trunkTopY, Math.min(0.95, Math.max(0.05, heightFrac)));
    const side = i % 2 === 0 ? -1 : 1;
    const baseAngle = side * lerp(35, 70, rand());
    const length = canopyRadius * lerp(0.55, 0.95, rand());
    const thickness = Math.max(2, trunkWidthPx * lerp(0.18, 0.32, rand()));
    addBranch(cx, y1, baseAngle, length, thickness, 0);
  }

  // A lone terminal shoot at the very top for low branch counts (Young
  // Tree with 0-1 branches still needs a visible leader shoot).
  if (primaryCount === 0) {
    const length = canopyRadius * 0.7;
    addBranch(cx, trunkTopY, 0, length, Math.max(2, trunkWidthPx * 0.3), 0);
  }

  // ── Leaf clusters — many small irregular blobs near canopy tips, never
  // one perfect ellipse. ──
  const leafClusters: LeafCluster[] = [];
  const clustersPerTip = stageIndex >= 6 ? 3 : stageIndex >= 4 ? 2 : 1;
  for (const tip of canopyTips) {
    for (let c = 0; c < clustersPerTip; c++) {
      const jitterX = (rand() - 0.5) * 22;
      const jitterY = (rand() - 0.5) * 18;
      leafClusters.push({
        cx: tip.x + jitterX,
        cy: tip.y + jitterY - 6,
        rx: lerp(10, 20, rand()),
        ry: lerp(7, 14, rand()),
        rotationDeg: rand() * 360,
        opacity: lerp(0.55, 0.85, rand()),
      });
    }
  }

  return { roots, branches, leafClusters, canopyTips };
}

export interface FruitPlacement {
  x: number;
  y: number;
  angleDeg: number;
  depthFactor: number; // 0 (far/behind) - 1 (near/front) — for occlusion + z-order
}

// Places each earned fruit at a stable, real branch-tip / leaf-cluster
// location — never floating, never re-shuffled between opens. fruitKey is
// unique per user (p2p_user_fruits has a (user_id, fruit_key) uniqueness
// constraint), so hashing it alone is a stable per-tree placement key.
export function placeFruits(fruitKeys: string[], tips: { x: number; y: number; angleDeg: number }[]): Map<string, FruitPlacement> {
  const placements = new Map<string, FruitPlacement>();
  if (tips.length === 0) return placements;
  for (const key of fruitKeys) {
    const h = fnv1a(key);
    const tip = tips[h % tips.length];
    const rand = mulberry32(h);
    const jitterAngle = (rand() - 0.5) * 40;
    const jitterDist = lerp(4, 14, rand());
    const rad = ((tip.angleDeg + jitterAngle) * Math.PI) / 180;
    placements.set(key, {
      x: tip.x + Math.sin(rad) * jitterDist,
      y: tip.y - Math.cos(rad) * jitterDist * 0.5 + jitterDist * 0.3,
      angleDeg: tip.angleDeg + jitterAngle,
      depthFactor: rand(),
    });
  }
  return placements;
}