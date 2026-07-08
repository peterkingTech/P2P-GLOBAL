import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { STAGES, STAGE_IMAGES, getStageFromPoints } from "@/constants/stages";

const { width: SW } = Dimensions.get("window");

const MOCK_GROWTH = {
  points: 4,
  lessonsCompleted: 1,
  prayersOffered: 2,
  sessionsCompleted: 0,
  disciplesInvited: 0,
};

export default function LivingTreeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();

  const growthPoints = MOCK_GROWTH.points;
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

  const activities: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    ...(MOCK_GROWTH.prayersOffered > 0
      ? [{ icon: "people" as const, label: `${MOCK_GROWTH.prayersOffered} prayers offered` }]
      : []),
    ...(MOCK_GROWTH.lessonsCompleted > 0
      ? [{ icon: "book" as const, label: `${MOCK_GROWTH.lessonsCompleted} lesson completed` }]
      : []),
    ...(MOCK_GROWTH.sessionsCompleted > 0
      ? [{ icon: "videocam" as const, label: `${MOCK_GROWTH.sessionsCompleted} sessions shared` }]
      : []),
    ...(MOCK_GROWTH.disciplesInvited > 0
      ? [{ icon: "person-add" as const, label: `${MOCK_GROWTH.disciplesInvited} disciple invited` }]
      : []),
  ];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 12, paddingBottom: insets.bottom + 120 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Back */}
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={20} color={colors.primaryGreen} />
        <Text style={styles.backLabel}>Home</Text>
      </TouchableOpacity>

      {/* Page intro */}
      <Text style={styles.introLabel}>P2P GLOBAL BIBLE STUDY NETWORK</Text>
      <Text style={styles.pageTitle}>The Living Tree</Text>
      <Text style={styles.pageDesc}>
        Your tree grows only from what you actually do — every lesson finished, prayer offered,
        session shared, and disciple invited. No shortcuts, just organic growth from a seed to a
        forest of nations.
      </Text>

      {/* Stage header card */}
      <View style={styles.stageCard}>
        {/* STAGE X OF 6 + dots */}
        <View style={styles.stageTopRow}>
          <Text style={styles.stageOf}>STAGE {stageIndex + 1} OF 6</Text>
          <View style={styles.dots}>
            {STAGES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === stageIndex
                    ? styles.dotActive
                    : i < stageIndex
                    ? styles.dotDone
                    : styles.dotLocked,
                ]}
              />
            ))}
          </View>
        </View>

        {/* Stage name */}
        <View style={styles.stageNameRow}>
          <Text style={styles.stageEmoji}>{stage.emoji}</Text>
          <Text style={styles.stageName}>{stage.name}</Text>
        </View>

        {/* Progress toward next */}
        {nextStage && (
          <View style={styles.progressSection}>
            <View style={styles.progressLabelRow}>
              <Text style={styles.progressToward}>
                Growing toward {nextStage.emoji} {nextStage.name}
              </Text>
              <Text style={styles.progressPct}>{progressPct}%</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
            </View>
            <Text style={styles.pointsHint}>
              {pointsNeeded} more points of shared study, prayer, and mentoring to grow again.
            </Text>
          </View>
        )}
      </View>

      {/* Photo card */}
      <View style={styles.photoCard}>
        <Image
          source={STAGE_IMAGES[stageIndex]}
          style={styles.photo}
          resizeMode="cover"
        />
        {/* Overlay: Watch growth button */}
        <TouchableOpacity style={styles.watchBtn} activeOpacity={0.85}>
          <Ionicons name="play" size={12} color="#fff" />
          <Text style={styles.watchBtnText}>Watch growth</Text>
        </TouchableOpacity>
        {/* Bottom label */}
        <View style={styles.photoBottomLabel}>
          <Text style={styles.photoLabelEmoji}>{stage.emoji}</Text>
          <Text style={styles.photoLabelText}>{stage.name}</Text>
        </View>
      </View>

      {/* Description + verse */}
      <View style={styles.descSection}>
        <Text style={styles.descText}>{stage.description}</Text>
        <View style={styles.verseBlock}>
          <Text style={styles.verseItalic}>
            {stage.verse} — {stage.verseRef}
          </Text>
        </View>
      </View>

      {/* What grew your tree */}
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
          <Text style={styles.tapHint}>
            Tap the roots, trunk, branches, canopy, or fruit to explore each one.
          </Text>
        </View>
      )}

      {/* View all stages */}
      <TouchableOpacity
        style={styles.allStagesBtn}
        onPress={() => router.push("/stages")}
        activeOpacity={0.8}
      >
        <Text style={styles.allStagesBtnText}>The Six Stages of Growth</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.primaryGreen} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  content: { paddingHorizontal: 20 },

  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  backLabel: {
    fontSize: 15,
    color: colors.primaryGreen,
    fontFamily: "Inter_500Medium",
  },

  introLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.amber,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    marginBottom: 6,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.primaryGreen,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 10,
  },
  pageDesc: {
    fontSize: 14,
    color: colors.textMid,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },

  stageCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderBeige,
    padding: 16,
    marginBottom: 16,
  },
  stageTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  stageOf: {
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.textMuted,
    fontFamily: "Inter_600SemiBold",
  },
  dots: { flexDirection: "row", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotDone: { backgroundColor: colors.accentGreen },
  dotActive: { backgroundColor: colors.amber, width: 10, height: 10, borderRadius: 5 },
  dotLocked: { backgroundColor: colors.borderBeige },
  stageNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  stageEmoji: { fontSize: 22 },
  stageName: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textDark,
    fontFamily: "Inter_700Bold",
  },

  progressSection: { gap: 6 },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressToward: {
    fontSize: 13,
    color: colors.textMid,
    fontFamily: "Inter_500Medium",
  },
  progressPct: {
    fontSize: 13,
    color: colors.textMuted,
    fontFamily: "Inter_500Medium",
  },
  progressBarBg: {
    height: 6,
    backgroundColor: colors.progressTrack,
    borderRadius: 3,
  },
  progressBarFill: {
    height: 6,
    backgroundColor: colors.progressFill,
    borderRadius: 3,
  },
  pointsHint: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },

  photoCard: {
    borderRadius: 16,
    overflow: "hidden",
    height: SW - 40,
    marginBottom: 20,
    position: "relative",
  },
  photo: { width: "100%", height: "100%" },
  watchBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  watchBtnText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  photoBottomLabel: {
    position: "absolute",
    bottom: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  photoLabelEmoji: { fontSize: 16 },
  photoLabelText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  descSection: { marginBottom: 20 },
  descText: {
    fontSize: 15,
    color: colors.textMid,
    fontFamily: "Inter_400Regular",
    lineHeight: 24,
    marginBottom: 12,
  },
  verseBlock: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accentGreen,
    paddingLeft: 12,
  },
  verseItalic: {
    fontSize: 14,
    color: colors.textDark,
    fontStyle: "italic",
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },

  grewSection: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderBeige,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  grewLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.amber,
    fontFamily: "Inter_600SemiBold",
  },
  grewChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(29,158,117,0.1)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(29,158,117,0.2)",
  },
  chipText: {
    fontSize: 12,
    color: colors.accentGreen,
    fontFamily: "Inter_500Medium",
  },
  tapHint: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },

  allStagesBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderBeige,
    padding: 16,
    marginBottom: 8,
  },
  allStagesBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.primaryGreen,
    fontFamily: "Inter_600SemiBold",
  },
});
