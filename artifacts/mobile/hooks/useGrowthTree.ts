import { useCallback, useEffect, useMemo, useState } from "react";
import { getGrowthTree, type GrowthTree } from "@/lib/growthApi";
import { composeTree, type TreePlan } from "@/lib/growthTreeComposition";

// The person's tree data (GET /growth/me/tree) and its composition plan, shared by every place that shows
// the tree or its botanical development (Home, My Tree, the tree view itself) — one request, the same
// answer everywhere, refreshed after a minute. Read only: nothing here changes growth data.
const FRESH_MS = 60_000;
let cache: { at: number; tree: GrowthTree } | null = null;
let inflight: Promise<GrowthTree> | null = null;
function load(force = false): Promise<GrowthTree> {
  if (!force && cache && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.tree);
  if (!inflight) inflight = getGrowthTree().then((t) => { cache = { at: Date.now(), tree: t }; return t; }).finally(() => { inflight = null; });
  return inflight;
}

export function useGrowthTree(enabled = true): { tree: GrowthTree | null; plan: TreePlan | null; loaded: boolean; reload: () => void } {
  const [tree, setTree] = useState<GrowthTree | null>(cache?.tree ?? null);
  const [loaded, setLoaded] = useState(!enabled || !!cache);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load(nonce > 0).then((t) => { if (live) setTree(t); }, () => {}).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [enabled, nonce]);
  const today = new Date().toISOString().slice(0, 10);
  const plan = useMemo(() => (tree ? composeTree(tree, today) : null), [tree, today]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { tree, plan, loaded, reload };
}
