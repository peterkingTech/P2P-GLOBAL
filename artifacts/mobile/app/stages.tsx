import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { STAGES, STAGE_IMAGES, getStageFromPoints } from "@/constants/stages";

const MOCK_GROWTH_POINTS = 4;

export default function StagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const currentStage = getStageFromPoints(MOCK_GROWTH_POINTS);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 12, paddingBottom: insets.bottom + 120 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Stack.Screen options={{ headerShown: false }} />
      {/* Back */}
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={20} color={colors.primaryGreen} />
        <Text style={styles.backLabel}>Living Tree</Text>
      </TouchableOpacity>

      {/* Heading */}
      <Text style={styles.sectionLabel}>THE SIX STAGES OF GROWTH</Text>
      <Text style={styles.pageTitle}>From a Dormant Seed to a Forest of Nations</Text>
      <Text style={styles.pageDesc}>
        Every disciple walks the same path. Your activity in the network moves you from one stage to
        the next — and each stage shelters more life than the last.
      </Text>

      {/* Stage cards */}
      <View style={styles.list}>
        {STAGES.map((stage, i) => {
          const isReached = i < currentStage;
          const isCurrent = i === currentStage;
          const isLocked = i > currentStage;

          return (
            <View
              key={i}
              style={[
                styles.stageRow,
                isCurrent && styles.stageRowCurrent,
                isLocked && styles.stageRowLocked,
              ]}
            >
              {/* Thumbnail */}
              <Image
                source={STAGE_IMAGES[i]}
                style={[styles.thumb, isLocked && styles.thumbLocked]}
                resizeMode="cover"
              />

              {/* Info */}
              <View style={styles.stageInfo}>
                <View style={styles.stageNameRow}>
                  <Text style={styles.stageEmoji}>{stage.emoji}</Text>
                  <Text style={[styles.stageName, isLocked && styles.stageNameLocked]}>
                    {stage.name}
                  </Text>
                  {isReached && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Reached</Text>
                    </View>
                  )}
                  {isCurrent && (
                    <View style={[styles.badge, styles.badgeCurrent]}>
                      <Text style={[styles.badgeText, styles.badgeCurrentText]}>You are here</Text>
                    </View>
                  )}
                  {isLocked && (
                    <View style={[styles.badge, styles.badgeLocked]}>
                      <Text style={[styles.badgeText, styles.badgeLockedText]}>Locked</Text>
                    </View>
                  )}
                </View>

                <Text style={[styles.desc, isLocked && styles.descLocked]} numberOfLines={3}>
                  {stage.description}
                </Text>

                <Text style={styles.verse}>
                  {stage.verse} — {stage.verseRef}
                </Text>

                {isCurrent && (
                  <View style={styles.currentProgressWrap}>
                    <View style={styles.progressBarBg}>
                      <View
                        style={[
                          styles.progressBarFill,
                          {
                            width: `${Math.round(
                              ((MOCK_GROWTH_POINTS - stage.unlockPoints) /
                                ((STAGES[i + 1]?.unlockPoints ?? stage.unlockPoints) -
                                  stage.unlockPoints)) *
                                100
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                    {STAGES[i + 1] && (
                      <Text style={styles.pointsNeeded}>
                        {STAGES[i + 1].unlockPoints - MOCK_GROWTH_POINTS} more growth points to
                        reach {STAGES[i + 1].emoji} {STAGES[i + 1].name}
                      </Text>
                    )}
                  </View>
                )}

                {isLocked && (
                  <Text style={styles.unlockNote}>
                    Unlocks at {stage.unlockPoints} growth points
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
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
    marginBottom: 20,
    alignSelf: "flex-start",
  },
  backLabel: {
    fontSize: 15,
    color: colors.primaryGreen,
    fontFamily: "Inter_500Medium",
  },

  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.amber,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    marginBottom: 8,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.primaryGreen,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 32,
    marginBottom: 10,
  },
  pageDesc: {
    fontSize: 14,
    color: colors.textMid,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },

  list: { gap: 12 },

  stageRow: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderBeige,
    flexDirection: "row",
    gap: 12,
    padding: 12,
    alignItems: "flex-start",
  },
  stageRowCurrent: {
    borderColor: colors.accentGreen,
    backgroundColor: "rgba(29,158,117,0.05)",
  },
  stageRowLocked: {
    opacity: 0.65,
  },

  thumb: {
    width: 72,
    height: 72,
    borderRadius: 12,
  },
  thumbLocked: {
    opacity: 0.6,
  },

  stageInfo: { flex: 1, gap: 6 },
  stageNameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  stageEmoji: { fontSize: 16 },
  stageName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textDark,
    fontFamily: "Inter_700Bold",
  },
  stageNameLocked: { color: colors.textMid },

  badge: {
    backgroundColor: colors.borderBeige,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    color: colors.textMid,
    fontFamily: "Inter_500Medium",
  },
  badgeCurrent: { backgroundColor: colors.accentGreen },
  badgeCurrentText: { color: "#fff" },
  badgeLocked: { backgroundColor: colors.borderBeige },
  badgeLockedText: { color: colors.textMuted },

  desc: {
    fontSize: 13,
    color: colors.textMid,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  descLocked: { color: colors.textMuted },

  verse: {
    fontSize: 12,
    color: colors.accentGreen,
    fontStyle: "italic",
    fontFamily: "Inter_400Regular",
  },

  currentProgressWrap: { gap: 4 },
  progressBarBg: { height: 4, backgroundColor: colors.progressTrack, borderRadius: 2 },
  progressBarFill: { height: 4, backgroundColor: colors.progressFill, borderRadius: 2 },
  pointsNeeded: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
  },
  unlockNote: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
  },
});
