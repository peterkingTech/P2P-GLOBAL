import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";
import { useAuth } from "@/contexts/AuthContext";
import { useData, ForestNode } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import { VerificationBadge } from "@/components/VerificationBadge";
import { STAGES, getStageFromPoints } from "@/constants/stages";
import { getWatchGrowthPlan, GROWTH_VIDEO_SOURCE, STAGE_VIDEO_SEGMENTS, LAST_VIDEO_STAGE_INDEX } from "@/constants/growthVideo";
import { GrowthVideoModal } from "@/components/GrowthVideoModal";
import { ForestTransition } from "@/components/ForestTransition";
import LivingTree, { stageLabel } from "@/components/LivingTree";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";

const ROLE_COLORS: Record<string, string> = {
  super_admin: colors.brightYellow,
  moderator: colors.brightYellow,
  regional_admin: colors.accentGreen,
  church_leader: colors.accentGreen,
  peer_guide: colors.lightGreen,
  student: colors.borderBeige,
};

function NodeCard({ node, depth = 0 }: { node: ForestNode; depth?: number }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const roleColor = ROLE_COLORS[node.role] ?? colors.borderBeige;

  return (
    <View style={[styles.nodeWrapper, { marginLeft: depth * 20 }]}>
      <View style={styles.nodeRow}>
        {hasChildren && (
          <TouchableOpacity onPress={() => setExpanded((e) => !e)} style={styles.expandBtn}>
            <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        {!hasChildren && <View style={{ width: 24 }} />}

        <TouchableOpacity
          style={[styles.nodeCard, depth === 0 && styles.rootNode]}
          activeOpacity={depth > 0 && node.username ? 0.7 : 1}
          onPress={() => { if (depth > 0 && node.username) router.push(`/profile/${node.username}` as any); }}
        >
          <View style={[styles.avatarCircle, { borderColor: roleColor }]}>
            <Text style={styles.avatarInitial}>{node.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={[styles.nodeName, depth === 0 && styles.rootNodeName]}>
                {node.username ? `@${node.username}` : node.name} {depth === 0 ? "(You)" : ""}
              </Text>
              <VerificationBadge isVerified={!!node.isVerified} username={node.username} size="small" />
            </View>
            {node.username && <Text style={styles.nodeRealName}>{node.name}</Text>}
            <View style={styles.nodeMeta}>
              <View style={[styles.rolePill, { backgroundColor: `${roleColor}22` }]}>
                <Text style={[styles.roleText, { color: roleColor }]}>{node.role}</Text>
              </View>
              {node.country && <Text style={styles.nodeCountry}>{node.country}</Text>}
            </View>
          </View>
          <View style={styles.levelPill}>
            <Text style={styles.levelText}>Lv{node.growthLevel}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {expanded && hasChildren && (
        <View style={styles.children}>
          <View style={styles.branchLine} />
          <View style={{ flex: 1 }}>
            {node.children.map((child) => (
              <NodeCard key={child.id} node={child} depth={depth + 1} />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

export default function LivingTreeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { isTablet } = useLayout();
  const { profile } = useAuth();
  const { forestNodes, forestStats, isLoading, treeData } = useData();
  const params = useLocalSearchParams<{ prevStage?: string; tab?: string }>();
  const [tab, setTab] = useState<"tree" | "forest">(params.tab === "forest" ? "forest" : "tree");
  const [videoPlan, setVideoPlan] = useState<{ start: number; end: number } | null>(null);
  const [showForestTransition, setShowForestTransition] = useState(false);
  const [heroVideoFailed, setHeroVideoFailed] = useState(false);
  const autoTriggeredRef = useRef(false);
  const heroVideoRef = useRef<Video>(null);
  const heroSeekedRef = useRef(false);

  const growthPoints = profile?.growthLevel ?? 0;
  const stageIndex = getStageFromPoints(growthPoints);
  const stage = STAGES[stageIndex];
  const nextStage = STAGES[stageIndex + 1] ?? null;

  const prevPoints = stage.unlockPoints;
  const nextPoints = nextStage?.unlockPoints ?? prevPoints;
  const progressPct = nextStage
    ? Math.round(((growthPoints - prevPoints) / (nextPoints - prevPoints)) * 100)
    : 100;
  const pointsNeeded = nextStage ? nextPoints - growthPoints : 0;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  async function handleWatchGrowth(prevStageIndex: number | null = null) {
    const seenKey = `forest_transition_seen_${profile?.id ?? "anon"}`;
    let hasSeen = false;
    try { hasSeen = (await AsyncStorage.getItem(seenKey)) === "true"; } catch {}

    const plan = getWatchGrowthPlan(stageIndex, prevStageIndex, hasSeen);
    if (plan.type === "segment" || plan.type === "levelup-video") {
      setVideoPlan({ start: plan.start, end: plan.end });
    } else if (plan.type === "forest-transition") {
      setShowForestTransition(true);
      try { await AsyncStorage.setItem(seenKey, "true"); } catch {}
    } else {
      setTab("forest");
    }
  }

  useEffect(() => {
    if (autoTriggeredRef.current) return;
    if (params.prevStage === undefined) return;
    autoTriggeredRef.current = true;
    const prevStageIndex = Number(params.prevStage);
    handleWatchGrowth(Number.isFinite(prevStageIndex) ? prevStageIndex : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.prevStage]);

  // Ambient hero video — plays the current stage's segment of the growth
  // video on a continuous loop (re-seeking to the segment start instead of
  // pausing, unlike the one-shot GrowthVideoModal). Only stages 0-3 have
  // footage (see constants/growthVideo.ts); stages 4-5 and any load failure
  // fall back to the SVG tree.
  const hasHeroVideo = stageIndex <= LAST_VIDEO_STAGE_INDEX && !heroVideoFailed;
  const heroSegment = STAGE_VIDEO_SEGMENTS[Math.min(stageIndex, LAST_VIDEO_STAGE_INDEX)];

  useEffect(() => {
    heroSeekedRef.current = false;
  }, [stageIndex]);

  async function handleHeroLoad() {
    if (heroSeekedRef.current) return;
    heroSeekedRef.current = true;
    await heroVideoRef.current?.setPositionAsync(heroSegment.start * 1000);
    await heroVideoRef.current?.playAsync();
  }

  async function handleHeroStatus(status: AVPlaybackStatus) {
    if (!status.isLoaded) return;
    if (status.positionMillis >= heroSegment.end * 1000 - 80) {
      await heroVideoRef.current?.setPositionAsync(heroSegment.start * 1000);
      await heroVideoRef.current?.playAsync();
    }
  }

  const { modules } = useData();
  const completedLessons = modules.reduce((a, m) => a + m.completedLessons, 0);
  const countriesCount = forestStats.countriesReached.length;
  const activities: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    ...(completedLessons > 0 ? [{ icon: "book" as const, label: `${completedLessons} ${completedLessons === 1 ? "lesson" : "lessons"} completed` }] : []),
    ...(forestStats.totalDisciples > 0 ? [{ icon: "person-add" as const, label: `${forestStats.totalDisciples} ${forestStats.totalDisciples === 1 ? "disciple" : "disciples"} in your network` }] : []),
    ...(countriesCount > 0 ? [{ icon: "globe-outline" as const, label: `${countriesCount} ${countriesCount === 1 ? "country" : "countries"} reached` }] : []),
  ];

  const totalNodes = forestNodes.reduce((acc, n) => acc + 1 + countDescendants(n), 0);
  function countDescendants(node: ForestNode): number {
    return node.children.reduce((a, c) => a + 1 + countDescendants(c), 0);
  }
  const isForestBuilder = stageIndex === 4;
  const isForestOfNations = stageIndex >= 5;
  const heroHeight = Math.min(screenWidth * 1.05, 320);

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={20} color={colors.primaryGreen} />
        <Text style={styles.backLabel}>Home</Text>
      </TouchableOpacity>

      <View style={styles.segmentRow}>
        <TouchableOpacity
          style={[styles.segmentBtn, tab === "tree" && styles.segmentBtnActive]}
          onPress={() => setTab("tree")}
        >
          <Text style={[styles.segmentText, tab === "tree" && styles.segmentTextActive]}>My Tree</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentBtn, tab === "forest" && styles.segmentBtnActive]}
          onPress={() => setTab("forest")}
        >
          <Text style={[styles.segmentText, tab === "forest" && styles.segmentTextActive]}>Global Forest</Text>
        </TouchableOpacity>
      </View>

      {tab === "tree" && (
        <View style={[styles.videoHero, { width: screenWidth, height: heroHeight }]}>
          {hasHeroVideo ? (
            <Video
              ref={heroVideoRef}
              source={GROWTH_VIDEO_SOURCE}
              style={{ width: screenWidth, height: heroHeight }}
              videoStyle={{ width: screenWidth, height: heroHeight }}
              resizeMode={ResizeMode.COVER}
              isMuted
              isLooping={false}
              shouldPlay
              onLoad={handleHeroLoad}
              onPlaybackStatusUpdate={handleHeroStatus}
              onError={() => setHeroVideoFailed(true)}
            />
          ) : treeData ? (
            <View style={[styles.videoHeroFallback, { width: screenWidth, height: heroHeight }]}>
              <LivingTree treeData={treeData} compact />
            </View>
          ) : (
            <View style={[styles.videoHeroPlayer, styles.loading, { width: screenWidth, height: heroHeight }]}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
          <View style={styles.videoHeroLabel}>
            <Text style={styles.videoHeroEmoji}>{stage.emoji}</Text>
            <Text style={styles.videoHeroText}>{stage.name}</Text>
          </View>
          <TouchableOpacity style={styles.videoHeroWatchBtn} activeOpacity={0.85} onPress={() => handleWatchGrowth()}>
            <Ionicons name="play" size={12} color="#fff" />
            <Text style={styles.videoHeroWatchBtnText}>Watch full growth story</Text>
          </TouchableOpacity>
        </View>
      )}

      {tab === "tree" ? (
        <ScrollView
          style={styles.screen}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 120 },
            isTablet && { maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" as any, width: "100%" },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.introLabel}>P2P GLOBAL BIBLE STUDY NETWORK</Text>
          <Text style={styles.pageTitle}>The Living Tree</Text>
          <Text style={styles.pageDesc}>
            Your tree grows only from what you actually do — every lesson finished, prayer offered,
            session shared, and disciple invited. No shortcuts, just organic growth from a seed to a
            forest of nations.
          </Text>

          {/* Vertical stat rows */}
          <View style={styles.statRowsCard}>
            <View style={styles.statRow}>
              <Text style={styles.statRowLabel}>Growth Level</Text>
              <Text style={styles.statRowValue}>{growthPoints}</Text>
            </View>
            <View style={styles.statRowDivider} />
            <View style={styles.statRow}>
              <Text style={styles.statRowLabel}>Connected</Text>
              <Text style={styles.statRowValue}>{totalNodes}</Text>
            </View>
            <View style={styles.statRowDivider} />
            <View style={styles.statRow}>
              <Text style={styles.statRowLabel}>Disciples</Text>
              <Text style={styles.statRowValue}>{forestStats.totalDisciples}</Text>
            </View>
            <View style={styles.statRowDivider} />
            <View style={styles.statRow}>
              <Text style={styles.statRowLabel}>Countries Reached</Text>
              <Text style={styles.statRowValue}>{countriesCount}</Text>
            </View>
          </View>

          <View style={styles.stageCard}>
            <View style={styles.stageTopRow}>
              <Text style={styles.stageOf}>STAGE {stageIndex + 1} OF 6</Text>
              <View style={styles.dots}>
                {STAGES.map((_, i) => (
                  <View key={i} style={[styles.dot, i === stageIndex ? styles.dotActive : i < stageIndex ? styles.dotDone : styles.dotLocked]} />
                ))}
              </View>
            </View>

            <View style={styles.stageNameRow}>
              <Text style={styles.stageEmoji}>{stage.emoji}</Text>
              <Text style={styles.stageName}>{stage.name}</Text>
            </View>

            {nextStage && (
              <View style={styles.progressSection}>
                <View style={styles.progressLabelRow}>
                  <Text style={styles.progressToward}>Growing toward {nextStage.emoji} {nextStage.name}</Text>
                  <Text style={styles.progressPct}>{progressPct}%</Text>
                </View>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
                </View>
                <Text style={styles.pointsHint}>{pointsNeeded} more points of shared study, prayer, and mentoring to grow again.</Text>
              </View>
            )}
          </View>

          {treeData && (
            <View style={styles.treeDataCard}>
              <Text style={styles.treeStageLabel}>{stageLabel(treeData.growthStage)}</Text>
              <View style={styles.treeStatsRow}>
                <Text style={styles.treeStatItem}>{treeData.fruitCount} fruit</Text>
                <Text style={styles.treeStatDot}>·</Text>
                <Text style={styles.treeStatItem}>{treeData.activeMentees} mentee{treeData.activeMentees === 1 ? "" : "s"}</Text>
              </View>
            </View>
          )}

          <View style={styles.descSection}>
            <Text style={styles.descText}>{stage.description}</Text>
            <View style={styles.verseBlock}>
              <Text style={styles.verseItalic}>{stage.verse} — {stage.verseRef}</Text>
            </View>
          </View>

          {activities.length > 0 && (
            <View style={styles.grewSection}>
              <Text style={styles.grewLabel}>WHAT GREW YOUR TREE</Text>
              <View style={styles.grewChips}>
                {activities.map((a, i) => (
                  <View key={i} style={styles.chip}>
                    <Ionicons name={a.icon} size={13} color={colors.accentGreen} />
                    <Text style={styles.chipText}>{a.label}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.tapHint}>Tap the roots, trunk, branches, canopy, or fruit to explore each one.</Text>
            </View>
          )}

          <TouchableOpacity style={styles.allStagesBtn} onPress={() => setTab("forest")} activeOpacity={0.8}>
            <Text style={styles.allStagesBtnText}>View My Forest</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primaryGreen} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.allStagesBtn} onPress={() => router.push("/stages")} activeOpacity={0.8}>
            <Text style={styles.allStagesBtnText}>The Six Stages of Growth</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primaryGreen} />
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.forestHeader}>
            {(isForestBuilder || isForestOfNations) && (
              <View style={[styles.stageBanner, isForestOfNations && styles.stageBannerNations]}>
                <Text style={styles.stageBannerEmoji}>{isForestOfNations ? "🌍" : "🌲"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stageBannerTitle}>{isForestOfNations ? "Forest of Nations" : "Forest Builder"}</Text>
                  <Text style={styles.stageBannerText}>
                    {isForestOfNations
                      ? `Your disciples are now active in ${countriesCount} nation${countriesCount === 1 ? "" : "s"} — generations shelter and multiply one another.`
                      : "You've raised a disciple who is now discipling others — you are no longer only growing, you are helping others take root."}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {isLoading ? (
            <View style={styles.loading}><ActivityIndicator color={colors.accentGreen} /></View>
          ) : forestNodes.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="git-branch-outline" size={48} color={colors.borderBeige} />
              <Text style={styles.emptyTitle}>Your forest is waiting</Text>
              <Text style={styles.emptyText}>Connect with a study partner to plant your first branch.</Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={[
                styles.list,
                { paddingBottom: insets.bottom + 100 },
                isTablet && { maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" as any, width: "100%" },
              ]}
              showsVerticalScrollIndicator={false}
            >
              {forestNodes.map((node) => (
                <NodeCard key={node.id} node={node} depth={0} />
              ))}
              <TouchableOpacity style={styles.viewFullForestBtn} onPress={() => router.push("/forest" as any)}>
                <Text style={styles.viewFullForestBtnText}>View Full Forest</Text>
                <Ionicons name="chevron-forward" size={16} color="#fff" />
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      )}

      {videoPlan && (
        <GrowthVideoModal
          startSec={videoPlan.start}
          endSec={videoPlan.end}
          stageName={stage.name}
          progressPct={progressPct}
          nextStageName={nextStage?.name ?? null}
          onClose={() => setVideoPlan(null)}
        />
      )}

      {showForestTransition && (
        <ForestTransition
          onDone={() => {
            setShowForestTransition(false);
            setTab("forest");
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  content: { paddingHorizontal: 20 },

  back: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, marginLeft: 20, marginBottom: 8, alignSelf: "flex-start" },
  backLabel: { fontSize: 15, color: colors.primaryGreen, fontFamily: "Inter_500Medium" },

  segmentRow: {
    flexDirection: "row", marginHorizontal: 20, marginBottom: 12,
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 4,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segmentBtnActive: { backgroundColor: colors.primaryGreen },
  segmentText: { fontSize: 13, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  segmentTextActive: { color: "#fff" },

  introLabel: { fontSize: 10, letterSpacing: 1.5, color: colors.amber, fontFamily: "Inter_600SemiBold", textAlign: "center", marginBottom: 6 },
  pageTitle: { fontSize: 26, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 10 },
  pageDesc: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, marginBottom: 20 },

  statRowsCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    marginBottom: 16, overflow: "hidden",
  },
  statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  statRowLabel: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_500Medium" },
  statRowValue: { fontSize: 16, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  statRowDivider: { height: 1, backgroundColor: colors.borderBeige, marginHorizontal: 16 },

  stageCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 16, marginBottom: 16 },
  stageTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  stageOf: { fontSize: 11, letterSpacing: 0.8, color: colors.textMuted, fontFamily: "Inter_600SemiBold" },
  dots: { flexDirection: "row", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotDone: { backgroundColor: colors.accentGreen },
  dotActive: { backgroundColor: colors.amber, width: 10, height: 10, borderRadius: 5 },
  dotLocked: { backgroundColor: colors.borderBeige },
  stageNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  stageEmoji: { fontSize: 22 },
  stageName: { fontSize: 22, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },

  progressSection: { gap: 6 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressToward: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  progressPct: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  progressBarBg: { height: 6, backgroundColor: colors.progressTrack, borderRadius: 3 },
  progressBarFill: { height: 6, backgroundColor: colors.progressFill, borderRadius: 3 },
  pointsHint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

  videoHero: { position: "relative", backgroundColor: "#0B0B0B", alignSelf: "center" },
  videoHeroPlayer: { width: "100%", height: "100%" },
  videoHeroFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  videoHeroLabel: {
    position: "absolute", bottom: 14, left: 14, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.48)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  videoHeroEmoji: { fontSize: 16 },
  videoHeroText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  videoHeroWatchBtn: {
    position: "absolute", top: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  videoHeroWatchBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium" },

  treeDataCard: {
    borderRadius: 16, marginBottom: 20, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, alignItems: "center", paddingVertical: 16,
  },
  treeStageLabel: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  treeStatsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  treeStatItem: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  treeStatDot: { color: colors.textMuted },

  descSection: { marginBottom: 20 },
  descText: { fontSize: 15, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 24, marginBottom: 12 },
  verseBlock: { borderLeftWidth: 3, borderLeftColor: colors.accentGreen, paddingLeft: 12 },
  verseItalic: { fontSize: 14, color: colors.textDark, fontStyle: "italic", fontFamily: "Inter_400Regular", lineHeight: 22 },

  grewSection: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 16, marginBottom: 16, gap: 10 },
  grewLabel: { fontSize: 11, letterSpacing: 1.2, color: colors.amber, fontFamily: "Inter_600SemiBold" },
  grewChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(29,158,117,0.2)",
  },
  chipText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium" },
  tapHint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic" },

  allStagesBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 16, marginBottom: 8,
  },
  allStagesBtnText: { fontSize: 15, fontWeight: "600", color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },

  forestHeader: { paddingHorizontal: 20 },
  stageBanner: {
    flexDirection: "row", gap: 10, alignItems: "center",
    backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(29,158,117,0.25)",
    padding: 12, marginBottom: 12,
  },
  stageBannerNations: { backgroundColor: "rgba(201,180,138,0.12)", borderColor: "rgba(201,180,138,0.35)" },
  stageBannerEmoji: { fontSize: 26 },
  stageBannerTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 2 },
  stageBannerText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  list: { paddingHorizontal: 16, paddingTop: 12 },
  viewFullForestBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.primaryGreen, borderRadius: 14, paddingVertical: 14, marginTop: 8,
  },
  viewFullForestBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  nodeWrapper: { marginBottom: 8 },
  nodeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  expandBtn: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  nodeCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 12, flexDirection: "row", gap: 10, alignItems: "center",
  },
  rootNode: { borderColor: colors.accentGreen, backgroundColor: "rgba(29,158,117,0.06)" },
  avatarCircle: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, backgroundColor: colors.cardBeige, alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  nodeName: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  nodeRealName: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
  rootNodeName: { color: colors.primaryGreen },
  nodeMeta: { flexDirection: "row", gap: 8, marginTop: 4, alignItems: "center" },
  rolePill: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  roleText: { fontSize: 10, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  nodeCountry: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  levelPill: { backgroundColor: colors.cardBeige, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  levelText: { fontSize: 11, fontWeight: "700", color: colors.textMid, fontFamily: "Inter_700Bold" },
  children: { flexDirection: "row", marginTop: 4 },
  branchLine: { width: 2, backgroundColor: colors.borderBeige, marginLeft: 28, marginRight: 8, borderRadius: 1 },
});
