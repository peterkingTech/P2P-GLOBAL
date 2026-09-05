import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, AccessibilityInfo } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Ellipse, Path, Rect, G, Defs, RadialGradient, LinearGradient, Stop } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import type { TreeData, GrowthStage, MenteeBranchInfo } from "@/contexts/DataContext";
import { getTreeStageIndex } from "@/constants/treeStages";
import { useSmoothedGrowth } from "@/hooks/useSmoothedGrowth";
import { generateTreeGeometry, placeFruits } from "@/lib/treeGeometry";
import TreeEnvironment, { EnvironmentSetting } from "./tree/TreeEnvironment";
import type { Season, Weather } from "@/lib/hemisphereSeason";
import colors from "@/constants/colors";

// Fruit category -> color, reused from the existing p2p_fruits_catalog
// taxonomy (migration 032) — never a new/invented fruit type.
const FRUIT_CATEGORY_COLOR: Record<string, string> = {
  personal_growth: "#F4A261",
  faithfulness: "#E9C46A",
  multiplication: "#2A9D8F",
  community: "#E76F51",
  special: "#9B5DE5",
  legendary: "#FFD700",
  kingdom_influence: "#588157",
};

export interface FruitInfo {
  fruitKey: string;
  category: string;
  awardedAt: string;
}

interface LivingTreeProps {
  treeData: TreeData;
  compact?: boolean;
  mentees?: MenteeBranchInfo[];
  fruits?: FruitInfo[];
  onTapFruit?: (fruitKey: string) => void;
  /** Seeds the deterministic branch/root skeleton — pass the tree owner's
   * own user id so the same user always gets the same tree shape. Falls
   * back to a fixed seed if omitted (still deterministic, just not
   * per-user-unique) so existing call sites that don't pass it yet don't
   * break. */
  userId?: string;
  season?: Season;
  weather?: Weather;
  environmentSetting?: EnvironmentSetting;
  reducedMotion?: boolean;
  /** Full gesture/environment experience. Defaults to the opposite of
   * `compact` so existing thumbnail embeds (Home card, profile mini) keep
   * their current lightweight behavior unchanged. */
  interactive?: boolean;
}

const VIEW_W = 300;
const VIEW_H = 400;
const CX = VIEW_W / 2;
const TRUNK_BASE_Y = 320;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function stageLabel(stage: GrowthStage): string {
  switch (stage) {
    case "seed": return "Seed";
    case "sprout": return "Sprout";
    case "young_tree": return "Young Tree";
    case "fruitful_tree": return "Fruitful Tree";
    case "forest_builder": return "Forest Builder";
  }
}

// Per-stage visual "envelope" — the ceiling each continuous size parameter
// can reach at that stage. The real, granular activity signals already on
// TreeData (modules completed, active days, mentees) then determine how
// *full* the current stage's tree looks within that ceiling, so the tree
// reflects both "how far along the journey" (stage) and "how active lately"
// (fullness) — never a single flat number driving everything.
const STAGE_ENVELOPE = [
  { trunkH: 0, trunkW: 0, canopy: 0, roots: 0 },      // Seed
  { trunkH: 18, trunkW: 8, canopy: 0, roots: 3 },      // Root
  { trunkH: 42, trunkW: 14, canopy: 26, roots: 5 },    // Sprout
  { trunkH: 90, trunkW: 24, canopy: 50, roots: 7 },    // Young Tree
  { trunkH: 130, trunkW: 32, canopy: 72, roots: 9 },   // Growing Tree
  { trunkH: 160, trunkW: 40, canopy: 92, roots: 10 },  // Developing Tree
  { trunkH: 185, trunkW: 48, canopy: 112, roots: 11 }, // Mature Tree
  { trunkH: 205, trunkW: 56, canopy: 130, roots: 12 }, // Flourishing Tree
];

export default function LivingTree({
  treeData, compact = false, mentees = [], fruits = [], onTapFruit,
  userId, season = "spring", weather = "sunny", environmentSetting = "auto",
  reducedMotion: reducedMotionProp, interactive,
}: LivingTreeProps) {
  const isInteractive = interactive ?? !compact;
  const [tooltip, setTooltip] = useState<{ title: string; lines: string[] } | null>(null);
  const [osReducedMotion, setOsReducedMotion] = useState(false);
  const [rootsFocused, setRootsFocused] = useState(false);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setOsReducedMotion).catch(() => {});
  }, []);
  const reducedMotion = reducedMotionProp ?? osReducedMotion;

  const displayedScore = useSmoothedGrowth(treeData.treeGrowthScore ?? 0);
  const stageIndex = getTreeStageIndex(displayedScore);
  const envelope = STAGE_ENVELOPE[stageIndex];

  const activityFullness = clamp(
    (clamp(treeData.trunkHeight, 0, 100) / 100) * 0.5 + (clamp(treeData.activeMentees + treeData.secondGenDisciples, 0, 12) / 12) * 0.5,
    0.35, // never so thin it looks unhealthy at a stage the user has genuinely reached
    1
  );

  const trunkHeightPx = 60 + envelope.trunkH * activityFullness;
  const trunkWidthPx = 8 + envelope.trunkW * activityFullness;
  const canopyRadius = 20 + envelope.canopy * activityFullness;
  const rootCount = Math.round(clamp(treeData.rootDepth, 0, envelope.roots));
  const branchCount = stageIndex <= 2 ? 0 : clamp(treeData.branchCount, stageIndex >= 3 ? 2 : 0, 8);
  const trunkTopY = TRUNK_BASE_Y - trunkHeightPx;

  const treeSeed = userId ?? "p2p-global-default-tree-seed";
  const geometry = useMemo(
    () => generateTreeGeometry({
      userId: treeSeed, stageIndex, rootDepth: rootCount,
      trunkHeightPx, trunkWidthPx, branchCount, canopyRadius,
      cx: CX, trunkBaseY: TRUNK_BASE_Y, trunkTopY,
    }),
    [treeSeed, stageIndex, rootCount, Math.round(trunkHeightPx), Math.round(trunkWidthPx), branchCount, Math.round(canopyRadius)]
  );

  const fruitPlacements = useMemo(
    () => placeFruits(fruits.map((f) => f.fruitKey), geometry.canopyTips),
    [fruits, geometry.canopyTips]
  );

  // ── Gestures — rotate (pan) + zoom (pinch), whole-scene transforms. Not
  // true 3D, but a real, working "explore the tree" interaction using
  // already-installed, proven libraries (no WebGL). ──
  const viewAngle = useSharedValue(0);
  const zoomScale = useSharedValue(1);
  const rootsFocusAnim = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .enabled(isInteractive && !compact)
    .onChange((e) => {
      "worklet";
      viewAngle.value = clamp(viewAngle.value - e.changeX * 0.4, -55, 55);
    })
    .onEnd(() => {
      "worklet";
      viewAngle.value = withTiming(viewAngle.value * 0.6, { duration: 400 });
    });

  const pinchGesture = Gesture.Pinch()
    .enabled(isInteractive && !compact)
    .onChange((e) => {
      "worklet";
      zoomScale.value = clamp(zoomScale.value * e.scaleChange, 0.7, 1.8);
    });

  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const sceneStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { rotateY: `${viewAngle.value}deg` },
      { scale: zoomScale.value },
      { translateY: rootsFocusAnim.value * 70 },
    ],
  }));

  function resetView() {
    viewAngle.value = withTiming(0, { duration: 400 });
    zoomScale.value = withTiming(1, { duration: 400 });
  }

  function toggleRoots() {
    const next = !rootsFocused;
    setRootsFocused(next);
    rootsFocusAnim.value = withTiming(next ? 1 : 0, { duration: 700 });
  }

  const activeToday = treeData.lastActiveAt ? new Date(treeData.lastActiveAt).toDateString() === new Date().toDateString() : false;
  const isDormant = treeData.healthStatus === "dormant";
  const isDrought = treeData.healthStatus === "drought";

  function handleTap(area: "roots" | "trunk" | "canopy" | number) {
    if (compact) return;
    if (area === "roots") {
      setTooltip({
        title: "Your Roots — Module depth",
        lines: [`${treeData.modulesCompleted} of 12 modules completed`, "Roots grow deeper as you complete modules"],
      });
    } else if (area === "trunk") {
      setTooltip({
        title: "Your Trunk — Faithfulness",
        lines: [`Active ${treeData.activeDays} days`, `${treeData.streakDays} day streak`, "Consistency makes your trunk stronger"],
      });
    } else if (area === "canopy") {
      const totalLives = treeData.activeMentees + treeData.secondGenDisciples;
      setTooltip({
        title: "Your Canopy — Kingdom Reach",
        lines: [
          `${treeData.activeMentees} direct disciples`,
          `${treeData.secondGenDisciples} second-generation disciples`,
          `Your tree touches ${totalLives} lives`,
        ],
      });
    } else {
      const mentee = mentees[area];
      if (mentee) {
        setTooltip({
          title: `${mentee.name} — ${mentee.currentModule ?? "Just getting started"}`,
          lines: [`Active ${mentee.daysAgo} day${mentee.daysAgo === 1 ? "" : "s"} ago`, mentee.isWilting ? "Needs encouragement" : "Healthy"],
        });
      }
    }
  }

  const w = compact ? VIEW_W * 0.5 : VIEW_W;
  const h = compact ? VIEW_H * 0.5 : VIEW_H;

  const soilGradientId = "soilGrad";
  const barkGradientId = "barkGrad";
  const canopyGradientId = "canopyGrad";

  const treeScene = (
    <Svg width={w} height={h} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
      <Defs>
        <LinearGradient id={soilGradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#4A3319" />
          <Stop offset="100%" stopColor="#2A1D0F" />
        </LinearGradient>
        <LinearGradient id={barkGradientId} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0%" stopColor="#4A3018" />
          <Stop offset="50%" stopColor="#6B4A28" />
          <Stop offset="100%" stopColor="#3D2914" />
        </LinearGradient>
        <RadialGradient id={canopyGradientId} cx="40%" cy="35%" r="65%">
          <Stop offset="0%" stopColor={activeToday ? "#5A9468" : "#3D7A54"} />
          <Stop offset="100%" stopColor={activeToday ? "#2D6A4F" : "#1F4E39"} />
        </RadialGradient>
        <RadialGradient id="rootGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={activeToday ? "#FFD700" : "#8B6914"} stopOpacity={0.45} />
          <Stop offset="100%" stopColor={activeToday ? "#FFD700" : "#8B6914"} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* Soil */}
      <Rect x={0} y={TRUNK_BASE_Y + 20} width={VIEW_W} height={VIEW_H - TRUNK_BASE_Y - 20} fill={`url(#${soilGradientId})`} />
      <Ellipse cx={CX} cy={TRUNK_BASE_Y + 22} rx={VIEW_W * 0.42} ry={10} fill="#5C4426" opacity={0.5} />

      {stageIndex === 0 ? (
        // ── Seed stage — genuinely just a seed in soil, no plant at all. ──
        <G>
          <Ellipse cx={CX} cy={TRUNK_BASE_Y + 8} rx={11} ry={15} fill="#8B6914" />
          <Ellipse cx={CX - 3} cy={TRUNK_BASE_Y + 4} rx={4} ry={6} fill="#A67D1E" opacity={0.6} />
        </G>
      ) : (
        <>
          {/* Roots */}
          <G onPress={() => handleTap("roots")}>
            {activeToday && <Circle cx={CX} cy={TRUNK_BASE_Y + 15} r={45} fill="url(#rootGlow)" />}
            {geometry.roots.map((d, i) => (
              <Path key={i} d={d} stroke="#6B4A28" strokeWidth={stageIndex >= 5 ? 3.5 : 2.5} fill="none" strokeLinecap="round" />
            ))}
            <Rect x={CX - 80} y={TRUNK_BASE_Y - 10} width={160} height={70} fill="transparent" />
          </G>

          {stageIndex === 1 ? (
            // ── Root stage — a tiny emerging shoot above the developing roots. ──
            <Path d={`M ${CX} ${TRUNK_BASE_Y} L ${CX} ${TRUNK_BASE_Y - 14}`} stroke="#4A7C59" strokeWidth={3} strokeLinecap="round" />
          ) : (
            <>
              {/* Trunk — tapered, not a rectangle */}
              <G onPress={() => handleTap("trunk")}>
                <Path
                  d={`M ${CX - trunkWidthPx / 2} ${TRUNK_BASE_Y} C ${CX - trunkWidthPx / 2.3} ${TRUNK_BASE_Y - trunkHeightPx * 0.5}, ${CX - trunkWidthPx / 3} ${trunkTopY + 10}, ${CX - trunkWidthPx / 4} ${trunkTopY} L ${CX + trunkWidthPx / 4} ${trunkTopY} C ${CX + trunkWidthPx / 3} ${trunkTopY + 10}, ${CX + trunkWidthPx / 2.3} ${TRUNK_BASE_Y - trunkHeightPx * 0.5}, ${CX + trunkWidthPx / 2} ${TRUNK_BASE_Y} Z`}
                  fill={`url(#${barkGradientId})`}
                />
                {isDrought && (
                  <Path
                    d={`M ${CX} ${trunkTopY + trunkHeightPx * 0.25} L ${CX - 2} ${trunkTopY + trunkHeightPx * 0.5} L ${CX + 2} ${trunkTopY + trunkHeightPx * 0.7}`}
                    stroke="#2A1D0F" strokeWidth={1.2} fill="none"
                  />
                )}
              </G>

              {/* Branches — procedurally generated, natural asymmetry */}
              {geometry.branches.map((b, i) => (
                <Path
                  key={i}
                  d={b.path}
                  stroke={b.generation === 0 ? "#5C3D1E" : "#4A7C59"}
                  strokeWidth={b.thickness}
                  strokeLinecap="round"
                  fill="none"
                  onPress={() => mentees[i] && handleTap(i)}
                />
              ))}

              {/* Leaf clusters — many small irregular shapes, not one ellipse */}
              <G onPress={() => handleTap("canopy")}>
                {geometry.leafClusters.map((lc, i) => (
                  <Ellipse
                    key={i}
                    cx={lc.cx} cy={lc.cy} rx={lc.rx} ry={lc.ry}
                    fill={`url(#${canopyGradientId})`}
                    opacity={lc.opacity}
                    transform={`rotate(${lc.rotationDeg} ${lc.cx} ${lc.cy})`}
                  />
                ))}
              </G>
            </>
          )}
        </>
      )}

      {/* Fruit — from the real earned catalog only, attached at real leaf-cluster locations */}
      {stageIndex >= 3 && fruits.map((f) => {
        const placement = fruitPlacements.get(f.fruitKey);
        if (!placement) return null;
        const daysSinceEarned = (Date.now() - new Date(f.awardedAt).getTime()) / (24 * 60 * 60 * 1000);
        // Bud -> small -> mature over the fruit's first ~2 weeks, never
        // popping into existence instantly.
        const maturity = clamp(daysSinceEarned / 14, 0.15, 1);
        const radius = 3 + maturity * 5;
        const color = FRUIT_CATEGORY_COLOR[f.category] ?? "#F4A261";
        // Fruit facing roughly toward the current view angle renders full
        // strength; fruit facing away dims/shrinks slightly, as if partly
        // behind the foliage — real discovery via rotation, no depth buffer.
        const facingDelta = Math.abs(((placement.angleDeg % 360) + 360) % 360 - 180);
        const frontness = clamp(1 - facingDelta / 180, 0.35, 1);
        return (
          <Circle
            key={f.fruitKey}
            cx={placement.x} cy={placement.y} r={radius}
            fill={color}
            stroke="#fff" strokeWidth={0.75}
            opacity={0.5 + frontness * 0.5}
            onPress={() => onTapFruit?.(f.fruitKey)}
          />
        );
      })}
    </Svg>
  );

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, !compact && { width: VIEW_W, height: VIEW_H }]}>
      {!compact && (
        <TreeEnvironment width={VIEW_W} height={VIEW_H} season={season} weather={weather} setting={environmentSetting} reducedMotion={reducedMotion} />
      )}

      {isInteractive && !compact ? (
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={reducedMotion ? undefined : sceneStyle}>{treeScene}</Animated.View>
        </GestureDetector>
      ) : (
        treeScene
      )}

      {!compact && isInteractive && (
        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.controlBtn} onPress={toggleRoots} accessibilityRole="button" accessibilityLabel={rootsFocused ? "View canopy" : "View roots"}>
            <Ionicons name={rootsFocused ? "leaf-outline" : "git-branch-outline"} size={16} color={colors.textDark} />
            <Text style={styles.controlBtnText}>{rootsFocused ? "View Canopy" : "View Roots"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={resetView} accessibilityRole="button" accessibilityLabel="Reset view">
            <Ionicons name="refresh-outline" size={16} color={colors.textDark} />
            <Text style={styles.controlBtnText}>Reset View</Text>
          </TouchableOpacity>
        </View>
      )}

      {isDormant && !compact && <Text style={styles.captionText}>Resting. Ready when you are.</Text>}

      {treeData.fruitCount > 0 && (
        <View style={styles.fruitBadge}>
          <Ionicons name="nutrition" size={12} color="#fff" />
          <Text style={styles.fruitBadgeText}>{treeData.fruitCount}</Text>
        </View>
      )}

      <Modal visible={!!tooltip} transparent animationType="fade" onRequestClose={() => setTooltip(null)}>
        <TouchableOpacity style={styles.tooltipOverlay} activeOpacity={1} onPress={() => setTooltip(null)}>
          <View style={styles.tooltipCard}>
            <Text style={styles.tooltipTitle}>{tooltip?.title}</Text>
            {tooltip?.lines.map((l, i) => (
              <Text key={i} style={styles.tooltipLine}>{l}</Text>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", borderRadius: 20 },
  wrapCompact: {},
  captionText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 8, textAlign: "center" },
  fruitBadge: {
    position: "absolute", top: 4, right: 4,
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: colors.amber, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3,
  },
  fruitBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  controlsRow: { position: "absolute", bottom: 8, flexDirection: "row", gap: 8 },
  controlBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,255,255,0.85)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6,
  },
  controlBtnText: { fontSize: 11, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  tooltipOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 30 },
  tooltipCard: { backgroundColor: colors.card, borderRadius: 16, padding: 20, width: "100%", maxWidth: 320, gap: 6 },
  tooltipTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
  tooltipLine: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
});