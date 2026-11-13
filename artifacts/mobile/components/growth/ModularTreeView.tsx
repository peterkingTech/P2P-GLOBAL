import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, type ViewStyle, type StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { AppButton, IconButton } from "@/components/ui";
import TreeModelViewer, { type TreeModelViewerHandle, type TreeViewerStatus } from "@/components/growth/TreeModelViewer";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { getGrowthTree, type GrowthTree } from "@/lib/growthApi";
import { composeTree } from "@/lib/growthTreeComposition";
import { placeTree, instancesByAsset, type BodyAnchors } from "@/lib/growthTreePlacement";
import { MODULAR_TREE_BASE_URL, modularFileUrl, modularCloseUrl, anchorsUrl, assetById } from "@/lib/growthTreeAssets";

// MY GROWTH TREE, modular: the person's verified stage body with one fruit per verified contribution,
// buds for records awaiting review, new-growth tips and leaves — composed from GET /growth/me/tree
// (lib/growthTreeComposition.ts) and placed on the body's measured branch anchors
// (lib/growthTreePlacement.ts). Tap a part to see the record it stands for.
// Shown only where the v2 models are configured (MODULAR_TREE_BASE_URL); otherwise, and whenever
// the data or anchors can't load, the caller keeps the v1 model (`fallback`).
export default function ModularTreeView({ fallback, background = colors.lightCream, style, extraControls }: {
  fallback: React.ReactNode;
  background?: string;
  style?: StyleProp<ViewStyle>;
  extraControls?: React.ReactNode;
}) {
  const [tree, setTree] = useState<GrowthTree | null>(null);
  const [anchors, setAnchors] = useState<BodyAnchors | null>(null);
  const [failed, setFailed] = useState(!MODULAR_TREE_BASE_URL);
  const [status, setStatus] = useState<TreeViewerStatus>({ state: "loading", progress: 0 });
  const [picked, setPicked] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const viewer = useRef<TreeModelViewerHandle>(null);
  const reduceMotion = useReduceMotion();
  const today = new Date().toISOString().slice(0, 10);
  const plan = useMemo(() => (tree ? composeTree(tree, today) : null), [tree, today]);

  useEffect(() => {
    if (!MODULAR_TREE_BASE_URL) return;
    let live = true;
    getGrowthTree().then(async (t) => {
      const body = composeTree(t, today).body;
      const url = anchorsUrl(body);
      if (!url) throw new Error("no anchors");
      const res = await fetch(url);
      if (!res.ok) throw new Error("anchors " + res.status);
      const a = (await res.json()) as BodyAnchors;
      if (!Array.isArray(a?.sectors)) throw new Error("bad anchors");
      if (live) { setTree(t); setAnchors(a); }
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [today]);

  const parts = useMemo(() => {
    if (!plan || !anchors) return null;
    // Only parts whose model is available are drawn; the rest stay listed (counts are never lost).
    const placed = placeTree(plan, anchors, { bodyHasFoliage: !!assetById(plan.body)?.hasFoliage }).filter((p) => !!modularFileUrl(p.asset));
    const ids: Record<string, string[]> = {};
    for (const p of placed) (ids[p.asset] ??= []).push(p.id);
    const instances = instancesByAsset(placed);
    return { urls: Object.fromEntries(Object.keys(instances).map((a) => [a, modularFileUrl(a)!])), instances, ids };
  }, [plan, anchors]);
  const bodyUrl = plan ? modularFileUrl(plan.body) : null;
  // Close-up copy (large trees) loads only when zoomed in; without one, zoom stops before detail breaks down.
  const closeUrl = plan ? modularCloseUrl(plan.body) : null;

  if (failed || (plan && !bodyUrl)) return <>{fallback}</>;
  const meaning = picked && plan ? plan.attachments.find((x) => x.id === picked)?.meaning ?? (picked.startsWith("leaf:") ? "Leaves: your weeks of taking part" : null) : null;

  return (
    <View style={[styles.stage, { backgroundColor: background }, style]} accessible accessibilityRole="image"
      accessibilityLabel={plan ? `Your growth tree: ${plan.attachments.filter((x) => x.kind === "fruit").length + (plan.fruitCluster?.count ?? 0)} verified fruit.` : "Your growth tree"}>
      {plan && anchors && bodyUrl && parts ? (
        <TreeModelViewer ref={viewer} reloadKey={reloadKey} standardUrl={bodyUrl} detailedUrl={closeUrl} noCloseUp={!closeUrl} background={background} reduceMotion={reduceMotion}
          parts={parts} onStatus={setStatus} onSelect={setPicked} />
      ) : null}
      {status.state === "loading" ? (
        <View style={[styles.overlay, { backgroundColor: background }]} pointerEvents="none">
          <ActivityIndicator color={colors.primaryGreen} />
          <Text style={styles.overlayText}>Growing your tree{status.progress ? ` · ${status.progress}%` : ""}</Text>
        </View>
      ) : null}
      {status.state === "error" ? (
        <View style={[styles.overlay, { backgroundColor: background }]}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textMuted} />
          <Text style={styles.overlayText}>{status.message ?? "Your tree couldn't be loaded."}</Text>
          <AppButton label="Try again" onPress={() => { setStatus({ state: "loading", progress: 0 }); setReloadKey((k) => k + 1); }} variant="secondary" size="sm" palette="fixedLight" />
        </View>
      ) : null}
      {status.state === "detail-loading" || status.detailFailed ? (
        <Text style={styles.detail} pointerEvents="none">{status.detailFailed ? "Close-up detail unavailable right now" : `Loading close-up detail${status.progress ? ` · ${status.progress}%` : ""}`}</Text>
      ) : null}
      {meaning ? (
        <View style={styles.meaning} accessibilityLiveRegion="polite">
          <Text style={styles.meaningText}>{meaning}</Text>
          <IconButton icon="close" size="sm" accessibilityLabel="Close" onPress={() => setPicked(null)} color={colors.textMid} />
        </View>
      ) : null}
      {plan?.fruitCluster ? <Text style={styles.cluster} pointerEvents="none">+{plan.fruitCluster.count} more verified fruit</Text> : null}
      {status.state !== "loading" && status.state !== "error" ? (
        <View style={styles.controls}>
          <IconButton variant="tinted" palette="fixedLight" icon="add" accessibilityLabel="Zoom in" onPress={() => viewer.current?.zoom(0.75)} />
          <IconButton variant="tinted" palette="fixedLight" icon="remove" accessibilityLabel="Zoom out" onPress={() => viewer.current?.zoom(1.33)} />
          <IconButton variant="tinted" palette="fixedLight" icon="scan-outline" accessibilityLabel="Reset the view" onPress={() => viewer.current?.reset()} />
          {extraControls}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { overflow: "hidden" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, opacity: 0.94 },
  overlayText: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.textMid, textAlign: "center" },
  controls: { position: "absolute", right: 10, bottom: 10, gap: 8 },
  meaning: { position: "absolute", left: 12, right: 64, bottom: 12, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.94)" },
  meaningText: { flex: 1, fontSize: 13.5, color: colors.textDark, fontFamily: "Inter_500Medium", paddingVertical: 10 },
  detail: { position: "absolute", left: 14, top: 14, fontSize: 12.5, fontFamily: "Inter_500Medium", color: colors.textMid, backgroundColor: "rgba(255,255,255,0.85)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
  cluster: { position: "absolute", left: 14, top: 60, fontSize: 12.5, fontFamily: "Inter_600SemiBold", color: colors.textMid, backgroundColor: "rgba(255,255,255,0.85)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
});
