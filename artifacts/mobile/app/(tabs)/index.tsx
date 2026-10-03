import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth, supabase } from "@/contexts/AuthContext";
import {
  useData,
  KingdomSchoolStatus,
  KINGDOM_SCHOOL_STATUS_LABELS,
  getModuleProgressCounts,
  getKingdomSchoolStatus,
  Church,
  GroveData,
  ChurchAnnouncement,
} from "@/contexts/DataContext";
import { getApiUrl } from "@/lib/apiUrl";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { STAGES, STAGE_IMAGES, getStageFromPoints } from "@/constants/stages";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";
import LivingTree from "@/components/LivingTree";
import { Avatar } from "@/components/Avatar";
import { InviteEncouragementCard } from "@/components/InviteEncouragementCard";
import { GetStartedCard } from "@/components/GetStartedCard";

// Time-of-day palette for the greeting header. No stock imagery exists in
// the project, so the "sunrise / daylight / night" feeling comes from
// gradients, always dark enough for white text to stay readable.
type DayPart = "morning" | "afternoon" | "evening";
const HERO_GRADIENTS: Record<DayPart, [string, string, string]> = {
  morning: ["#5A3E16", "#1E3A2A", "#0A1712"],
  afternoon: ["#2F4A24", "#163327", "#0A1712"],
  evening: ["#1B2747", "#101B30", "#08101A"],
};
const HERO_ICON: Record<DayPart, keyof typeof Ionicons.glyphMap> = {
  morning: "sunny-outline",
  afternoon: "partly-sunny-outline",
  evening: "moon-outline",
};

// Greeting and Daily Word as ONE spiritual welcome. The verse comes from the
// existing dailyVerse in DataContext; there is no verse detail screen, so no
// arrow or pagination is shown.
function HomeHero({ dayPart, greetingLine, firstName, verse, photoUrl, onPressAvatar, styles }: {
  dayPart: DayPart; greetingLine: string; firstName: string;
  verse: { text: string; ref: string } | null; photoUrl: string | null;
  onPressAvatar: () => void; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <LinearGradient colors={HERO_GRADIENTS[dayPart]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.hero}>
      <View style={styles.heroTopRow}>
        <TouchableOpacity onPress={onPressAvatar} accessibilityRole="button" accessibilityLabel="Open your profile" hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Avatar photoUrl={photoUrl} name={firstName || "You"} size={40} />
        </TouchableOpacity>
        <Ionicons name={HERO_ICON[dayPart]} size={26} color="rgba(242,201,120,0.9)" />
      </View>
      <Text style={styles.heroGreeting} accessibilityRole="header">
        {greetingLine}{firstName ? "," : ""}
      </Text>
      {!!firstName && <Text style={styles.heroName}>{firstName} 👋</Text>}
      {verse && (
        <View style={styles.heroVerseWrap}>
          <Text style={styles.heroVerseText}>"{verse.text}"</Text>
          <Text style={styles.heroVerseRef}>— {verse.ref}</Text>
        </View>
      )}
    </LinearGradient>
  );
}

// Same "current module" rule as the Kingdom School tab (learn.tsx): the first
// unlocked module that still has lessons left. Only real data is shown — no
// time-remaining figure, because modules don't carry one.
function ContinueJourneyCard({ module, status, onOpenModule, onExplore, styles, colors, t }: {
  module: { id: string; title: string; lessonCount: number; completedLessons: number; imageUrl?: string } | null;
  status: KingdomSchoolStatus; onOpenModule: (id: string) => void; onExplore: () => void;
  styles: ReturnType<typeof makeStyles>; colors: AppColors; t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const complete = status === "foundation_complete" || status === "guiding_others";

  if (module && module.lessonCount > 0) {
    const current = Math.min(module.completedLessons + 1, module.lessonCount);
    const pct = Math.round((module.completedLessons / module.lessonCount) * 100);
    return (
      <TouchableOpacity
        style={styles.ksContinueCard}
        activeOpacity={0.9}
        onPress={() => onOpenModule(module.id)}
        accessibilityRole="button"
        accessibilityLabel={`${module.title}, ${t("home.lessonOf", { current, total: module.lessonCount })}`}
      >
        {module.imageUrl ? (
          <Image source={{ uri: module.imageUrl }} style={styles.ksThumb} resizeMode="cover" />
        ) : (
          <LinearGradient colors={["#1D9E75", "#0F6E56"]} style={[styles.ksThumb, styles.ksThumbFallback]}>
            <Ionicons name="book" size={26} color="#fff" />
          </LinearGradient>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.ksModuleTitle} numberOfLines={2}>{module.title}</Text>
          <Text style={styles.ksModuleMeta}>{t("home.lessonOf", { current, total: module.lessonCount })}</Text>
          <View style={styles.ksBarBg}>
            <View style={[styles.ksBarFill, { width: `${pct}%` as any }]} />
          </View>
        </View>
        <View style={styles.ksPlay}>
          <Ionicons name="play" size={20} color="#fff" style={{ marginLeft: 2 }} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.ksContinueCard} activeOpacity={0.9} onPress={onExplore} accessibilityRole="button">
      <LinearGradient
        colors={complete ? ["#E0A441", "#B07A24"] : ["#1D9E75", "#0F6E56"]}
        style={[styles.ksThumb, styles.ksThumbFallback]}
      >
        <Ionicons name={complete ? "leaf" : "compass"} size={26} color="#fff" />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={styles.ksModuleTitle}>
          {complete ? KINGDOM_SCHOOL_STATUS_LABELS[status] : t("home.beginJourney")}
        </Text>
        <Text style={styles.ksModuleMeta}>{complete ? t("home.foundationCompleteSub") : t("home.beginJourneySub")}</Text>
        <Text style={[styles.ksExploreText, { color: colors.accentGreen }]}>{t("home.exploreKingdomSchool")} →</Text>
      </View>
    </TouchableOpacity>
  );
}

// The five journey features, as tiles rather than the old vertical list.
// Subtitles are descriptive text — no counts are fetched just to decorate.
function JourneyTile({ icon, tint, title, sub, onPress, styles, wide }: {
  icon: keyof typeof Ionicons.glyphMap; tint: string; title: string; sub: string;
  onPress: () => void; styles: ReturnType<typeof makeStyles>; wide?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.journeyTile, wide && styles.journeyTileWide]}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
    >
      <View style={[styles.journeyIcon, { backgroundColor: `${tint}26` }]}>
        <Ionicons name={icon} size={22} color={tint} />
      </View>
      <View style={wide ? { flex: 1 } : undefined}>
        <Text style={styles.journeyTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.journeySub} numberOfLines={2}>{sub}</Text>
      </View>
      {wide && <Ionicons name="chevron-forward" size={18} color={tint} />}
    </TouchableOpacity>
  );
}

interface FirstRecommendation {
  id: string;
  title: string;
  coverImageUrl: string | null;
  colorTheme: string;
}

// "Recommended for You" — the existing goals-based recommendation
// (GET /plans/recommended), with its existing dismissal flag: once the user
// starts it or closes it, it is not shown again. Tapping the card starts it.
function RecommendedCard({ rec, onStart, onDismiss, colors, t }: {
  rec: FirstRecommendation; onStart: () => void; onDismiss: () => void; colors: AppColors;
  t: (k: string) => string;
}) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.recCard} activeOpacity={0.9} onPress={onStart} accessibilityRole="button" accessibilityLabel={`${rec.title}. ${t("home.recommendedBasedOnGoals")}`}>
      {rec.coverImageUrl ? (
        <Image source={{ uri: rec.coverImageUrl }} style={styles.recImage} resizeMode="cover" />
      ) : (
        <View style={[styles.recImage, { backgroundColor: `${rec.colorTheme}26`, alignItems: "center", justifyContent: "center" }]}>
          <Ionicons name="book-outline" size={28} color={rec.colorTheme} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.recTitle} numberOfLines={2}>{rec.title}</Text>
        <Text style={styles.recEyebrow}>{t("home.recommendedBasedOnGoals")}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      <TouchableOpacity
        style={styles.recDismissBtn}
        onPress={onDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss recommendation"
      >
        <Ionicons name="close" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// Surfaces an unresponded Elijah Protocol pastoral-care message (see
// GET /pastoral-care/pending/:userId). This app has no push-notification
// tap-routing infrastructure, so this Home-screen card — not a notification
// tap — is the real way a returning user reaches elijah-response.tsx.
function ElijahCheckInCard({ onPress, colors }: { onPress: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.elijahCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.elijahIconWrap}>
        <Ionicons name="leaf-outline" size={20} color={colors.amber} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.elijahTitle}>We noticed you have been quiet</Text>
        <Text style={styles.elijahSub}>Tap to see a gentle word — no pressure.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.amber} />
    </TouchableOpacity>
  );
}

// One-time card set by completion.tsx's Phase4Commission the moment a user
// becomes peer-guide eligible (see guideInvitationPending:<userId> in
// AsyncStorage) — shown once, then cleared, never re-shown after that.
function PeerGuideAlertCard({ count, onPress, colors }: { count: number; onPress: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.elijahCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.elijahIconWrap}>
        <Text style={{ fontSize: 16 }}>📞</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.elijahTitle}>{count} disciple{count === 1 ? "" : "s"} could use a check-in</Text>
        <Text style={styles.elijahSub}>Tap to see who, and call them.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.amber} />
    </TouchableOpacity>
  );
}

function UnreadMessagesCard({ count, preview, onPress, colors }: { count: number; preview: string | null; onPress: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.elijahCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.elijahIconWrap}>
        <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accentGreen} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.elijahTitle}>{count} unread {count === 1 ? "message" : "messages"}</Text>
        {preview && <Text style={styles.elijahSub} numberOfLines={1}>{preview}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.accentGreen} />
    </TouchableOpacity>
  );
}

function GuideInvitationCard({ onFind, onDismiss, colors }: { onFind: () => void; onDismiss: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.guideInviteCard}>
      <TouchableOpacity style={styles.recDismissBtn} onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
      <Text style={styles.guideInviteTitle}>Someone is waiting for a guide like you.</Text>
      <Text style={styles.guideInviteSub}>Ready to meet them?</Text>
      <TouchableOpacity style={styles.guideInviteBtn} onPress={onFind} activeOpacity={0.85}>
        <Text style={styles.guideInviteBtnText}>Find Someone to Guide</Text>
      </TouchableOpacity>
    </View>
  );
}

// Leader with a joined church — full grove summary.
function GroveHomeCard({ church, grove, memberCount, onPress, colors }: {
  church: Church; grove: GroveData | null; memberCount: number; onPress: () => void; colors: AppColors;
}) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.churchCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.churchCardTopRow}>
        <Text style={{ fontSize: 20 }}>⛪</Text>
        <Text style={styles.churchCardName} numberOfLines={1}>{church.name}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
      <Text style={styles.churchCardLocation}>
        {[church.city, church.country].filter(Boolean).join(" · ")}{memberCount ? ` · ${memberCount} members` : ""}
      </Text>
      {grove && (
        <View style={styles.groveStatsRow}>
          <Text style={styles.groveStatText}>🟢 {grove.activeLearners} active</Text>
          <Text style={styles.groveStatText}>📖 {grove.lessonsThisWeek} this week</Text>
        </View>
      )}
      {grove && grove.inactiveMembers > 0 && (
        <Text style={styles.groveAttentionText}>⚠️ {grove.inactiveMembers} need attention</Text>
      )}
      <Text style={styles.churchCardCta}>Dashboard →</Text>
    </TouchableOpacity>
  );
}

// Ministry leader without a church yet — compact registration prompt.
function RegisterChurchPromptCard({ onPress, colors }: { onPress: () => void; colors: AppColors }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.churchCard} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.churchCardTopRow}>
        <Text style={{ fontSize: 20 }}>⛪</Text>
        <Text style={styles.churchCardName}>Register your church</Text>
      </View>
      <Text style={styles.churchCardLocation}>
        Bring your congregation onto P2P Global — completely free.
      </Text>
      <Text style={styles.churchCardCta}>Register →</Text>
    </TouchableOpacity>
  );
}

// Regular member who has joined a church — light, less prominent card.
function MemberChurchCard({ church, announcement, onPress, colors }: {
  church: Church; announcement: ChurchAnnouncement | null; onPress: () => void; colors: AppColors;
}) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity style={styles.churchCardCompact} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.churchCardTopRow}>
        <Text style={{ fontSize: 16 }}>⛪</Text>
        <Text style={styles.churchCardNameCompact} numberOfLines={1}>{church.name}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </View>
      <Text style={styles.churchCardLocationCompact}>
        {[church.city, church.country].filter(Boolean).join(", ")}
      </Text>
      {announcement && (
        <Text style={styles.churchCardAnnouncement} numberOfLines={1}>📌 {announcement.title}</Text>
      )}
    </TouchableOpacity>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20 },

    // Greeting + Daily Word hero. Always dark (gradient), so text is white
    // regardless of the user's light/dark theme.
    hero: { borderRadius: 24, padding: 20, paddingBottom: 22, marginBottom: 16, overflow: "hidden" },
    heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    heroGreeting: { fontSize: 22, color: "rgba(255,255,255,0.9)", fontFamily: "Inter_500Medium" },
    heroName: { fontSize: 30, color: "#fff", fontFamily: "Inter_700Bold", marginTop: 2 },
    heroVerseWrap: { marginTop: 14, borderLeftWidth: 2, borderLeftColor: "rgba(242,201,120,0.6)", paddingLeft: 12 },
    heroVerseText: { fontSize: 15, lineHeight: 23, color: "rgba(255,255,255,0.92)", fontFamily: "Inter_400Regular" },
    heroVerseRef: { fontSize: 13, color: "rgba(242,201,120,0.95)", marginTop: 8, fontFamily: "Inter_600SemiBold" },

    // Growth stage: image on top, progress in the same card underneath.
    growthCard: {
      borderRadius: 22, overflow: "hidden", marginBottom: 20,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
    },
    treeCard: { aspectRatio: 16 / 9, width: "100%", position: "relative" },
    treePhoto: { width: "100%", height: "100%" },
    treeShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" },
    growthBody: { padding: 16, gap: 6 },
    treePhotoFallback: {
      width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: c.card,
    },
    stageOverlay: {
      position: "absolute",
      bottom: 14,
      left: 14,
      backgroundColor: "rgba(0,0,0,0.45)",
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    stageOverlayText: {
      color: "#fff",
      fontSize: 18,
      fontFamily: "Inter_700Bold",
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

    progressLabelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    progressToward: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    progressPct: { fontSize: 14, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    progressBarBg: { height: 8, backgroundColor: c.progressTrack, borderRadius: 4, overflow: "hidden" },
    progressBarFill: { height: 8, backgroundColor: c.progressFill, borderRadius: 4 },
    progressHint: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    forestLinkRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.borderBeige,
    },
    forestLinkText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold", flex: 1 },

    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginTop: 4 },
    sectionHeading: { flex: 1, fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    seeAll: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold", paddingVertical: 6, paddingLeft: 10 },

    // Continue Your Kingdom School Journey
    ksContinueCard: {
      flexDirection: "row", alignItems: "center", gap: 14,
      backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige,
      padding: 12, marginBottom: 22,
    },
    ksThumb: { width: 76, height: 76, borderRadius: 14 },
    ksThumbFallback: { alignItems: "center", justifyContent: "center" },
    ksModuleTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    ksModuleMeta: { fontSize: 13, color: c.textMuted, marginTop: 3, fontFamily: "Inter_400Regular" },
    ksBarBg: { height: 5, borderRadius: 3, backgroundColor: c.progressTrack, marginTop: 10, overflow: "hidden" },
    ksBarFill: { height: 5, borderRadius: 3, backgroundColor: c.accentGreen },
    ksPlay: {
      width: 48, height: 48, borderRadius: 24, backgroundColor: c.accentGreen,
      alignItems: "center", justifyContent: "center",
    },
    ksExploreText: { fontSize: 13, marginTop: 8, fontFamily: "Inter_700Bold" },

    // Your Journey tiles
    journeyGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12, marginBottom: 12 },
    journeyTile: {
      width: "48.4%", minHeight: 112, backgroundColor: c.card, borderRadius: 18,
      borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 10,
    },
    journeyTileWide: { width: "100%", minHeight: 0, flexDirection: "row", alignItems: "center", gap: 14 },
    journeyIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    journeyTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    journeySub: { fontSize: 12, color: c.textMuted, marginTop: 2, lineHeight: 17, fontFamily: "Inter_400Regular" },
    toolLinksRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 22 },
    toolLink: {
      flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36,
      borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, paddingHorizontal: 12, paddingVertical: 7,
    },
    toolLinkText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_600SemiBold" },

    churchCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 16, gap: 6,
    },
    churchCardTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    churchCardName: { flex: 1, fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    churchCardLocation: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    groveStatsRow: { flexDirection: "row", gap: 14, marginTop: 2 },
    groveStatText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    groveAttentionText: { fontSize: 12, color: c.amber, fontFamily: "Inter_500Medium" },
    churchCardCta: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold", alignSelf: "flex-end", marginTop: 2 },

    churchCardCompact: {
      backgroundColor: c.cardBeige, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, marginBottom: 16, gap: 4,
    },
    churchCardNameCompact: { flex: 1, fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    churchCardLocationCompact: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    churchCardAnnouncement: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", marginTop: 2 },

    // Recommended for You
    recCard: {
      flexDirection: "row", alignItems: "center", gap: 14,
      backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige,
      padding: 12, paddingRight: 34, marginBottom: 22, position: "relative",
    },
    recImage: { width: 84, height: 84, borderRadius: 14 },
    recDismissBtn: { position: "absolute", top: 8, right: 8, padding: 4 },
    recTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    recEyebrow: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 6 },

    elijahCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: "rgba(224,164,65,0.08)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(224,164,65,0.25)",
      padding: 14, marginBottom: 16,
    },
    elijahIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(224,164,65,0.15)", alignItems: "center", justifyContent: "center" },
    elijahTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    elijahSub: { fontSize: 12, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },

    guideInviteCard: {
      backgroundColor: "#0B1F19", borderRadius: 16, padding: 16, marginBottom: 16, position: "relative",
    },
    guideInviteTitle: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", paddingRight: 20 },
    guideInviteSub: { fontSize: 13, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular", marginTop: 4 },
    guideInviteBtn: { backgroundColor: c.upperRoomAmber, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, alignSelf: "flex-start", marginTop: 14 },
    guideInviteBtnText: { fontSize: 13, fontWeight: "700", color: "#0B1F19", fontFamily: "Inter_700Bold" },

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

  });
}

export default function HomeTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { dailyVerse, isLoading, refreshData, pendingEvaluations, modules, treeData, forestStats, totalUnreadCount, mostRecentUnread, userChurch, isChurchLeader, churchMemberCount, getGroveData, getAnnouncements } = useData();
  const { colors } = useTheme();

  const styles = makeStyles(colors);
  const { isTablet } = useLayout();
  const { t } = useTranslation();

  const { modulesStarted, modulesCompleted, totalModules } = getModuleProgressCounts(modules);
  // No persistent "active mentee" relationship exists yet — see the same
  // note in learn.tsx; always false until a real peer-guide/mentee tracking
  // system is built.
  const kingdomSchoolStatus = getKingdomSchoolStatus(modulesStarted, modulesCompleted, totalModules, false);

  const [firstRecommendation, setFirstRecommendation] = useState<FirstRecommendation | null>(null);
  const [pendingElijahCheckIn, setPendingElijahCheckIn] = useState(false);
  const [pendingGuideAlertCount, setPendingGuideAlertCount] = useState(0);
  const [showGuideInvitation, setShowGuideInvitation] = useState(false);
  const [treePhotoFailed, setTreePhotoFailed] = useState(false);
  const [homeGroveData, setHomeGroveData] = useState<GroveData | null>(null);
  const [homeChurchAnnouncement, setHomeChurchAnnouncement] = useState<ChurchAnnouncement | null>(null);

  // Case 1 (leader with a joined church) needs grove stats for the summary card.
  useEffect(() => {
    if (!isChurchLeader || !userChurch) { setHomeGroveData(null); return; }
    let cancelled = false;
    getGroveData(userChurch.id).then((data) => { if (!cancelled) setHomeGroveData(data); });
    return () => { cancelled = true; };
  }, [isChurchLeader, userChurch, getGroveData]);

  // Case 3 (regular member in a church) needs the latest announcement.
  useEffect(() => {
    if (isChurchLeader || !userChurch) { setHomeChurchAnnouncement(null); return; }
    let cancelled = false;
    getAnnouncements(userChurch.id).then((list) => { if (!cancelled) setHomeChurchAnnouncement(list[0] ?? null); });
    return () => { cancelled = true; };
  }, [isChurchLeader, userChurch, getAnnouncements]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    AsyncStorage.getItem(`guideInvitationPending:${profile.id}`).then((v) => {
      if (!cancelled && v) setShowGuideInvitation(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [profile?.id]);

  const dismissGuideInvitation = useCallback(async () => {
    setShowGuideInvitation(false);
    if (profile?.id) await AsyncStorage.removeItem(`guideInvitationPending:${profile.id}`);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/pastoral-care/pending/${profile.id}`);
        const data = await res.json();
        if (!cancelled) setPendingElijahCheckIn(!!data);
      } catch {
        // Not critical — the card simply doesn't show this load.
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  // Pending "please check in" alerts for this user as a PEER GUIDE (not the
  // Elijah card above, which is for THEIR own inactivity) — same
  // no-push-tap-routing reasoning, surfaced as a Home card instead.
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/pastoral-care/guide-alerts/${profile.id}`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setPendingGuideAlertCount(data.length);
      } catch {
        // Not critical — the card simply doesn't show this load.
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      const dismissedKey = `firstRecommendationDismissed:${profile.id}`;
      const dismissed = await AsyncStorage.getItem(dismissedKey);
      if (dismissed || cancelled) return;
      try {
        const res = await fetch(`${getApiUrl()}/plans/recommended/${profile.id}`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setFirstRecommendation({ id: data[0].id, title: data[0].title, coverImageUrl: data[0].coverImageUrl ?? null, colorTheme: data[0].colorTheme ?? "#1D9E75" });
        }
      } catch {
        // No recommendation available yet — not an error state, just nothing to show.
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  const dismissRecommendation = useCallback(async () => {
    setFirstRecommendation(null);
    if (profile?.id) await AsyncStorage.setItem(`firstRecommendationDismissed:${profile.id}`, "true");
  }, [profile?.id]);

  const startRecommendation = useCallback(async () => {
    if (!firstRecommendation) return;
    const planId = firstRecommendation.id;
    await dismissRecommendation();
    if (!profile?.id) { router.push(`/plan/${planId}` as any); return; }
    const { data } = await supabase.from("p2p_plan_enrollments").select("id").eq("user_id", profile.id).eq("plan_id", planId).maybeSingle();
    if (data) router.push(`/plan/${planId}` as any);
    else router.push(`/plans/pre-plan-questions?planId=${planId}` as any);
  }, [firstRecommendation, profile?.id, router, dismissRecommendation]);

  const firstName = profile?.displayName?.split(" ")[0] ?? "";
  // Same thresholds as before, evaluated on the device's local clock.
  const hour = new Date().getHours();
  const dayPart: DayPart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const timeGreeting =
    dayPart === "morning" ? t("home.goodMorning") : dayPart === "afternoon" ? t("home.goodAfternoon") : t("home.goodEvening");

  // Same rule as the Kingdom School tab's "current module" (learn.tsx).
  const currentModule = modules.find((m) => !m.isLocked && m.completedLessons < m.lessonCount) ?? null;
  const goToKingdomSchool = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/learn"); };
  const go = (route: string) => () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(route as any); };

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
      {/* 1. Greeting + Daily Word, one spiritual welcome */}
      <HomeHero
        dayPart={dayPart}
        greetingLine={timeGreeting}
        firstName={firstName}
        verse={dailyVerse}
        photoUrl={profile?.avatarUrl ?? null}
        onPressAvatar={go("/(tabs)/profile")}
        styles={styles}
      />

      {/* 2. Current growth stage — same calculation as before, new card. The
          photo falls back to the SVG tree if it fails to load (e.g. offline). */}
      <View style={styles.growthCard}>
        <TouchableOpacity
          style={[styles.treeCard, isTablet && { aspectRatio: 21 / 9 }]}
          onPress={go("/living-tree")}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel={`${stage.name}, ${t("home.stageOf", { stage: stageIndex + 1 })}. ${t("home.livingTree")}`}
        >
          {!treePhotoFailed ? (
            <Image
              source={STAGE_IMAGES[stageIndex]}
              style={styles.treePhoto}
              resizeMode="cover"
              onError={() => setTreePhotoFailed(true)}
            />
          ) : treeData ? (
            <View style={styles.treePhotoFallback}>
              <LivingTree treeData={treeData} userId={profile?.id} compact />
            </View>
          ) : (
            <ActivityIndicator color={colors.accentGreen} />
          )}
          <LinearGradient colors={["transparent", "rgba(0,0,0,0.55)"]} style={styles.treeShade} pointerEvents="none" />
          <View style={styles.stageOverlay}>
            <Text style={styles.stageOverlayText}>{stage.emoji} {stage.name}</Text>
            <Text style={styles.stageOfText}>{t("home.stageOf", { stage: stageIndex + 1 })}</Text>
          </View>
          <View style={styles.arrowOverlay}>
            <Ionicons name="chevron-forward" size={16} color="#fff" />
          </View>
        </TouchableOpacity>

        <View style={styles.growthBody}>
          <View style={styles.progressLabelRow}>
            {nextStage ? (
              <Text style={styles.progressToward} numberOfLines={2}>
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
          <TouchableOpacity style={styles.forestLinkRow} onPress={go("/forest")} activeOpacity={0.85} accessibilityRole="button">
            <Text style={styles.forestLinkText}>
              🌳 View My Forest — {1 + forestStats.totalDisciples} tree{1 + forestStats.totalDisciples === 1 ? "" : "s"}, {forestStats.countriesReached.length} nation{forestStats.countriesReached.length === 1 ? "" : "s"}
            </Text>
            <Ionicons name="chevron-forward" size={15} color={colors.primaryGreen} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Church Discipleship Portal — completely free, no tiers. Only shown
          when relevant: leaders get a prominent dashboard/register prompt,
          regular members in a church get a light card, everyone else sees
          nothing (church tools aren't relevant to them). */}
      {isChurchLeader && userChurch && (
        <GroveHomeCard
          church={userChurch}
          grove={homeGroveData}
          memberCount={churchMemberCount}
          colors={colors}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/church/grove" as any); }}
        />
      )}
      {profile?.isMinistryLeader && !userChurch && (
        <RegisterChurchPromptCard
          colors={colors}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/church/register" as any); }}
        />
      )}
      {!profile?.isMinistryLeader && userChurch && (
        <MemberChurchCard
          church={userChurch}
          announcement={homeChurchAnnouncement}
          colors={colors}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/church" as any); }}
        />
      )}

      {/* Elijah Protocol check-in, if pastoral care has flagged one */}
      {pendingElijahCheckIn && (
        <ElijahCheckInCard
          colors={colors}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/elijah-response" as any);
          }}
        />
      )}

      {/* Unread messages preview */}
      {totalUnreadCount > 0 && (
        <UnreadMessagesCard
          count={totalUnreadCount}
          preview={mostRecentUnread?.lastMessage ?? null}
          colors={colors}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/messages" as any);
          }}
        />
      )}

      {/* Pending peer-guide check-in alerts (someone else needs a call) */}
      {pendingGuideAlertCount > 0 && (
        <PeerGuideAlertCard
          count={pendingGuideAlertCount}
          colors={colors}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/pastoral-alert" as any);
          }}
        />
      )}

      {/* One-time invitation to guide, shown right after becoming peer-guide eligible */}
      {showGuideInvitation && (
        <GuideInvitationCard
          colors={colors}
          onFind={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            dismissGuideInvitation();
            router.push("/connect/smart-match" as any);
          }}
          onDismiss={dismissGuideInvitation}
        />
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

      {/* 3. Continue Your Kingdom School Journey */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeading} accessibilityRole="header">{t("home.continueJourney")}</Text>
      </View>
      <ContinueJourneyCard
        module={currentModule}
        status={kingdomSchoolStatus}
        onOpenModule={(id) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/module/${id}` as any); }}
        onExplore={goToKingdomSchool}
        styles={styles}
        colors={colors}
        t={t}
      />

      {/* "How to use P2P" guide entry — hides itself once every step is done. */}
      <GetStartedCard />

      {/* 4. Your Journey — tiles instead of the old vertical list. No "See
          All": every journey feature is already here and no overview
          screen exists. */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeading} accessibilityRole="header">{t("home.yourJourney")}</Text>
      </View>
      <View style={styles.journeyGrid}>
        <JourneyTile icon="leaf" tint="#3FB37F" title={t("home.livingTree")} sub={t("home.livingTreeSub")} onPress={go("/living-tree")} styles={styles} />
        <JourneyTile icon="stats-chart" tint="#2FA4A9" title={t("home.myProgress")} sub={t("home.myProgressSub")} onPress={go("/progress")} styles={styles} />
        <JourneyTile icon="people" tint="#1D9E75" title={t("home.peerConnect")} sub={t("home.peerConnectSub")} onPress={go("/connect")} styles={styles} />
        <JourneyTile icon="people-circle" tint="#E0A441" title={t("home.myDiscipleship")} sub={t("home.myDiscipleshipSub")} onPress={go("/my-discipleship")} styles={styles} />
        <JourneyTile icon="home" tint="#E8873A" title={t("home.myFamily")} sub={t("home.myFamilySub")} onPress={go("/family")} styles={styles} wide />
      </View>
      {/* Previously only reachable from the old "More" list — kept here as
          small links so nothing disappears. Admin keeps its role gate. */}
      <View style={styles.toolLinksRow}>
        <TouchableOpacity style={styles.toolLink} onPress={go("/evaluations")} accessibilityRole="button" accessibilityLabel={`${t("home.peerReview")}. ${t("home.peerReviewSub")}`}>
          <Ionicons name="checkmark-done-outline" size={14} color={colors.accentGreen} />
          <Text style={styles.toolLinkText}>{t("home.peerReview")}</Text>
        </TouchableOpacity>
        {profile?.role && profile.role !== "student" && (
          <TouchableOpacity style={styles.toolLink} onPress={go("/admin/curriculum")} accessibilityRole="button" accessibilityLabel={`${t("home.admin")}. ${t("home.adminSub")}`}>
            <Ionicons name="settings-outline" size={14} color={colors.accentGreen} />
            <Text style={styles.toolLinkText}>{t("home.admin")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 5. Recommended for You — the existing goals-based recommendation */}
      {firstRecommendation && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading} accessibilityRole="header">{t("home.recommendedForYou")}</Text>
            <TouchableOpacity onPress={() => { void dismissRecommendation(); router.push("/plans?tab=find" as any); }} accessibilityRole="button">
              <Text style={styles.seeAll}>{t("home.seeAll")}</Text>
            </TouchableOpacity>
          </View>
          <RecommendedCard
            rec={firstRecommendation}
            onStart={startRecommendation}
            onDismiss={dismissRecommendation}
            colors={colors}
            t={t}
          />
        </>
      )}

      {/* 6. Be an Electronic Evangelist — stage-aware wording, real
          Remind Me Later snooze (see lib/inviteEncouragement.ts). */}
      <InviteEncouragementCard modulesCompleted={modulesCompleted} />
    </ScrollView>
  );
}
