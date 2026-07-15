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
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { STAGES, STAGE_IMAGES, getStageFromPoints } from "@/constants/stages";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20 },

    greetingRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 16,
    },
    greeting: { fontSize: 20, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    greetingSub: { fontSize: 13, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
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
    progressToward: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium" },
    progressPct: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    progressBarBg: { height: 5, backgroundColor: c.progressTrack, borderRadius: 3 },
    progressBarFill: { height: 5, backgroundColor: c.progressFill, borderRadius: 3 },
    progressHint: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },

    verseCard: {
      backgroundColor: c.cardBeige,
      borderRadius: 16, borderWidth: 1, borderColor: c.warmBeige,
      padding: 16, marginBottom: 16,
    },
    verseHeader: { flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 10 },
    verseLabel: { fontSize: 12, color: c.amber, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    verseText: {
      fontSize: 14, color: c.textDark, lineHeight: 22,
      fontStyle: "italic", fontFamily: "Inter_400Regular", marginBottom: 8,
    },
    verseRef: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },

    evalCard: {
      backgroundColor: "rgba(224,164,65,0.1)",
      borderRadius: 14, borderWidth: 1, borderColor: "rgba(224,164,65,0.3)",
      padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12,
    },
    evalIconWrap: { position: "relative" },
    evalBadge: {
      position: "absolute", top: -6, right: -8,
      backgroundColor: "#C0392B", borderRadius: 9,
      minWidth: 18, height: 18, paddingHorizontal: 4,
      alignItems: "center", justifyContent: "center",
    },
    evalBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
    evalTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    evalSub: { fontSize: 12, color: c.textMid, marginTop: 2, fontFamily: "Inter_400Regular" },

    sectionTitle: {
      fontSize: 16, fontWeight: "700", color: c.textDark,
      fontFamily: "Inter_700Bold", marginBottom: 12,
    },
    moreList: { gap: 10 },
    moreTile: {
      backgroundColor: c.cardBeige, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, flexDirection: "row", alignItems: "center", gap: 12,
    },
    moreTileIcon: {
      width: 36, height: 36, borderRadius: 10,
      backgroundColor: "rgba(29,158,117,0.12)",
      alignItems: "center", justifyContent: "center",
    },
    moreTileLabel: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    moreTileSub: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
  });
}

export default function HomeTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { dailyVerse, isLoading, refreshData, pendingEvaluations } = useData();
  const { colors } = useTheme();

  const styles = makeStyles(colors);
  const { isTablet } = useLayout();
  const { t } = useTranslation();

  const firstName = profile?.displayName?.split(" ")[0] ?? "";
  const hour = new Date().getHours();
  const timeGreeting =
    hour < 12 ? t("home.goodMorning") : hour < 17 ? t("home.goodAfternoon") : t("home.goodEvening");
  const greeting = firstName ? `${timeGreeting}, ${firstName}` : timeGreeting;

  const growthPoints = profile?.growthLevel ?? 0;
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

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 }, isTablet && { maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' as any, width: '100%' }]}
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
          <Text style={styles.greetingSub}>{t("home.continueGrowth")}</Text>
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
        style={[styles.treeCard, isTablet && { height: 260 }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push("/living-tree");
        }}
        activeOpacity={0.9}
      >
        <Image
          source={STAGE_IMAGES[stageIndex]}
          style={styles.treePhoto}
          resizeMode="cover"
        />
        <View style={styles.stageOverlay}>
          <Text style={styles.stageOverlayText}>
            {stage.emoji} {stage.name}
          </Text>
          <Text style={styles.stageOfText}>{t("home.stageOf", { stage: stageIndex + 1 })}</Text>
        </View>
        <View style={styles.arrowOverlay}>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </View>
      </TouchableOpacity>

      {/* Progress bar under photo */}
      <View style={styles.progressWrap}>
        <View style={styles.progressLabelRow}>
          {nextStage ? (
            <Text style={styles.progressToward}>
              {t("home.growingToward")} {nextStage.emoji} {nextStage.name}
            </Text>
          ) : (
            <Text style={styles.progressToward}>{t("home.forestReached")}</Text>
          )}
          <Text style={styles.progressPct}>{progressPct}%</Text>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progressPct}%` as any }]} />
        </View>
        {nextStage && (
          <Text style={styles.progressHint}>
            {t("home.morePoints", { points: nextStage.unlockPoints - growthPoints, name: nextStage.name })}
          </Text>
        )}
      </View>

      {/* Daily Verse */}
      {dailyVerse && (
        <View style={styles.verseCard}>
          <View style={styles.verseHeader}>
            <Ionicons name="bookmark" size={14} color={colors.amber} />
            <Text style={styles.verseLabel}>{t("home.dailyWord")}</Text>
          </View>
          <Text style={styles.verseText}>"{dailyVerse.text}"</Text>
          <Text style={styles.verseRef}>— {dailyVerse.ref}</Text>
        </View>
      )}

      {/* Evaluations waiting */}
      {pendingEvaluations.length > 0 && (
        <TouchableOpacity
          style={styles.evalCard}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/evaluations");
          }}
          activeOpacity={0.85}
        >
          <View style={styles.evalIconWrap}>
            <Ionicons name="people-circle" size={22} color={colors.upperRoomAmber} />
            <View style={styles.evalBadge}>
              <Text style={styles.evalBadgeText}>{pendingEvaluations.length}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.evalTitle}>{t("home.evaluationsWaiting")}</Text>
            <Text style={styles.evalSub}>
              {t("home.disciplesNeedReview", { count: pendingEvaluations.length })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.amber} />
        </TouchableOpacity>
      )}

      {/* More */}
      <Text style={styles.sectionTitle}>{t("home.more")}</Text>
      <View style={styles.moreList}>
        {[
          { icon: "leaf", label: t("home.livingTree"), sub: t("home.livingTreeSub"), route: "/living-tree" },
          { icon: "book", label: t("home.curriculum"), sub: t("home.curriculumSub"), route: "/curriculum" },
          { icon: "flower", label: t("home.fruitCollection"), sub: t("home.fruitCollectionSub"), route: "/fruit" },
          { icon: "stats-chart", label: t("home.myProgress"), sub: t("home.myProgressSub"), route: "/progress" },
          { icon: "person-circle", label: t("home.myProfile"), sub: t("home.myProfileSub"), route: "/profile" },
          ...(profile?.role && profile.role !== "student"
            ? [{ icon: "settings", label: t("home.admin"), sub: t("home.adminSub"), route: "/admin/curriculum" }]
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
