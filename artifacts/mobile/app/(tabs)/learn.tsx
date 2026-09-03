import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Image,
  Animated,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import {
  useData,
  KingdomSchoolStatus,
  CurriculumCatalogItem,
  getModuleProgressCounts,
  getFoundationProgress,
  getKingdomSchoolStatus,
  recordFoundationCompletion,
} from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import CompletionCard from "@/components/CompletionCard";
import { PLAN_CATEGORIES } from "@/lib/planCategories";

const LOGO = require("@/assets/images/logo.png");
const SPLASH_SEEN_KEY_PREFIX = "kingdomSchoolSplashSeen:";

// Shown once per user the first time they deliberately open Kingdom School
// (mirrors the firstRecommendationDismissed/guideInvitationPending
// AsyncStorage-flag convention already used on the Home screen) — a plain
// component-mount gate, no new route and no new progress-tracking system,
// reusing getKingdomSchoolStatus/getFoundationProgress exactly as learn.tsx
// already computes them.
function KingdomSchoolSplash({ status, foundationPct, onEnter, colors }: {
  status: KingdomSchoolStatus; foundationPct: number; onEnter: () => void; colors: AppColors;
}) {
  const styles = splashStyles(colors);
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const missionOpacity = useRef(new Animated.Value(0)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(160, [
      Animated.timing(logoOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(titleOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(missionOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(buttonOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, []);

  const isFirstTime = status === "exploring";
  const isFoundationDone = status === "foundation_complete" || status === "guiding_others";

  let heading = "Welcome to Kingdom School";
  let sub = "Your discipleship journey begins here.";
  let cta = "Start Learning →";
  if (isFoundationDone) {
    heading = "Welcome Back";
    sub = "Your foundation is established. Continue growing and helping others grow.";
    cta = "Explore Kingdom School →";
  } else if (!isFirstTime) {
    heading = "Welcome Back";
    sub = "Continue your journey of learning and growth.";
    cta = "Continue Learning →";
  }

  return (
    <View style={styles.root}>
      <Animated.View style={{ opacity: logoOpacity }}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />
      </Animated.View>

      <Animated.View style={{ opacity: titleOpacity, alignItems: "center" }}>
        <Text style={styles.eyebrow}>WELCOME TO</Text>
        <Text style={styles.title}>KINGDOM SCHOOL</Text>
      </Animated.View>

      <Animated.View style={{ opacity: missionOpacity, alignItems: "center" }}>
        <Text style={styles.mission}>Learn Christ. Grow in Christ. Help others grow in Christ.</Text>
        <Text style={styles.heading}>{heading}</Text>
        <Text style={styles.sub}>{sub}</Text>
        {!isFirstTime && !isFoundationDone && (
          <Text style={styles.progressLine}>Foundation — {foundationPct}% complete</Text>
        )}
      </Animated.View>

      <Animated.View style={{ opacity: buttonOpacity, width: "100%" }}>
        <TouchableOpacity style={styles.enterBtn} onPress={onEnter} activeOpacity={0.9}>
          <Text style={styles.enterBtnText}>{cta}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function splashStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 22, backgroundColor: c.lightCream },
    logo: { width: 84, height: 84 },
    eyebrow: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 2 },
    title: { fontSize: 26, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", letterSpacing: 1, marginTop: 4 },
    mission: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, marginBottom: 14 },
    heading: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    sub: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
    progressLine: { fontSize: 13, fontWeight: "600", color: c.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 10 },
    enterBtn: { backgroundColor: c.accentGreen, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
    enterBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}

function foundationsIconForTitle(title: string): keyof typeof Ionicons.glyphMap {
  if (title.includes("Peer-to-Peer") || title.includes("Orientation")) return "people-circle-outline";
  if (title.includes("Gospel")) return "sunny-outline";
  if (title.includes("Foundation")) return "leaf-outline";
  return "library-outline";
}

// The cover photo as its own large square block on the right of the card —
// a real flex column next to the text column (not an overlapping full-bleed
// background with a fade), so growing the photo can never encroach on or
// compress the text: the two live in separate, fixed layout regions. Falls
// back to the icon + color wash exactly as before when there is no photo
// yet or it fails to load.
function CategoryPhotoBlock({
  uri, icon, colorTheme, style, fallbackStyle,
}: { uri: string | null; icon: keyof typeof Ionicons.glyphMap; colorTheme: string; style: any; fallbackStyle: any }) {
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={style}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }
  return (
    <View style={[style, fallbackStyle, { backgroundColor: `${colorTheme}1f` }]}>
      <Ionicons name={icon} size={30} color={colorTheme} />
    </View>
  );
}

// One stand-alone Foundations category, rendered as a photo card — same
// visual language as app/curriculum.tsx's card (which remains reachable
// directly too), reused here inline so Kingdom School -> Foundations is a
// single self-contained experience rather than an extra navigation hop.
function FoundationCategoryCard({ item, colors, onPress }: { item: CurriculumCatalogItem; colors: AppColors; onPress: () => void }) {
  const styles = foundationCardStyles(colors);
  const icon = (item.icon as keyof typeof Ionicons.glyphMap) || foundationsIconForTitle(item.title);
  const countsLabel = `${item.moduleCount} ${item.moduleCount === 1 ? "module" : "modules"} · ${item.lessonCount} ${item.lessonCount === 1 ? "lesson" : "lessons"}`;
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.description}. ${countsLabel}. Tap to open.`}
    >
      <View style={styles.content}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="book-outline" size={13} color={colors.textMuted} />
          <Text style={styles.metaText}>{countsLabel}</Text>
        </View>
      </View>

      {/* A dedicated block, not an overlapping background — the text
          column above is never affected no matter how large this photo is. */}
      <View style={styles.photoWrap}>
        <CategoryPhotoBlock uri={item.coverImage} icon={icon} colorTheme={item.colorTheme} style={styles.photoBlock} fallbackStyle={styles.photoBlockFallback} />
        <View style={styles.arrowBadge} accessibilityElementsHidden importantForAccessibility="no">
          <Ionicons name="chevron-forward" size={18} color={colors.textDark} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function foundationCardStyles(c: AppColors) {
  return StyleSheet.create({
    card: {
      flexDirection: "row", minHeight: 150, borderRadius: 18, overflow: "hidden",
      borderWidth: 1, borderColor: c.borderBeige, marginBottom: 12, backgroundColor: c.card,
      shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1,
    },
    // A fixed, protected text column — its width never changes no matter
    // how the photo block next to it is sized.
    content: { flex: 1, padding: 16, justifyContent: "center" },
    title: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
    desc: { fontSize: 12, color: c.textMid, lineHeight: 17, fontFamily: "Inter_400Regular", marginBottom: 8 },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    metaText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium" },
    // The photo's own dedicated region — large and square-ish, taking up
    // the maximum width the card can spare on the right without shrinking
    // the text column below.
    photoWrap: { width: 132, alignSelf: "stretch" },
    photoBlock: { width: "100%", height: "100%" },
    photoBlockFallback: { alignItems: "center", justifyContent: "center" },
    arrowBadge: {
      position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: 14,
      backgroundColor: "rgba(255,255,255,0.85)", alignItems: "center", justifyContent: "center",
    },
  });
}

type KingdomSchoolSection = "foundation" | null;

// The two-card selector at the top of Kingdom School — designed to feel
// like tabs but built as premium cards, not a generic segmented control.
// Only one of Foundation/Electives is expanded below at a time; tapping the
// already-expanded card collapses it.
function KingdomSchoolCards({
  selected,
  onSelect,
  modulesCompleted,
  totalModules,
  foundationPct,
  plansCount,
  enrolledCount,
}: {
  selected: KingdomSchoolSection;
  onSelect: (s: KingdomSchoolSection) => void;
  modulesCompleted: number;
  totalModules: number;
  foundationPct: number;
  plansCount: number;
  enrolledCount: number;
}) {
  const router = useRouter();
  return (
    <View style={cardSelectorStyles.row}>
      <TouchableOpacity
        style={[cardSelectorStyles.card, cardSelectorStyles.foundationCard, selected === "foundation" && cardSelectorStyles.cardSelected]}
        activeOpacity={0.9}
        onPress={() => onSelect(selected === "foundation" ? null : "foundation")}
      >
        <Ionicons name="book" size={22} color="#fff" />
        <Text style={cardSelectorStyles.cardTitle}>Foundations</Text>
        <Text style={cardSelectorStyles.cardSubtitle}>Core Curriculum</Text>
        <Text style={cardSelectorStyles.cardInfo}>{modulesCompleted} of {totalModules} modules</Text>
        <View style={cardSelectorStyles.progressBg}>
          <View style={[cardSelectorStyles.progressFill, { width: `${foundationPct}%` as any }]} />
        </View>
      </TouchableOpacity>

      {/* Navigates straight to Find Plans (Categories sub-tab, its default)
          instead of expanding inline, since Electives is now a full
          10-category/144-plan browsing experience of its own. */}
      <TouchableOpacity
        style={[cardSelectorStyles.card, cardSelectorStyles.electivesCard]}
        activeOpacity={0.9}
        onPress={() => router.push("/plans?tab=find" as any)}
      >
        <Ionicons name="star" size={22} color="#fff" />
        <Text style={cardSelectorStyles.cardTitle}>Electives</Text>
        <Text style={cardSelectorStyles.cardSubtitle}>Plans & Courses</Text>
        <Text style={cardSelectorStyles.cardInfo}>{PLAN_CATEGORIES.length} categories</Text>
        <Text style={cardSelectorStyles.cardInfo}>{plansCount} plan{plansCount === 1 ? "" : "s"}</Text>
        {enrolledCount > 0 && (
          <Text style={cardSelectorStyles.cardInfo}>{enrolledCount} in progress</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const cardSelectorStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingTop: 20 },
  card: { flex: 1, borderRadius: 18, padding: 16, minHeight: 148, justifyContent: "space-between" },
  cardSelected: { borderWidth: 2, borderColor: "rgba(255,255,255,0.6)" },
  foundationCard: { backgroundColor: "#1D4E2B" },
  electivesCard: { backgroundColor: "#B8860B" },
  cardTitle: { fontSize: 17, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", marginTop: 10 },
  cardSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_500Medium", marginTop: 2 },
  cardInfo: { fontSize: 12, color: "rgba(255,255,255,0.9)", fontFamily: "Inter_600SemiBold", marginTop: 8 },
  progressBg: { height: 4, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 2, marginTop: 8, overflow: "hidden" },
  progressFill: { height: 4, backgroundColor: "#fff", borderRadius: 2 },
});

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    scroll: { paddingBottom: 100 },

    topBarRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2 },
    topBarMenuBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: "rgba(29,158,117,0.1)", borderWidth: 1, borderColor: "rgba(29,158,117,0.3)",
      borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
    },
    topBarMenuBtnActive: { backgroundColor: "rgba(29,158,117,0.18)", borderColor: c.accentGreen },
    topBarMenuBtnText: { fontSize: 12, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    dropdownOverlay: { flex: 1 },
    dropdownCard: {
      position: "absolute", right: 16, backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1, borderColor: c.borderBeige, paddingVertical: 4, minWidth: 220,
      shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 12, elevation: 6,
    },
    dropdownCaret: {
      position: "absolute", top: -7, right: 22, width: 14, height: 14,
      backgroundColor: c.card, borderTopWidth: 1, borderLeftWidth: 1, borderColor: c.borderBeige,
      transform: [{ rotate: "45deg" }],
    },
    dropdownRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    dropdownRowIconWrap: {
      width: 32, height: 32, borderRadius: 9, backgroundColor: "rgba(29,158,117,0.1)",
      alignItems: "center", justifyContent: "center",
    },
    dropdownRowText: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    dropdownRowSubText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    dropdownDivider: { height: 1, backgroundColor: c.borderBeige, marginHorizontal: 14 },

    sectionBlock: { paddingHorizontal: 20, paddingTop: 24 },
    sectionHeaderRow: { marginBottom: 4 },
    sectionHeaderTitle: { fontSize: 22, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    sectionHeaderSubtitle: { fontSize: 13, color: c.textMuted, marginTop: 4, lineHeight: 19, fontFamily: "Inter_400Regular" },

    foundationProgressBlock: { marginTop: 18, marginBottom: 4 },
    foundationProgressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    foundationProgressPct: { fontSize: 15, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    foundationBarBg: { height: 8, backgroundColor: c.progressTrack, borderRadius: 4, overflow: "hidden" },
    foundationBarFill: { height: 8, backgroundColor: c.accentGreen, borderRadius: 4 },

    continueCard: {
      marginTop: 18,
      backgroundColor: c.primaryGreen, borderRadius: 16,
      padding: 16, flexDirection: "row", alignItems: "center", gap: 12,
    },
    continueLabel: { fontSize: 11, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
    continueTitle: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", marginTop: 2 },
    continueBtn: {
      backgroundColor: "#fff", borderRadius: 20,
      paddingHorizontal: 16, paddingVertical: 9,
      flexDirection: "row", alignItems: "center", gap: 4,
    },
    continueBtnText: { fontSize: 13, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold" },

    allModulesHeading: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 24, marginBottom: 12 },
    foundationsIntro: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: -6, marginBottom: 14 },
    modulesList: { gap: 8 },

    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },

    card: {
      borderRadius: 16, borderWidth: 1,
      padding: 14, flexDirection: "row", gap: 12, alignItems: "center",
    },
    cardLocked: { opacity: 0.55 },
    cardLeft: { alignItems: "center", gap: 6 },
    thumb: { width: 48, height: 48, borderRadius: 10 },
    thumbLocked: { opacity: 0.4 },
    thumbPlaceholder: { backgroundColor: "rgba(29,158,117,0.08)", alignItems: "center", justifyContent: "center" },
    levelBadge: {
      width: 36, height: 36, borderRadius: 10,
      alignItems: "center", justifyContent: "center",
    },
    levelText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
    cardBody: { flex: 1 },
    moduleTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
    moduleTitle: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    currentPill: { backgroundColor: c.accentGreen, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
    currentPillText: { fontSize: 9, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", textTransform: "uppercase" },
    moduleDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    progressBg: { flex: 1, height: 4, borderRadius: 2 },
    progressFill: { height: 4, borderRadius: 2 },
    progressText: { fontSize: 11, fontFamily: "Inter_400Regular", minWidth: 28 },
    progressSubText: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 3 },
    cardRight: {},
  });
}

export default function LearnTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  // Title/description arrive already translated — DataContext.loadPlans
  // does the on-demand translation fetch itself (parallel, English fallback
  // always), so there's nothing left for this screen to fetch.
  const { modules, plans, getCurriculumCatalog } = useData();
  const { colors } = useTheme();

  const styles = makeStyles(colors);
  const { isTablet } = useLayout();
  const { t } = useTranslation();

  const [completionCard, setCompletionCard] = useState<{ date: string } | null>(null);
  const [selectedSection, setSelectedSection] = useState<KingdomSchoolSection>("foundation");
  const [enrolledCount, setEnrolledCount] = useState(0);

  // Foundations — the three stand-alone curriculum categories (Peer-to-Peer
  // Orientation, The Gospel & Salvation, The Christian Foundation), loaded
  // the same database-driven way app/curriculum.tsx does. Kingdom School ->
  // Foundations is now the only in-app entry point to this browsing
  // experience; Home no longer links to it directly.
  const [foundationsCatalog, setFoundationsCatalog] = useState<CurriculumCatalogItem[]>([]);
  const [foundationsLoading, setFoundationsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const catalog = await getCurriculumCatalog();
      if (!cancelled) {
        setFoundationsCatalog(catalog);
        setFoundationsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getCurriculumCatalog]);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from("p2p_plan_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .then(({ count }) => setEnrolledCount(count ?? 0));
  }, [profile?.id]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const totalLessons = modules.reduce((a, m) => a + m.lessonCount, 0);

  const { modulesStarted, modulesCompleted, totalModules } = getModuleProgressCounts(modules);
  const foundationPct = getFoundationProgress(modulesCompleted, totalModules);
  // No persistent "active mentee" relationship exists in this codebase yet —
  // Prompt 1 explicitly rules out DB changes for this rebrand, so this is
  // always false until a real peer-guide/mentee tracking system exists.
  const hasActiveMentee = false;
  const status = getKingdomSchoolStatus(modulesStarted, modulesCompleted, totalModules, hasActiveMentee);

  const currentModule = modules.find((m) => !m.isLocked && m.completedLessons < m.lessonCount) ?? null;

  // Welcome splash — shown once per user the first time they deliberately
  // open Kingdom School (null = still checking AsyncStorage, false = show
  // the splash, true = already seen, go straight to content).
  const [splashSeen, setSplashSeen] = useState<boolean | null>(null);
  useEffect(() => {
    if (!profile?.id) return;
    AsyncStorage.getItem(`${SPLASH_SEEN_KEY_PREFIX}${profile.id}`).then((v) => setSplashSeen(!!v));
  }, [profile?.id]);
  function handleEnterKingdomSchool() {
    setSplashSeen(true);
    if (profile?.id) AsyncStorage.setItem(`${SPLASH_SEEN_KEY_PREFIX}${profile.id}`, "true");
  }

  const [schoolMenuOpen, setSchoolMenuOpen] = useState(false);

  // Celebrate reaching Foundation completion exactly once per user, on-device
  // (no DB column for this — see recordFoundationCompletion's own comment).
  useEffect(() => {
    if (!profile?.id) return;
    if (status !== "foundation_complete" && status !== "guiding_others") return;
    recordFoundationCompletion(profile.id).then(({ date, isFirstTime }) => {
      if (isFirstTime) setCompletionCard({ date });
    });
  }, [status, profile?.id]);

  if (splashSeen === null) {
    return <View style={[styles.container, { paddingTop: topPad }]} />;
  }
  if (splashSeen === false) {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <KingdomSchoolSplash status={status} foundationPct={foundationPct} onEnter={handleEnterKingdomSchool} colors={colors} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={isTablet ? { flex: 1, maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", width: "100%" } : { flex: 1 }}>
        <View style={styles.topBarRow}>
          <TouchableOpacity
            style={[styles.topBarMenuBtn, schoolMenuOpen && styles.topBarMenuBtnActive]}
            onPress={() => setSchoolMenuOpen(true)}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="bookmark" size={15} color={colors.accentGreen} />
            <Text style={styles.topBarMenuBtnText}>Notes & Highlights</Text>
            <Ionicons name="chevron-down" size={14} color={colors.accentGreen} />
          </TouchableOpacity>
        </View>

        <Modal visible={schoolMenuOpen} transparent animationType="fade" onRequestClose={() => setSchoolMenuOpen(false)}>
          <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPress={() => setSchoolMenuOpen(false)}>
            <View style={[styles.dropdownCard, { top: topPad + 46 }]}>
              <View style={styles.dropdownCaret} />
              <TouchableOpacity
                style={styles.dropdownRow}
                onPress={() => { setSchoolMenuOpen(false); router.push("/notes" as any); }}
                activeOpacity={0.7}
              >
                <View style={styles.dropdownRowIconWrap}>
                  <Ionicons name="document-text-outline" size={17} color={colors.accentGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownRowText}>Notes</Text>
                  <Text style={styles.dropdownRowSubText}>Your written notes</Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
              </TouchableOpacity>
              <View style={styles.dropdownDivider} />
              <TouchableOpacity
                style={styles.dropdownRow}
                onPress={() => { setSchoolMenuOpen(false); router.push("/highlights" as any); }}
                activeOpacity={0.7}
              >
                <View style={styles.dropdownRowIconWrap}>
                  <Ionicons name="bookmark-outline" size={17} color={colors.accentGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownRowText}>Highlights</Text>
                  <Text style={styles.dropdownRowSubText}>Saved passages & quotes</Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          <KingdomSchoolCards
            selected={selectedSection}
            onSelect={setSelectedSection}
            modulesCompleted={modulesCompleted}
            totalModules={totalModules}
            foundationPct={foundationPct}
            plansCount={plans.length}
            enrolledCount={enrolledCount}
          />

          {/* ── Section 1: Foundation ── */}
          {selectedSection === "foundation" && (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderTitle}>{t("learn.foundationHeader")}</Text>
              <Text style={styles.sectionHeaderSubtitle}>
                {t("learn.foundationSubtitle", { modules: totalModules, lessons: totalLessons })}
              </Text>
            </View>

            <View style={styles.foundationProgressBlock}>
              <View style={styles.foundationProgressRow}>
                <Text style={styles.foundationProgressPct}>{t("learn.foundationPctComplete", { pct: foundationPct })}</Text>
              </View>
              <View style={styles.foundationBarBg}>
                <View style={[styles.foundationBarFill, { width: `${foundationPct}%` as any }]} />
              </View>
            </View>

            {currentModule && (
              <TouchableOpacity
                style={styles.continueCard}
                activeOpacity={0.9}
                onPress={() => router.push(`/module/${currentModule.id}`)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.continueLabel}>{t("learn.currentModule")}</Text>
                  <Text style={styles.continueTitle} numberOfLines={1}>{currentModule.title}</Text>
                </View>
                <View style={styles.continueBtn}>
                  <Text style={styles.continueBtnText}>{t("learn.continueBtn")}</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.primaryGreen} />
                </View>
              </TouchableOpacity>
            )}

            <Text style={styles.allModulesHeading}>Foundations</Text>
            <Text style={styles.foundationsIntro}>
              Three stand-alone journeys — study one, return to another later, or explore several at once. There's no required order.
            </Text>
            {foundationsLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color={colors.accentGreen} />
              </View>
            ) : (
              <View>
                {foundationsCatalog.map((item) => (
                  <FoundationCategoryCard
                    key={item.id}
                    item={item}
                    colors={colors}
                    onPress={() => router.push(`/curriculum/${item.id}` as any)}
                  />
                ))}
              </View>
            )}
          </View>
          )}

        </ScrollView>
      </View>

      {completionCard && profile && (
        <CompletionCard
          visible
          firstName={profile.displayName?.split(" ")[0] ?? "Friend"}
          completionDate={completionCard.date}
          onClose={() => setCompletionCard(null)}
        />
      )}
    </View>
  );
}
