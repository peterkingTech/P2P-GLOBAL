import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { STAGES, STAGE_IMAGES, PERSONAL_STAGE_COUNT, COLLECTIVE_STAGE_INDEX, getStageFromPoints } from "@/constants/stages";
import ReadableText from "@/components/ReadableText";
import { AppButton } from "@/components/ui";
import { getGrowthJourney, progressText, timeInStage, type GrowthJourney } from "@/lib/growthApi";

// YOUR GROWTH JOURNEY. One personal stage, calculated on the server from real,
// dated activity across four dimensions (consistency over time, learning,
// spiritual fruit, discipleship — migrations 235–237). This screen explains
// where you are and what the next stage asks for, as a checklist (never "8 more
// points" or a percentage). Forest Builder is the highest personal stage;
// Forest of Nations is what P2P Global's disciples become TOGETHER.

export default function StagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const [journey, setJourney] = useState<GrowthJourney | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let live = true;
    getGrowthJourney().then((j) => { if (live) { setJourney(j); setError(null); } }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []));

  // Until the journey loads (or offline): the stage from the profile, never Forest of Nations.
  const stageIndex = journey ? journey.stage.stage - 1 : getStageFromPoints(profile?.growthLevel ?? 0);
  const collective = STAGES[COLLECTIVE_STAGE_INDEX];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: insets.bottom + 120 }]}
      showsVerticalScrollIndicator={false}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to the Living Tree" style={styles.back} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={20} color={colors.primaryGreen} />
        <Text style={styles.backLabel}>Living Tree</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>YOUR GROWTH JOURNEY</Text>
      <Text style={styles.pageTitle} accessibilityRole="header">From a Dormant Seed to a Forest Builder</Text>
      <Text style={styles.pageDesc}>
        Your stage grows from what you actually do over time — learning, time in Scripture and prayer, serving others and
        helping others take root. Together, P2P Global&apos;s disciples become a Forest of Nations.
      </Text>

      {/* Where you are */}
      <View style={[styles.stageRow, styles.stageRowCurrent]}>
        <Image source={STAGE_IMAGES[stageIndex]} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
        <View style={styles.stageInfo}>
          <View style={styles.stageNameRow}>
            <Text style={styles.stageEmoji}>{STAGES[stageIndex].emoji}</Text>
            <Text style={styles.stageName}>{STAGES[stageIndex].name}</Text>
            <View style={[styles.badge, styles.badgeCurrent]}><Text style={[styles.badgeText, styles.badgeCurrentText]}>You are here</Text></View>
          </View>
          <Text style={styles.desc}>{STAGES[stageIndex].description}</Text>
          <ReadableText style={styles.verse}>{STAGES[stageIndex].verse} — {STAGES[stageIndex].verseRef}</ReadableText>
          {journey ? <Text style={styles.meta}>In this stage for {timeInStage(journey.stage.since)}</Text> : null}
          {journey?.stage.verification === "legacy_unverified" ? (
            <Text style={styles.meta}>Recognised from your growth before this journey began. It stays yours; the milestones confirm it as you continue.</Text>
          ) : null}
        </View>
      </View>

      {!journey && !error ? <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 18 }} accessibilityLabel="Loading your growth journey" /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* What the next stage asks for */}
      {journey?.next ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextTitle} accessibilityRole="header">Growing toward {journey.next.emoji} {journey.next.name}</Text>
          {journey.milestones === "draft" ? (
            <Text style={styles.meta}>These milestones are being finalised by P2P Global. Everything you do is already counted.</Text>
          ) : null}
          {journey.next.dimensions.map((d) => (
            <View key={d.dimension} style={styles.dimension}>
              <View style={styles.dimensionHead}>
                <Ionicons name={!d.required ? "remove-circle-outline" : d.met ? "checkmark-circle" : "ellipse-outline"} size={18} color={d.required && d.met ? colors.accentGreen : colors.textMuted} />
                <Text style={styles.dimensionName}>{d.label}</Text>
              </View>
              {!d.required ? (
                <Text style={styles.itemText}>Not needed yet for this stage</Text>
              ) : d.items.map((i) => (
                <View key={i.label} style={styles.item} accessible accessibilityLabel={`${i.label}: ${i.met ? "done" : progressText(i)}`}>
                  <Ionicons name={i.met ? "checkmark" : "time-outline"} size={15} color={i.met ? colors.accentGreen : colors.amber} />
                  <Text style={[styles.itemText, { flex: 1 }]}>{i.label}</Text>
                  <Text style={[styles.itemCount, i.met && { color: colors.accentGreen }]}>{progressText(i)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : journey ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextTitle}>You are a Forest Builder</Text>
          <Text style={styles.desc}>The highest personal stage: you are helping others take root. Keep walking with the disciples in your shade.</Text>
        </View>
      ) : null}

      {/* The whole journey */}
      <Text style={styles.listHeader} accessibilityRole="header">The five stages of personal growth</Text>
      <View style={styles.list}>
        {STAGES.slice(0, PERSONAL_STAGE_COUNT).map((stage, i) => {
          const reached = i < stageIndex, current = i === stageIndex, ahead = i > stageIndex;
          const when = journey?.history.find((h) => h.stage === i + 1);
          return (
            <View key={stage.name} style={[styles.stageRow, current && styles.stageRowCurrent, ahead && styles.stageRowLocked]}>
              <Image source={STAGE_IMAGES[i]} style={[styles.thumbSmall, ahead && styles.thumbLocked]} resizeMode="cover" accessibilityIgnoresInvertColors />
              <View style={styles.stageInfo}>
                <View style={styles.stageNameRow}>
                  <Text style={styles.stageEmoji}>{stage.emoji}</Text>
                  <Text style={[styles.stageName, ahead && styles.stageNameLocked]}>{stage.name}</Text>
                  {reached ? <View style={styles.badge}><Text style={styles.badgeText}>Reached</Text></View> : null}
                  {current ? <View style={[styles.badge, styles.badgeCurrent]}><Text style={[styles.badgeText, styles.badgeCurrentText]}>You are here</Text></View> : null}
                </View>
                <Text style={[styles.desc, ahead && styles.descLocked]} numberOfLines={3}>{stage.description}</Text>
                <ReadableText style={styles.verse}>{stage.verse} — {stage.verseRef}</ReadableText>
                {when ? <Text style={styles.meta}>Reached {new Date(when.achievedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}{when.kind === "legacy_import" ? " (recognised from your earlier growth)" : ""}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>

      {/* Together: Forest of Nations */}
      <View style={styles.collectiveCard}>
        <Image source={STAGE_IMAGES[COLLECTIVE_STAGE_INDEX]} style={styles.collectiveImage} resizeMode="cover" accessibilityIgnoresInvertColors />
        <Text style={styles.collectiveLabel}>TOGETHER</Text>
        <Text style={styles.collectiveTitle} accessibilityRole="header">{collective.emoji} {collective.name}</Text>
        <Text style={styles.desc}>{collective.description}</Text>
        <ReadableText style={styles.verse}>{collective.verse} — {collective.verseRef}</ReadableText>
        <Text style={styles.meta}>Not a personal stage: it is what P2P Global&apos;s disciples become together, generation after generation.</Text>
        <AppButton label="My discipleship lineage" onPress={() => router.push("/lineage" as any)} variant="secondary" icon="git-network-outline" style={{ marginTop: 10 }} palette="fixedLight" />
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
    marginBottom: 20,
  },

  list: { gap: 12 },
  listHeader: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.textDark, marginTop: 24, marginBottom: 10 },

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

  thumb: { width: 88, height: 88, borderRadius: 14 },
  thumbSmall: { width: 64, height: 64, borderRadius: 12 },
  thumbLocked: { opacity: 0.6 },

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
  meta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
  errorText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", marginTop: 14 },

  nextCard: { marginTop: 16, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, gap: 10 },
  nextTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
  dimension: { gap: 6, paddingTop: 4 },
  dimensionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dimensionName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  item: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 26 },
  itemText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 19, paddingLeft: 0 },
  itemCount: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_600SemiBold" },

  collectiveCard: { marginTop: 24, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, gap: 6 },
  collectiveImage: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginBottom: 6 },
  collectiveLabel: { fontSize: 10, letterSpacing: 1.5, color: colors.amber, fontFamily: "Inter_600SemiBold" },
  collectiveTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
});
