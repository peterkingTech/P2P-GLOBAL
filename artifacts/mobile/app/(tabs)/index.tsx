import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  RefreshControl,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScrollToTopOnTabReselect, useTabCapsuleTopInset } from "@/components/IPadTabCapsule";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import {
  useData,
  KingdomSchoolStatus,
  KINGDOM_SCHOOL_STATUS_LABELS,
  getModuleProgressCounts,
  getKingdomSchoolStatus,
} from "@/contexts/DataContext";
import { getApiUrl } from "@/lib/apiUrl";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/Avatar";
import ReadableText from "@/components/ReadableText";
import { AppButton } from "@/components/ui";
import { currentModule as currentModuleOf } from "@/lib/learningHome";

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
          <ReadableText style={styles.heroVerseRef}>— {verse.ref}</ReadableText>
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

// Surfaces an unresponded Elijah Protocol pastoral-care message (see
// GET /pastoral-care/pending/:userId). This app has no push-notification
// tap-routing infrastructure, so this Home-screen card — not a notification
// tap — is the real way a returning user reaches elijah-response.tsx.
function ElijahCheckInCard({ onPress, colors }: { onPress: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <TouchableOpacity accessibilityRole="button" style={styles.elijahCard} activeOpacity={0.9} onPress={onPress}>
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
    <TouchableOpacity accessibilityRole="button" style={styles.elijahCard} activeOpacity={0.9} onPress={onPress}>
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

function GuideInvitationCard({ onFind, onDismiss, colors }: { onFind: () => void; onDismiss: () => void; colors: any }) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.guideInviteCard}>
      <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" style={styles.recDismissBtn} onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
      <Text style={styles.guideInviteTitle}>Someone is waiting for a guide like you.</Text>
      <Text style={styles.guideInviteSub}>Ready to meet them?</Text>
      <AppButton label="Find Someone to Guide" onPress={onFind} style={{ alignSelf: "flex-start", marginTop: 14 }} />
    </View>
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

    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginTop: 4 },
    sectionHeading: { flex: 1, fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },

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

    // Close button on the guide invitation
    recDismissBtn: { position: "absolute", top: 8, right: 8, padding: 4 },

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

// Home is a calm starting point: the greeting with the Daily Word, the
// updates that need this person (shown only when present), and one next
// step. Everything that used to sit here as a dashboard widget lives in its
// own place now: growth, journey and My P2P in Profile (My growth / My
// space), families and church in Discover's community entry, the
// recommended plans on the Plans screen, messages in the Messages tab. Native home-screen widgets are
// separate (WidgetSyncHost in app/_layout.tsx) and unchanged.
export default function HomeTab() {
  const insets = useSafeAreaInsets();
  const capsuleTopInset = useTabCapsuleTopInset(insets.top);
  const tabScrollRef = React.useRef<ScrollView>(null);
  useScrollToTopOnTabReselect("index", tabScrollRef);
  const router = useRouter();
  const { profile } = useAuth();
  const { dailyVerse, isLoading, refreshData, pendingEvaluations, modules } = useData();
  const { colors } = useTheme();

  const styles = makeStyles(colors);
  const { contentMaxWidth } = useLayout();
  const { t } = useTranslation();

  const { modulesStarted, modulesCompleted, totalModules } = getModuleProgressCounts(modules);
  // No persistent "active mentee" relationship exists yet — see the same
  // note in learn.tsx; always false until a real peer-guide/mentee tracking
  // system is built.
  const kingdomSchoolStatus = getKingdomSchoolStatus(modulesStarted, modulesCompleted, totalModules, false);

  const [pendingElijahCheckIn, setPendingElijahCheckIn] = useState(false);
  const [pendingGuideAlertCount, setPendingGuideAlertCount] = useState(0);
  const [showGuideInvitation, setShowGuideInvitation] = useState(false);

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

  const firstName = profile?.displayName?.split(" ")[0] ?? "";
  // Same thresholds as before, evaluated on the device's local clock.
  const hour = new Date().getHours();
  const dayPart: DayPart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const timeGreeting =
    dayPart === "morning" ? t("home.goodMorning") : dayPart === "afternoon" ? t("home.goodAfternoon") : t("home.goodEvening");

  // Same rule as the Kingdom School tab's "current module" (learn.tsx).
  const currentModule = currentModuleOf(modules);
  const goToKingdomSchool = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/kingdom-school" as any); };
  const go = (route: string) => () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(route as any); };

  const topPad = insets.top + capsuleTopInset + (Platform.OS === "web" ? 67 : 0);

  return (
    <ScrollView
      ref={tabScrollRef}
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 }, centeredMaxWidth(contentMaxWidth)]}
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
        <TouchableOpacity accessibilityRole="button"
          style={styles.evalCard}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push({ pathname: "/evaluation", params: { tab: "serving" } } as any);
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

      {/* 2. Continue — the one next step in the Kingdom School journey */}
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
    </ScrollView>
  );
}
