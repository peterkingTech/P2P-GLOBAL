import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import { STAGES, STAGE_IMAGES, getStageFromPoints } from "@/constants/stages";

const MOCK_GROWTH_POINTS = 4;

export default function HomeTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { dailyVerse, sessions, isLoading, refreshData } = useData();

  const firstName = profile?.displayName?.split(" ")[0] ?? "";
  const hour = new Date().getHours();
  const timeGreeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const greeting = firstName ? `${timeGreeting}, ${firstName}` : timeGreeting;

  const growthPoints = MOCK_GROWTH_POINTS;
  const stageIndex = getStageFromPoints(growthPoints);
  const stage = STAGES[stageIndex];
  const nextStage = STAGES[stageIndex + 1] ?? null;
  const progressPct = nextStage
    ? Math.round(
        ((growthPoints - stage.unlockPoints) /
          (nextStage.unlockPoints - stage.unlockPoints)) *
          100
      )
    : 100;

  const liveSession = sessions.find((s) => s.isLive);
  const nextSession = sessions.find((s) => !s.isLive);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={refreshData}
          tintColor={colors.accentGreen}
        />
      }
    >
      {/* Greeting */}
      <View style={styles.greetingRow}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.greetingSub}>Continue your growth</Text>
        </View>
        <TouchableOpacity
          style={styles.prayingBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/prayer");
          }}
        >
          <Ionicons name="radio" size={18} color={colors.upperRoomAmber} />
        </TouchableOpacity>
      </View>

      {/* Living Tree photo card */}
      <TouchableOpacity
        style={styles.treeCard}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push("/living-tree");
        }}
        activeOpacity={0.9}
      >
        {/* Photo */}
        <Image
          source={STAGE_IMAGES[stageIndex]}
          style={styles.treePhoto}
          resizeMode="cover"
        />

        {/* Stage badge overlay (top-left) */}
        <View style={styles.stageOverlay}>
          <Text style={styles.stageOverlayText}>
            {stage.emoji} {stage.name}
          </Text>
          <Text style={styles.stageOfText}>Stage {stageIndex + 1} of 6</Text>
        </View>

        {/* Arrow overlay (top-right) */}
        <View style={styles.arrowOverlay}>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </View>
      </TouchableOpacity>

      {/* Progress bar under photo */}
      <View style={styles.progressWrap}>
        <View style={styles.progressLabelRow}>
          {nextStage ? (
            <Text style={styles.progressToward}>
              Growing toward {nextStage.emoji} {nextStage.name}
            </Text>
          ) : (
            <Text style={styles.progressToward}>Forest of Nations reached</Text>
          )}
          <Text style={styles.progressPct}>{progressPct}%</Text>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
        </View>
        {nextStage && (
          <Text style={styles.progressHint}>
            {nextStage.unlockPoints - growthPoints} more points to {nextStage.name}
          </Text>
        )}
      </View>

      {/* Daily Verse */}
      {dailyVerse && (
        <View style={styles.verseCard}>
          <View style={styles.verseHeader}>
            <Ionicons name="bookmark" size={14} color={colors.amber} />
            <Text style={styles.verseLabel}>Daily Word</Text>
          </View>
          <Text style={styles.verseText}>"{dailyVerse.text}"</Text>
          <Text style={styles.verseRef}>— {dailyVerse.ref}</Text>
        </View>
      )}

      {/* Live Session Banner */}
      {liveSession && (
        <TouchableOpacity
          style={styles.liveCard}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push(`/session/${liveSession.id}`);
          }}
          activeOpacity={0.85}
        >
          <View style={styles.liveDot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.liveTitle}>{liveSession.title}</Text>
            <Text style={styles.liveHost}>
              {liveSession.participantCount} members · {liveSession.hostName}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.accentGreen} />
        </TouchableOpacity>
      )}

      {/* Next Session */}
      {nextSession && (
        <TouchableOpacity
          style={styles.sessionCard}
          onPress={() => router.push(`/session/${nextSession.id}`)}
          activeOpacity={0.85}
        >
          <View style={styles.sessionIcon}>
            <Ionicons name="calendar" size={22} color={colors.accentGreen} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sessionTitle}>{nextSession.title}</Text>
            <Text style={styles.sessionMeta}>Scheduled · {nextSession.durationMinutes} min</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* Quick access */}
      <Text style={styles.sectionTitle}>More</Text>
      <View style={styles.moreList}>
        {[
          { icon: "leaf", label: "Living Tree", sub: "Track your six stages of growth", route: "/living-tree" },
          { icon: "book", label: "Curriculum", sub: "Browse the full study library", route: "/curriculum" },
          { icon: "flower", label: "Fruit Collection", sub: "See the fruit you've earned", route: "/fruit" },
          { icon: "trophy", label: "Hall of Faith", sub: "Celebrate faithful disciples", route: "/hall-of-faith" },
          { icon: "person-circle", label: "My Profile", sub: "View your discipleship profile", route: "/profile" },
          ...(profile?.role && profile.role !== "student"
            ? [{ icon: "settings", label: "Admin", sub: "Curriculum manager & registration responses", route: "/admin/curriculum" }]
            : []),
        ].map((item) => (
          <TouchableOpacity
            key={item.label}
            style={styles.moreTile}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.8}
          >
            <View style={styles.moreTileIcon}>
              <Ionicons name={item.icon as any} size={18} color={colors.accentGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.moreTileLabel}>{item.label}</Text>
              <Text style={styles.moreTileSub}>{item.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { paddingHorizontal: 20 },

  greetingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  greeting: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  greetingSub: { fontSize: 13, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  prayingBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(224,164,65,0.12)",
    borderWidth: 1, borderColor: "rgba(224,164,65,0.25)",
    alignItems: "center", justifyContent: "center",
  },

  treeCard: {
    borderRadius: 18,
    overflow: "hidden",
    height: 220,
    marginBottom: 12,
    position: "relative",
  },
  treePhoto: { width: "100%", height: "100%" },
  stageOverlay: {
    position: "absolute",
    bottom: 14,
    left: 14,
    backgroundColor: "rgba(0,0,0,0.48)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stageOverlayText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  stageOfText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  arrowOverlay: {
    position: "absolute",
    top: 14,
    right: 14,
    backgroundColor: "rgba(0,0,0,0.35)",
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  progressWrap: { marginBottom: 20, gap: 5 },
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
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
  },
  progressBarBg: { height: 5, backgroundColor: colors.progressTrack, borderRadius: 3 },
  progressBarFill: { height: 5, backgroundColor: colors.progressFill, borderRadius: 3 },
  progressHint: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: "Inter_400Regular",
  },

  verseCard: {
    backgroundColor: colors.cardBeige,
    borderRadius: 16, borderWidth: 1, borderColor: colors.warmBeige,
    padding: 16, marginBottom: 16,
  },
  verseHeader: { flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 10 },
  verseLabel: { fontSize: 12, color: colors.amber, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  verseText: {
    fontSize: 14, color: colors.textDark, lineHeight: 22,
    fontStyle: "italic", fontFamily: "Inter_400Regular", marginBottom: 8,
  },
  verseRef: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },

  liveCard: {
    backgroundColor: colors.primaryGreen,
    borderRadius: 14, padding: 14,
    flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FF4444" },
  liveTitle: { fontSize: 14, fontWeight: "600", color: colors.cream, fontFamily: "Inter_600SemiBold" },
  liveHost: { fontSize: 12, color: colors.lightGreen, opacity: 0.8, fontFamily: "Inter_400Regular" },

  sessionCard: {
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20,
  },
  sessionIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "rgba(29,158,117,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  sessionTitle: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  sessionMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

  sectionTitle: {
    fontSize: 16, fontWeight: "700", color: colors.textDark,
    fontFamily: "Inter_700Bold", marginBottom: 12,
  },
  moreList: { gap: 10 },
  moreTile: {
    backgroundColor: colors.cardBeige, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, flexDirection: "row", alignItems: "center", gap: 12,
  },
  moreTileIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(29,158,117,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  moreTileLabel: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  moreTileSub: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
});
