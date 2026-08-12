import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Animated, Alert, Platform } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Ellipse, Rect, Path, G } from "react-native-svg";
import { useAuth } from "@/contexts/AuthContext";
import { useData, GenerationalForestData, ForestPerson } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import { getStageFromPoints } from "@/constants/stages";
import { getContinent, getFlagEmoji, CONTINENT_LABELS, type Continent } from "@/lib/countryGeo";

// The Generational Forest View — signature discipleship-lineage visualization.
// "My Forest" renders self + up to 3 generations of mentees as an SVG grove
// with an ancestry strip above and root-connection paths below; "Global"
// renders the same lineage's countries as a simplified continent map (no
// external map library — see the CONTINENT_ZONES blob paths below).

const STAGE_COLORS = ["#9CA3AF", "#8FBF7F", "#4CAF6E", "#1D9E75", "#B8860B"];
function stageColorFor(growthLevel: number) {
  return STAGE_COLORS[Math.min(getStageFromPoints(growthLevel), STAGE_COLORS.length - 1)];
}
function isActiveRecently(lastActiveAt: string | null, days: number) {
  if (!lastActiveAt) return false;
  return Date.now() - new Date(lastActiveAt).getTime() <= days * 24 * 60 * 60 * 1000;
}

function showInfo(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// ── Mini tree (SVG) ──────────────────────────────────────────────────────────

function MiniTree({ cx, cy, scale, color, wilted, label, onPress }: {
  cx: number; cy: number; scale: number; color: string; wilted: boolean; label?: string; onPress?: () => void;
}) {
  const trunkH = 26 * scale;
  const trunkW = 6 * scale;
  const canopyR = 16 * scale;
  return (
    <G onPress={onPress}>
      {wilted ? null : (
        <Circle cx={cx} cy={cy - trunkH - canopyR * 0.4} r={canopyR * 1.35} fill={color} opacity={0.14} />
      )}
      <Rect x={cx - trunkW / 2} y={cy - trunkH} width={trunkW} height={trunkH} rx={trunkW / 2} fill={wilted ? "#8A7A63" : "#7A5A3A"} />
      <Ellipse cx={cx} cy={cy - trunkH - canopyR * 0.5} rx={canopyR} ry={canopyR * 0.85} fill={wilted ? "#B9B0A0" : color} opacity={wilted ? 0.6 : 1} />
      {label ? (
        <Circle cx={cx} cy={cy + 3} r={2 * scale} fill="transparent" />
      ) : null}
    </G>
  );
}

// ── My Forest tab ─────────────────────────────────────────────────────────────

const VIEW_W = 340;
const VIEW_H = 260;
const GROUND_Y = 210;

function AncestryStrip({ data, onTapPerson }: { data: GenerationalForestData; onTapPerson: (p: ForestPerson) => void }) {
  if (data.ancestry.length === 0) {
    return (
      <View style={styles.ancestryEmpty}>
        <Text style={styles.ancestryEmptyText}>Your story begins here 🌱</Text>
      </View>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ancestryRow}>
      {data.ancestry.map((a) => (
        <React.Fragment key={a.userId}>
          <TouchableOpacity
            style={styles.ancestryNode}
            onPress={() => onTapPerson(a)}
          >
            <View style={[styles.ancestryAvatar, { borderColor: stageColorFor(a.growthLevel) }]}>
              <Text style={styles.ancestryAvatarInitial}>{a.displayName.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.ancestryName} numberOfLines={1}>{a.displayName.split(" ")[0]}</Text>
            <Text style={styles.ancestryFlag}>{getFlagEmoji(a.country)}</Text>
          </TouchableOpacity>
          <Ionicons name="arrow-forward" size={14} color={colors.textMuted} style={{ marginTop: 14 }} />
        </React.Fragment>
      ))}
      <View style={styles.ancestryNode}>
        <View style={[styles.ancestryAvatar, styles.ancestryAvatarSelf]}>
          <Text style={styles.ancestryEmoji}>🌳</Text>
        </View>
        <Text style={[styles.ancestryName, { color: colors.primaryGreen, fontFamily: "Inter_700Bold" }]}>You</Text>
      </View>
    </ScrollView>
  );
}

function ForestCanvas({ data, revealProgress, onTapPerson }: {
  data: GenerationalForestData; revealProgress: Animated.Value; onTapPerson: (p: ForestPerson | { userId: string; country: string | null; growthLevel: number }) => void;
}) {
  const cx = VIEW_W / 2;
  const gen1 = data.mentees;
  const gen1Count = gen1.length;

  if (gen1Count === 0) {
    return (
      <View style={styles.canvasWrap}>
        <Svg width={VIEW_W} height={VIEW_H} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          <MiniTree cx={cx} cy={GROUND_Y} scale={2.1} color={stageColorFor(data.self.growthLevel)} wilted={false} />
        </Svg>
        <Text style={styles.canvasEmptyText}>Your forest begins with one person</Text>
        <TouchableOpacity style={styles.findGuideBtn} onPress={() => onTapPerson(data.self)}>
          <Text style={styles.findGuideBtnText}>View My Tree</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Gen1 laid out in a semicircle arc above ground level, gen2 smaller and
  // further out beneath each gen1 parent, gen3+ compressed to tiny dots.
  const arcSpan = Math.min(150, 30 + gen1Count * 26);
  const startAngle = -90 - arcSpan / 2;
  const gen1Positions = gen1.map((m, i) => {
    const angle = gen1Count === 1 ? -90 : startAngle + (arcSpan * i) / (gen1Count - 1);
    const rad = (angle * Math.PI) / 180;
    const radius = 95;
    return { node: m, x: cx + Math.cos(rad) * radius, y: GROUND_Y + Math.sin(rad) * radius * 0.72 };
  });

  const rootPaths = gen1Positions.map((p, i) => `M ${cx} ${GROUND_Y} Q ${(cx + p.x) / 2} ${GROUND_Y + 18} ${p.x} ${p.y}`);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.canvasWrap}>
      <Animated.View style={{ transform: [{ scale: revealProgress }] }}>
        <Svg width={Math.max(VIEW_W, gen1Count * 90)} height={VIEW_H} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          {rootPaths.map((d, i) => (
            <Path key={i} d={d} stroke="#B8860B" strokeWidth={1.6} opacity={0.55} fill="none" />
          ))}

          {gen1Positions.map(({ node, x, y }) => {
            const gen2 = node.mentees;
            const gen2Positions = gen2.map((g2, gi) => {
              const spread = 34;
              const gx = x + (gi - (gen2.length - 1) / 2) * spread;
              const gy = y - 34;
              return { node: g2, x: gx, y: gy };
            });
            return (
              <G key={node.userId}>
                {gen2Positions.map((g2p, gi) => (
                  <Path key={gi} d={`M ${x} ${y} L ${g2p.x} ${g2p.y}`} stroke="#B8860B" strokeWidth={1} opacity={0.4} />
                ))}
                {gen2Positions.map((g2p) => {
                  const gen3 = g2p.node.mentees;
                  const gen3Dots = gen3.slice(0, 4);
                  return (
                    <G key={g2p.node.userId}>
                      <MiniTree
                        cx={g2p.x} cy={g2p.y} scale={0.85}
                        color={stageColorFor(g2p.node.growthLevel)}
                        wilted={!isActiveRecently(g2p.node.lastActiveAt, 14)}
                        onPress={() => onTapPerson(g2p.node)}
                      />
                      {gen3Dots.map((g3, i3) => (
                        <Circle
                          key={g3.userId}
                          cx={g2p.x + (i3 - (gen3Dots.length - 1) / 2) * 10}
                          cy={g2p.y - 20}
                          r={2.4}
                          fill={stageColorFor(g3.growthLevel)}
                          onPress={() => onTapPerson(g3)}
                        />
                      ))}
                      {gen3.length > 4 && (
                        <Circle cx={g2p.x + 20} cy={g2p.y - 24} r={7} fill={colors.cardBeige} />
                      )}
                    </G>
                  );
                })}

                <MiniTree
                  cx={x} cy={y} scale={1.25}
                  color={stageColorFor(node.growthLevel)}
                  wilted={!isActiveRecently(node.lastActiveAt, 14)}
                  onPress={() => onTapPerson(node)}
                />
              </G>
            );
          })}

          <MiniTree cx={cx} cy={GROUND_Y} scale={1.9} color={stageColorFor(data.self.growthLevel)} wilted={false} />
        </Svg>
      </Animated.View>

      {/* Flag labels overlaid above each gen1 tree — simpler and more legible
          than embedding emoji text inside the SVG canvas. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {gen1Positions.map(({ node, x, y }) => (
          <Text key={node.userId} style={[styles.flagOverlay, { left: x - 10, top: y - 34 * 1.25 - 40 }]}>
            {getFlagEmoji(node.country)}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

function StatChip({ icon, value, label, onPress }: { icon: string; value: number; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.statChip} onPress={onPress}>
      <Text style={styles.statChipIcon}>{icon}</Text>
      <Text style={styles.statChipValue}>{value}</Text>
      <Text style={styles.statChipLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Global tab ─────────────────────────────────────────────────────────────

// Rough, stylized continent zones (not geographically precise — react-native
// doesn't have an external map library here) laid out on a fixed 300x180
// canvas, just accurate enough in relative position/size to read as "a
// world map" while staying honest about which countries are lit.
const CONTINENT_ZONES: { key: Continent; d: string; labelX: number; labelY: number }[] = [
  { key: "north_america", d: "M20,20 Q10,50 25,80 Q45,95 70,75 Q80,45 60,20 Q40,10 20,20 Z", labelX: 42, labelY: 50 },
  { key: "south_america", d: "M55,95 Q45,120 55,150 Q65,165 75,150 Q80,120 70,95 Q62,88 55,95 Z", labelX: 63, labelY: 128 },
  { key: "europe", d: "M140,15 Q132,32 145,42 Q165,45 172,28 Q165,12 140,15 Z", labelX: 153, labelY: 28 },
  { key: "africa", d: "M138,48 Q125,75 132,110 Q145,135 165,125 Q178,90 170,55 Q155,42 138,48 Z", labelX: 152, labelY: 88 },
  { key: "asia", d: "M178,15 Q170,45 190,70 Q225,80 260,55 Q265,25 230,12 Q200,5 178,15 Z", labelX: 220, labelY: 42 },
  { key: "oceania", d: "M225,110 Q218,130 235,140 Q258,138 260,120 Q248,105 225,110 Z", labelX: 240, labelY: 122 },
];

function GlobalMap({ countriesRepresented, selfCountry }: { countriesRepresented: string[]; selfCountry: string | null }) {
  const litContinents = new Set(countriesRepresented.map((c) => getContinent(c)).filter((c): c is Continent => !!c));
  const selfContinent = getContinent(selfCountry);

  return (
    <Svg width="100%" height={190} viewBox="0 0 280 175">
      {CONTINENT_ZONES.map((zone) => {
        const isSelf = zone.key === selfContinent;
        const isLit = litContinents.has(zone.key);
        const fill = isSelf ? colors.primaryGreen : isLit ? "#B8860B" : colors.borderBeige;
        const opacity = isSelf ? 0.9 : isLit ? 0.65 : 0.4;
        return <Path key={zone.key} d={zone.d} fill={fill} opacity={opacity} stroke="#fff" strokeWidth={0.5} />;
      })}
    </Svg>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

type Tab = "mine" | "global";

export default function ForestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { forestData, forestDataLoading, loadForestData } = useData();
  const params = useLocalSearchParams<{ reveal?: string }>();
  const isReveal = params.reveal === "true";

  const [tab, setTab] = useState<Tab>("mine");
  const [refreshing, setRefreshing] = useState(false);
  const revealScale = useRef(new Animated.Value(isReveal ? 0.35 : 1)).current;
  const statsOpacity = useRef(new Animated.Value(isReveal ? 0 : 1)).current;

  const load = useCallback(async () => {
    if (!profile?.id) return;
    await loadForestData(profile.id);
  }, [profile?.id, loadForestData]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isReveal || !forestData) return;
    Animated.sequence([
      Animated.timing(revealScale, { toValue: 1, duration: 3000, useNativeDriver: true }),
      Animated.timing(statsOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [isReveal, forestData, revealScale, statsOpacity]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function handleTapPerson(p: { userId: string; displayName?: string; country: string | null; growthLevel: number }) {
    const name = "displayName" in p ? p.displayName : "A disciple";
    showInfo(name ?? "A disciple", `${getFlagEmoji(p.country)} ${p.country ?? "Unknown location"}\nGrowth level ${p.growthLevel}`);
  }

  function handleStatTap(label: string, explanation: string) {
    showInfo(label, explanation);
  }

  const totalTrees = 1 + (forestData?.stats.totalInLineage ?? 0);
  const countriesCount = forestData?.stats.countriesRepresented.length ?? 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color={colors.primaryGreen} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Generational Forest</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.segmentRow}>
        <TouchableOpacity style={[styles.segmentBtn, tab === "mine" && styles.segmentBtnActive]} onPress={() => setTab("mine")}>
          <Text style={[styles.segmentText, tab === "mine" && styles.segmentTextActive]}>My Forest</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentBtn, tab === "global" && styles.segmentBtnActive]} onPress={() => setTab("global")}>
          <Text style={[styles.segmentText, tab === "global" && styles.segmentTextActive]}>Global</Text>
        </TouchableOpacity>
      </View>

      {forestDataLoading && !forestData ? (
        <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : !forestData ? (
        <View style={styles.loading}><Text style={styles.errorText}>Couldn't load your forest.</Text></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentGreen} />}
        >
          {tab === "mine" ? (
            <>
              <Text style={styles.sectionLabel}>YOUR LINEAGE</Text>
              <AncestryStrip data={forestData} onTapPerson={handleTapPerson} />

              <ForestCanvas data={forestData} revealProgress={revealScale} onTapPerson={handleTapPerson} />

              <Animated.View style={[styles.statsBar, { opacity: statsOpacity }]}>
                <StatChip icon="🌳" value={totalTrees} label="Trees" onPress={() => handleStatTap("Trees", "Every person in your discipleship lineage — you and everyone you or your disciples have mentored.")} />
                <StatChip icon="🌍" value={countriesCount} label="Nations" onPress={() => handleStatTap("Nations", "The number of countries represented across your entire lineage.")} />
                <StatChip icon="📖" value={forestData.stats.totalModulesCompletedAcrossLineage} label="Modules" onPress={() => handleStatTap("Modules", "Total Foundation modules completed across your whole lineage.")} />
                <StatChip icon="🍇" value={forestData.stats.totalFruitsAcrossLineage} label="Fruits" onPress={() => handleStatTap("Fruits", "Total spiritual fruits awarded across your whole lineage.")} />
              </Animated.View>
            </>
          ) : (
            <View style={styles.globalWrap}>
              <GlobalMap countriesRepresented={forestData.stats.countriesRepresented} selfCountry={forestData.self.country} />
              {countriesCount > 0 ? (
                <>
                  <Text style={styles.globalHeadline}>Your discipleship has touched {countriesCount} nation{countriesCount === 1 ? "" : "s"}</Text>
                  <View style={styles.flagRow}>
                    {forestData.stats.countriesRepresented.map((c) => (
                      <View key={c} style={styles.flagChip}>
                        <Text style={styles.flagChipEmoji}>{getFlagEmoji(c)}</Text>
                        <Text style={styles.flagChipText}>{c}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={styles.globalHeadline}>Your first international connection is one conversation away</Text>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },

  segmentRow: {
    flexDirection: "row", marginHorizontal: 20, marginBottom: 10,
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 4,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segmentBtnActive: { backgroundColor: colors.primaryGreen },
  segmentText: { fontSize: 13, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  segmentTextActive: { color: "#fff" },

  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },

  sectionLabel: { fontSize: 11, letterSpacing: 1.2, color: colors.amber, fontFamily: "Inter_600SemiBold", marginLeft: 20, marginBottom: 8 },

  ancestryRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 20, gap: 8, paddingBottom: 8 },
  ancestryEmpty: { paddingHorizontal: 20, paddingVertical: 10 },
  ancestryEmptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  ancestryNode: { alignItems: "center", width: 56, gap: 2 },
  ancestryAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, backgroundColor: colors.cardBeige, alignItems: "center", justifyContent: "center" },
  ancestryAvatarSelf: { borderColor: colors.primaryGreen, backgroundColor: "rgba(29,158,117,0.1)" },
  ancestryAvatarInitial: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  ancestryEmoji: { fontSize: 18 },
  ancestryName: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_500Medium" },
  ancestryFlag: { fontSize: 12 },

  canvasWrap: { alignItems: "center", marginTop: 12 },
  canvasEmptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
  findGuideBtn: { marginTop: 12, backgroundColor: colors.accentGreen, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 9 },
  findGuideBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  flagOverlay: { position: "absolute", fontSize: 14, width: 20, textAlign: "center" },

  statsBar: { flexDirection: "row", justifyContent: "space-around", marginHorizontal: 20, marginTop: 20, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, paddingVertical: 14 },
  statChip: { alignItems: "center", gap: 2, minWidth: 60 },
  statChipIcon: { fontSize: 18 },
  statChipValue: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  statChipLabel: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },

  globalWrap: { paddingHorizontal: 20, paddingTop: 12, alignItems: "center" },
  globalHeadline: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 12, marginBottom: 14, paddingHorizontal: 10 },
  flagRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  flagChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  flagChipEmoji: { fontSize: 14 },
  flagChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
});