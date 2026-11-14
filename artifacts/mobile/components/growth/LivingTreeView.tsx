import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, type ViewStyle, type StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname } from "expo-router";
import colors from "@/constants/colors";
import { STAGES } from "@/constants/stages";
import { AppButton, IconButton } from "@/components/ui";
import TreeModelViewer, { type TreeModelViewerHandle, type TreeViewerStatus } from "@/components/growth/TreeModelViewer";
import type { TreeView } from "@/components/growth/treeModelViewerTypes";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useGrowthTree } from "@/hooks/useGrowthTree";
import { STAGE_BODIES } from "@/lib/growthTreeComposition";
import { placeTree, instancesByAsset, type BodyAnchors } from "@/lib/growthTreePlacement";
import { modularFileUrl, modularCloseUrl, anchorsUrl, assetById } from "@/lib/growthTreeAssets";

// THE LIVING GROWTH TREE — one renderer for every place a Growth Tree is shown (Home, My Tree, the stage
// cards, full screen, celebrations). It always draws the owner's real Meshy model for the stage
// (hosted in Forests/models/v2/, lib/growthTreeAssets.ts), with wind in its canopy (lib/treeViewerHtml.ts).
//   • mode "tree":  the person's own tree — their verified stage's body with one fruit per verified
//                   contribution, buds, tips (GET /growth/me/tree → lib/growthTreeComposition.ts). If that
//                   can't load, the same stage's body is still shown (never another picture).
//   • mode "stage": one stage's body (stage cards, "see this stage in 3D").
// There is no picture fallback: while loading, a spinner; on failure, "Try again"; with no hosted model
// for the stage, a plain "not available" note. Only one model is loaded per view; drawing pauses when
// the screen isn't in view or the app is in the background.
const anchorsCache = new Map<string, BodyAnchors>();
async function loadAnchors(bodyId: string): Promise<BodyAnchors | null> {
  const url = anchorsUrl(bodyId);
  if (!url) return null;
  const hit = anchorsCache.get(url); if (hit) return hit;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const a = (await res.json()) as BodyAnchors;
    if (!Array.isArray(a?.sectors) || !Array.isArray(a?.trunk)) return null;
    anchorsCache.set(url, a);
    return a;
  } catch { return null; }
}

/** The Meshy body for a personal stage index (0 = Seed … 4 = Forest Builder); the same map the tree uses. */
export const bodyForStage = (stageIndex: number) => STAGE_BODIES[Math.min(5, Math.max(1, stageIndex + 1))];

export default function LivingTreeView({ stageIndex, mode = "tree", compact = false, onPress, background = colors.lightCream, style, extraControls, showViewControls = false, accessibilityHint, requestedView, onSelect }: {
  /** The person's (or the card's) personal stage, 0 = Seed … 4 = Forest Builder. */
  stageIndex: number;
  mode?: "tree" | "stage";
  /** A card: no gestures, no buttons; `onPress` handles a tap. */
  compact?: boolean;
  onPress?: () => void;
  background?: string;
  style?: StyleProp<ViewStyle>;
  extraControls?: React.ReactNode;
  /** Full tree / Roots / Canopy and wind on/off (My Tree, full screen). */
  showViewControls?: boolean;
  accessibilityHint?: string;
  /** Move the camera to this view when it changes (My Growth: Learning Roots → "roots"). The buttons still work. */
  requestedView?: TreeView;
  /** Told which tree part was tapped (an attachment id, e.g. "fruit:<evidence id>"), so a screen can show its record. */
  onSelect?: (id: string | null) => void;
}) {
  const reduceMotion = useReduceMotion();
  const [anchors, setAnchors] = useState<BodyAnchors | null>(null);
  const [anchorsTried, setAnchorsTried] = useState(false);
  const [status, setStatus] = useState<TreeViewerStatus>({ state: "loading", progress: 0 });
  const [picked, setPicked] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<TreeView>("full");
  const [windOn, setWindOn] = useState(!reduceMotion);
  const viewer = useRef<TreeModelViewerHandle>(null);
  // In view only while the route it was opened on is the current one (works in screens, tabs and the
  // root layout's modals alike): Home's tree stops drawing while My Tree is open, and starts again on return.
  const pathname = usePathname();
  const openedOn = useRef(pathname).current;
  const focused = pathname === openedOn;
  // The person's own tree (verified stage, fruit) — the same shared data Home and My Tree describe
  // (hooks/useGrowthTree). Its stage comes from the server, like the label's.
  const { plan: treePlan, loaded: treeTried } = useGrowthTree(mode === "tree");
  const plan = mode === "tree" ? treePlan : null;
  const body = plan?.body ?? bodyForStage(stageIndex);

  useEffect(() => {
    let live = true;
    setAnchorsTried(false);
    loadAnchors(body).then((a) => { if (live) { setAnchors(a); setAnchorsTried(true); } });
    return () => { live = false; };
  }, [body, reloadKey]);

  const parts = useMemo(() => {
    if (!plan || !anchors) return undefined;
    // Only parts whose model is hosted are drawn; the rest stay listed (counts are never lost).
    const placed = placeTree(plan, anchors, { bodyHasFoliage: !!assetById(plan.body)?.hasFoliage }).filter((p) => !!modularFileUrl(p.asset));
    if (!placed.length) return undefined;
    const ids: Record<string, string[]> = {};
    for (const p of placed) (ids[p.asset] ??= []).push(p.id);
    const instances = instancesByAsset(placed);
    return { urls: Object.fromEntries(Object.keys(instances).map((a) => [a, modularFileUrl(a)!])), instances, ids };
  }, [plan, anchors]);
  const windFrame = useMemo(() => (anchors ? { trunk: anchors.trunk, height: anchors.height, rMax: anchors.rMax } : null), [anchors]);
  const bodyUrl = modularFileUrl(body);
  // A close-up copy loads only when zoomed in (large trees); never on a card.
  const closeUrl = compact ? null : modularCloseUrl(body);
  const ready = !!bodyUrl && treeTried && anchorsTried;
  const stageName = STAGES[Math.min(4, Math.max(0, stageIndex))]?.name ?? "";
  const fruitCount = plan ? plan.attachments.filter((x) => x.kind === "fruit").length + (plan.fruitCluster?.count ?? 0) : 0;
  const label = mode === "tree"
    ? `Your growth tree, ${stageName}, in 3D${plan ? `: ${fruitCount} verified fruit` : ""}.`
    : `${stageName}: the 3D model of this growth stage.`;
  const meaning = picked && plan ? plan.attachments.find((x) => x.id === picked)?.meaning ?? (picked.startsWith("leaf:") ? "Leaves: your weeks of taking part" : null) : null;
  const pickView = (v: TreeView) => { setView(v); viewer.current?.view(v); };
  const toggleWind = () => { const on = !windOn; setWindOn(on); viewer.current?.setWind(on); };
  const retry = () => { setStatus({ state: "loading", progress: 0 }); setReloadKey((k) => k + 1); };
  // A screen can ask for a view (once the model is drawn); asking again for the same view re-applies nothing.
  const drawn = status.state === "standard" || status.state === "detailed" || status.state === "detail-loading";
  useEffect(() => {
    if (requestedView && drawn) { setView(requestedView); viewer.current?.view(requestedView); }
  }, [requestedView, drawn]);
  useEffect(() => { onSelect?.(picked); }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  // The model itself, with its loading / not-available states (no touch targets inside).
  const scene = (
    <>
      {!bodyUrl ? (
        // No hosted model for this stage: say so (never draw something else in its place).
        <View style={[styles.overlay, { backgroundColor: background }]}>
          <Ionicons name="cube-outline" size={26} color={colors.textMuted} />
          <Text style={styles.overlayText}>The 3D model for {stageName} isn't available yet.</Text>
        </View>
      ) : ready ? (
        <TreeModelViewer ref={viewer} reloadKey={reloadKey} standardUrl={bodyUrl} detailedUrl={closeUrl} noCloseUp={!closeUrl} background={background}
          reduceMotion={reduceMotion} wind={!reduceMotion} windFrame={windFrame} compact={compact} paused={!focused}
          parts={parts} onStatus={setStatus} onSelect={setPicked} />
      ) : null}
      {bodyUrl && (status.state === "loading" || !ready) ? (
        <View style={[styles.overlay, { backgroundColor: background }]} pointerEvents="none">
          <ActivityIndicator color={colors.primaryGreen} />
          {!compact ? <Text style={styles.overlayText}>{mode === "tree" ? "Growing your tree" : `Loading ${stageName}`}{status.progress ? ` · ${status.progress}%` : ""}</Text> : null}
        </View>
      ) : null}
    </>
  );
  // Couldn't load: say so, with Try again (never a picture in its place). Always its own touch target.
  const errorOverlay = status.state === "error" ? (
    <View style={[styles.overlay, { backgroundColor: background }]}>
      <Ionicons name="cloud-offline-outline" size={compact ? 22 : 28} color={colors.textMuted} />
      <Text style={styles.overlayText}>{status.message ?? "The tree couldn't be loaded."}</Text>
      <AppButton label="Try again" onPress={retry} variant="secondary" size="sm" palette="fixedLight" />
    </View>
  ) : null;
  // A card: the tree is one button (the 3D page takes no touches, so the page scrolls past it); Try again
  // sits beside it, never inside it.
  if (compact && onPress) {
    return (
      <View style={[styles.stage, { backgroundColor: background }, style]}>
        <TouchableOpacity activeOpacity={0.92} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>{scene}</View>
        </TouchableOpacity>
        {errorOverlay}
      </View>
    );
  }
  return (
    <View style={[styles.stage, { backgroundColor: background }, style]} accessible={!errorOverlay && compact} accessibilityRole="image" accessibilityLabel={label}>
      {scene}
      {errorOverlay}
      {!compact && (status.state === "detail-loading" || status.detailFailed) ? (
        <Text style={styles.detail} pointerEvents="none">{status.detailFailed ? "Close-up detail unavailable right now" : `Loading close-up detail${status.progress ? ` · ${status.progress}%` : ""}`}</Text>
      ) : null}
      {meaning ? (
        <View style={styles.meaning} accessibilityLiveRegion="polite">
          <Text style={styles.meaningText}>{meaning}</Text>
          <IconButton icon="close" size="sm" accessibilityLabel="Close" onPress={() => setPicked(null)} color={colors.textMid} />
        </View>
      ) : null}
      {!compact && plan?.fruitCluster ? <Text style={styles.cluster} pointerEvents="none">+{plan.fruitCluster.count} more verified fruit</Text> : null}
      {!compact && showViewControls && status.state !== "loading" && status.state !== "error" ? (
        <View style={styles.views} accessibilityRole="tablist">
          {([["full", "Full tree"], ["roots", "Roots"], ["canopy", "Canopy"]] as const).map(([v, l]) => (
            <TouchableOpacity key={v} onPress={() => pickView(v)} style={[styles.viewBtn, view === v && styles.viewBtnOn]} accessibilityRole="tab" accessibilityState={{ selected: view === v }}>
              <Text style={[styles.viewText, view === v && styles.viewTextOn]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {!compact && status.state !== "loading" && status.state !== "error" ? (
        <View style={styles.controls}>
          <IconButton variant="tinted" palette="fixedLight" icon="add" accessibilityLabel="Zoom in" onPress={() => viewer.current?.zoom(0.75)} />
          <IconButton variant="tinted" palette="fixedLight" icon="remove" accessibilityLabel="Zoom out" onPress={() => viewer.current?.zoom(1.33)} />
          <IconButton variant="tinted" palette="fixedLight" icon="scan-outline" accessibilityLabel="Reset the view" onPress={() => { setView("full"); viewer.current?.reset(); }} />
          {showViewControls && !reduceMotion ? (
            <IconButton variant="tinted" palette="fixedLight" icon={windOn ? "leaf" : "leaf-outline"} accessibilityLabel={windOn ? "Stop the leaves moving" : "Let the leaves move in the wind"} onPress={toggleWind} />
          ) : null}
          {extraControls}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { overflow: "hidden", flex: 1 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, opacity: 0.94 },
  overlayText: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.textMid, textAlign: "center" },
  controls: { position: "absolute", right: 10, bottom: 10, gap: 8 },
  views: { position: "absolute", left: 10, bottom: 12, flexDirection: "row", gap: 6, flexWrap: "wrap", right: 64 },
  viewBtn: { minHeight: 36, paddingHorizontal: 12, justifyContent: "center", borderRadius: 18, backgroundColor: "rgba(255,255,255,0.88)", borderWidth: 1, borderColor: "rgba(0,0,0,0.08)" },
  viewBtnOn: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  viewText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  viewTextOn: { color: "#fff" },
  meaning: { position: "absolute", left: 12, right: 64, top: 12, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.94)" },
  meaningText: { flex: 1, fontSize: 13.5, color: colors.textDark, fontFamily: "Inter_500Medium", paddingVertical: 10 },
  detail: { position: "absolute", left: 14, top: 14, fontSize: 12.5, fontFamily: "Inter_500Medium", color: colors.textMid, backgroundColor: "rgba(255,255,255,0.85)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
  cluster: { position: "absolute", left: 14, top: 60, fontSize: 12.5, fontFamily: "Inter_600SemiBold", color: colors.textMid, backgroundColor: "rgba(255,255,255,0.85)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
});
