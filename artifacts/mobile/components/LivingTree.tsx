import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Modal, TouchableOpacity } from "react-native";
import Svg, { Circle, Ellipse, Path, Rect, G, Defs, RadialGradient, Stop } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import type { TreeData, GrowthStage } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Fruit category -> color, per Prompt 5. kingdom_influence isn't in the
// original 6-color list but is a real 7th category in p2p_fruits_catalog
// (migration 032) — given a color here too rather than silently rendering
// fruit from that category uncolored.
const FRUIT_CATEGORY_COLOR: Record<string, string> = {
  personal_growth: "#F4A261",
  faithfulness: "#E9C46A",
  multiplication: "#2A9D8F",
  community: "#E76F51",
  special: "#9B5DE5",
  legendary: "#FFD700",
  kingdom_influence: "#588157",
};

export interface MenteeBranchInfo {
  id: string;
  name: string;
  currentModule: string | null;
  daysAgo: number;
  isWilting: boolean;
}

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

export default function LivingTree({ treeData, compact = false, mentees = [], fruits = [], onTapFruit }: LivingTreeProps) {
  const [tooltip, setTooltip] = useState<{ title: string; lines: string[] } | null>(null);

  const swayAnim = useRef(new Animated.Value(0)).current;
  const fruitPulse = useRef(new Animated.Value(1)).current;
  const dormantGlow = useRef(new Animated.Value(0.3)).current;

  const isHealthySway = treeData.healthStatus === "healthy";
  const isDormant = treeData.healthStatus === "dormant";
  const isDrought = treeData.healthStatus === "drought";

  useEffect(() => {
    if (!isHealthySway) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(swayAnim, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(swayAnim, { toValue: -1, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(swayAnim, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isHealthySway]);

  useEffect(() => {
    const hasNewFruit = fruits.some((f) => Date.now() - new Date(f.awardedAt).getTime() < 24 * 60 * 60 * 1000);
    if (!hasNewFruit) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fruitPulse, { toValue: 1.2, duration: 300, useNativeDriver: true }),
        Animated.timing(fruitPulse, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(1200),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [fruits]);

  useEffect(() => {
    if (!isDormant) return;
    // A once-per-day glow is meaningless client-side without a persisted
    // timestamp to gate it against — this instead gives a slow, sparse pulse
    // (long delay between pulses) that reads as "resting," not literally
    // once every 24 real hours.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dormantGlow, { toValue: 0.8, duration: 2000, useNativeDriver: true }),
        Animated.timing(dormantGlow, { toValue: 0.3, duration: 2000, useNativeDriver: true }),
        Animated.delay(20000),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isDormant]);

  const swayRotate = swayAnim.interpolate({ inputRange: [-1, 1], outputRange: ["-3deg", "3deg"] });

  const rootDepth = clamp(treeData.rootDepth, 0, 12);
  const trunkHeightPx = 80 + (clamp(treeData.trunkHeight, 0, 100) / 100) * 120; // 80-200
  const trunkWidthPx = 20 + (clamp(treeData.trunkHeight, 0, 100) / 100) * 30; // 20-50
  const branchCount = clamp(treeData.branchCount, 0, 8);
  const canopyRadius = 40 + (clamp(treeData.canopySize, 0, 20) / 20) * 80; // 40-120, canopySize soft-capped at 20
  const activeToday = treeData.lastActiveAt ? new Date(treeData.lastActiveAt).toDateString() === new Date().toDateString() : false;

  const trunkTopY = TRUNK_BASE_Y - trunkHeightPx;
  const canopyCenterY = trunkTopY - canopyRadius * 0.5;

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

  // ── Dormant state: only a resting seed in the soil ──
  if (isDormant) {
    return (
      <View style={[styles.wrap, compact && styles.wrapCompact]}>
        <Svg width={compact ? VIEW_W * 0.5 : VIEW_W} height={compact ? VIEW_H * 0.5 : VIEW_H} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          <Rect x={0} y={340} width={VIEW_W} height={60} fill="#3D2A16" />
          <Defs>
            <RadialGradient id="dormantSeedGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#8B6914" stopOpacity={0.9} />
              <Stop offset="100%" stopColor="#8B6914" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <AnimatedCircle cx={CX} cy={355} r={30} fill="url(#dormantSeedGlow)" opacity={dormantGlow} />
          <Ellipse cx={CX} cy={355} rx={12} ry={16} fill="#8B6914" />
        </Svg>
        {!compact && <Text style={styles.captionText}>Resting. Ready when you are.</Text>}
      </View>
    );
  }

  // ── Seed stage: tiny sprouting shoot ──
  if (treeData.growthStage === "seed") {
    return (
      <Animated.View style={[styles.wrap, compact && styles.wrapCompact, { transform: [{ rotate: swayRotate }] }]}>
        <Svg width={compact ? VIEW_W * 0.5 : VIEW_W} height={compact ? VIEW_H * 0.5 : VIEW_H} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          <Rect x={0} y={340} width={VIEW_W} height={60} fill="#3D2A16" />
          <Path d={`M ${CX} 340 L ${CX - 6} 355 M ${CX} 340 L ${CX + 8} 358`} stroke="#8B6914" strokeWidth={3} />
          <Rect x={CX - 5} y={300} width={10} height={40} rx={5} fill="#4A7C59" />
          <Ellipse cx={CX - 10} cy={298} rx={12} ry={7} fill="#4A7C59" />
          <Ellipse cx={CX + 10} cy={298} rx={12} ry={7} fill="#4A7C59" />
        </Svg>
        {!compact && <Text style={styles.captionText}>A seed has been planted.</Text>}
      </Animated.View>
    );
  }

  const roots = Array.from({ length: rootDepth }, (_, i) => {
    const spread = (i - (rootDepth - 1) / 2) * 12;
    const endX = CX + spread * 1.6;
    return `M ${CX} ${TRUNK_BASE_Y} Q ${CX + spread * 0.5} ${TRUNK_BASE_Y + 15} ${endX} ${TRUNK_BASE_Y + 35}`;
  });

  const branches: { x1: number; y1: number; x2: number; y2: number; wilting: boolean; menteeIndex: number }[] = [];
  for (let i = 0; i < branchCount; i++) {
    const pairIndex = Math.floor(i / 2);
    const side: "l" | "r" = i % 2 === 0 ? "l" : "r";
    const heightFrac = 0.7 + pairIndex * 0.15;
    const y1 = TRUNK_BASE_Y - trunkHeightPx * clamp(heightFrac, 0, 1);
    const dir = side === "l" ? -1 : 1;
    const wilting = i < treeData.wiltingMentees;
    branches.push({
      x1: CX, y1,
      x2: CX + dir * 55, y2: y1 - (wilting ? 10 : 30),
      wilting, menteeIndex: i,
    });
  }

  const fruitPositions = fruits.slice(0, 8).map((f, i) => {
    const angle = (i / Math.max(1, Math.min(fruits.length, 8))) * Math.PI * 2 - Math.PI / 2;
    const r = canopyRadius * 0.75;
    return { ...f, x: CX + Math.cos(angle) * r, y: canopyCenterY + Math.sin(angle) * r * 0.7 };
  });

  const droughtCrackPath = `M ${CX} ${trunkTopY + trunkHeightPx * 0.25} L ${CX - 2} ${trunkTopY + trunkHeightPx * 0.5} L ${CX + 2} ${trunkTopY + trunkHeightPx * 0.7} L ${CX - 1} ${trunkTopY + trunkHeightPx * 0.9}`;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <Animated.View style={{ transform: [{ rotate: isHealthySway ? swayRotate : "0deg" }] }}>
        <Svg width={compact ? VIEW_W * 0.5 : VIEW_W} height={compact ? VIEW_H * 0.5 : VIEW_H} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          <Defs>
            <RadialGradient id="rootGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={activeToday ? "#FFD700" : "#8B6914"} stopOpacity={0.5} />
              <Stop offset="100%" stopColor={activeToday ? "#FFD700" : "#8B6914"} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="trunkGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#F4A261" stopOpacity={0.35} />
              <Stop offset="100%" stopColor="#F4A261" stopOpacity={0} />
            </RadialGradient>
          </Defs>

          {/* Soil */}
          <Rect x={0} y={340} width={VIEW_W} height={60} fill="#3D2A16" />

          {/* Roots */}
          <G onPress={() => handleTap("roots")}>
            {activeToday && <Circle cx={CX} cy={TRUNK_BASE_Y + 15} r={45} fill="url(#rootGlow)" />}
            {roots.map((d, i) => (
              <Path key={i} d={d} stroke="#8B6914" strokeWidth={3} fill="none" strokeLinecap="round" />
            ))}
            {/* Invisible wider hit-area so a thin root fan is still easy to tap */}
            <Rect x={CX - 70} y={TRUNK_BASE_Y - 10} width={140} height={70} fill="transparent" />
          </G>

          {/* Trunk */}
          <G onPress={() => handleTap("trunk")}>
            {treeData.streakDays > 7 && <Circle cx={CX} cy={trunkTopY + trunkHeightPx / 2} r={trunkWidthPx + 20} fill="url(#trunkGlow)" />}
            <Rect
              x={CX - trunkWidthPx / 2} y={trunkTopY}
              width={trunkWidthPx} height={trunkHeightPx}
              rx={trunkWidthPx / 4}
              fill="#5C3D1E"
            />
            {isDrought && (
              <Path d={droughtCrackPath} stroke="#3D2009" strokeWidth={1.5} fill="none" />
            )}
          </G>

          {/* Branches */}
          {branches.map((b, i) => (
            <G key={i} onPress={() => handleTap(b.menteeIndex)}>
              <Path
                d={`M ${b.x1} ${b.y1} Q ${(b.x1 + b.x2) / 2} ${(b.y1 + b.y2) / 2 + (b.wilting ? 15 : -10)} ${b.x2} ${b.y2}`}
                stroke={b.wilting ? "#8B9467" : "#4A7C59"}
                strokeWidth={8}
                strokeLinecap="round"
                fill="none"
              />
            </G>
          ))}
          {mentees.length > branchCount && (
            <Ellipse cx={CX} cy={trunkTopY + trunkHeightPx * 0.6} rx={6} ry={4} fill="#3D2009" />
          )}
          {branchCount === 0 && (
            <Path d={`M ${CX} ${trunkTopY} L ${CX} ${trunkTopY - 20}`} stroke="#5C3D1E" strokeWidth={trunkWidthPx * 0.5} strokeLinecap="round" />
          )}

          {/* Canopy */}
          <G onPress={() => handleTap("canopy")}>
            <Ellipse
              cx={CX} cy={canopyCenterY}
              rx={treeData.growthStage === "forest_builder" ? canopyRadius * 1.1 : canopyRadius}
              ry={(treeData.growthStage === "forest_builder" ? canopyRadius * 1.1 : canopyRadius) * 0.75}
              fill={activeToday ? "#4A7C59" : "#2D6A4F"}
              opacity={0.9}
            />
            {Array.from({ length: 10 }, (_, i) => {
              const a = (i / 10) * Math.PI * 2;
              const r = canopyRadius * 0.6;
              return (
                <Ellipse
                  key={i}
                  cx={CX + Math.cos(a) * r}
                  cy={canopyCenterY + Math.sin(a) * r * 0.75}
                  rx={10} ry={6}
                  fill="#3D8361"
                  opacity={0.5}
                />
              );
            })}
          </G>

          {/* Fruit */}
          {fruitPositions.map((f) => {
            const isNew = Date.now() - new Date(f.awardedAt).getTime() < 24 * 60 * 60 * 1000;
            const color = FRUIT_CATEGORY_COLOR[f.category] ?? "#F4A261";
            return (
              <AnimatedCircle
                key={f.fruitKey}
                cx={f.x} cy={f.y} r={8}
                fill={color}
                stroke="#fff" strokeWidth={1}
                onPress={() => onTapFruit?.(f.fruitKey)}
                transform={isNew ? [{ scale: fruitPulse }] : undefined}
                origin={`${f.x}, ${f.y}`}
              />
            );
          })}
        </Svg>
      </Animated.View>

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
  wrap: { alignItems: "center", justifyContent: "center", position: "relative" },
  wrapCompact: {},
  captionText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 8, textAlign: "center" },
  fruitBadge: {
    position: "absolute", top: 4, right: 4,
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: colors.amber, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3,
  },
  fruitBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  tooltipOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 30 },
  tooltipCard: { backgroundColor: colors.card, borderRadius: 16, padding: 20, width: "100%", maxWidth: 320, gap: 6 },
  tooltipTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
  tooltipLine: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
});