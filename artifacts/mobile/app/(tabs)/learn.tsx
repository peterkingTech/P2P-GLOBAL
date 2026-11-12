import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Platform, ActivityIndicator, FlatList } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useScrollToTopOnTabReselect, useTabCapsuleTopInset } from "@/components/IPadTabCapsule";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";
import { useData, getModuleProgressCounts } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import LearningHub, { type LearningHubDetails } from "@/components/LearningHub";
import { FeaturedLearningCard, CompactLearningCard, type FeaturedLearning } from "@/components/learning/LearningCards";
import { getDiscoverHome, type DiscoverHome } from "@/lib/kingdomStoriesApi";
import { getMyStudies, type MyStudies } from "@/lib/studyTogetherApi";
import { getLearningOverview, type LearningOverview } from "@/lib/learningCentreApi";
import { loadPosition, type ReadingPosition } from "@/lib/bibleReadingPrefs";
import { bookByCode } from "@/lib/bibleReaderApi";
import { continueItems, isStoryInProgress, type ContinueItem } from "@/lib/learningHome";
import { COMPREHENSIVE_CHECKS } from "@/lib/terminology";
import { loadCached, peekCached, qk } from "@/lib/query";
import { usePerfVisit } from "@/lib/perf";
import { BIBLE_COVER, BIBLE_COVER_BG } from "@/constants/artwork";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";

// The Learning tab. One clean starting point:
//   a personal header (your name, what's under way);
//   Continue Learning — the most relevant unfinished activity (real progress
//     only: Kingdom School module, Kingdom Story, shared study, Bible chapter);
//   Explore Learning — an icon launcher: Kingdom School, Kingdom Stories, Learning Centre,
//     My Evaluations (Bible has its own tab; Study Together opens from the resources that support it).
//   The learning dashboard (Kingdom School progress, Comprehensive Checks) lives in the Learning
//   Centre, which is "My Learning" — so it isn't repeated here.
// Kingdom School's full dashboard lives on its own screen (/kingdom-school);
// nothing is duplicated here. Each section loads on its own, so one slow or
// failed source never blocks the others. Everything comes from the shared
// cache first (instant on return), then refreshes: the stories home is the
// same cached copy Kingdom Stories uses, so the two never fetch it twice.

function LearnTab() {
  const insets = useSafeAreaInsets();
  const capsuleTopInset = useTabCapsuleTopInset(insets.top);
  const scrollRef = React.useRef<ScrollView>(null);
  useScrollToTopOnTabReselect("learn", scrollRef);
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth, isTablet, isLargeTablet } = useLayout();
  const { modules, pendingEvaluations } = useData();
  const { profile } = useAuth();

  const [stories, setStories] = useState<DiscoverHome | null>(() => peekCached<DiscoverHome>(qk.storiesHome()) ?? null);
  const [studies, setStudies] = useState<MyStudies["active"] | null>(() => peekCached<MyStudies>(qk.myStudies())?.active ?? null);
  const [overview, setOverview] = useState<LearningOverview | null>(() => peekCached<LearningOverview>(qk.learningOverview()) ?? null);
  const [bible, setBible] = useState<ReadingPosition | null>(null);
  const [loaded, setLoaded] = useState(() => ({ stories: !!stories, studies: !!studies }));

  const load = useCallback(() => {
    // Stories home: shared with Kingdom Stories (finishing a chapter marks it outdated).
    loadCached(qk.storiesHome(), () => getDiscoverHome(), { maxAgeMs: 30_000 }).then(setStories).catch(() => {}).finally(() => setLoaded((l) => ({ ...l, stories: true })));
    // Studies and Comprehensive Checks change elsewhere — shown from memory, always refreshed.
    loadCached(qk.myStudies(), () => getMyStudies(), { fresh: true }).then((r) => setStudies(r.active)).catch(() => setStudies((x) => x ?? [])).finally(() => setLoaded((l) => ({ ...l, studies: true })));
    loadCached(qk.learningOverview(), () => getLearningOverview(), { fresh: true }).then(setOverview).catch(() => {});
    loadPosition().then(setBible).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  usePerfVisit("learn", "Learning Centre", "learn", loaded.stories && loaded.studies);

  // Every story cover the discover home already returned, by story id — so a
  // shared study of a story can show that story's photo too.
  const storyCovers = useMemo(() => {
    const out: Record<string, string> = {};
    if (!stories) return out;
    const all = [stories.continueLearning, stories.favourites, stories.later, stories.recentlyViewed, stories.recentlyAdded,
      ...stories.collections.map((c) => c.stories), ...stories.categoryRows.map((r) => r.stories)].flat();
    for (const st of all) { const p = st.media?.[0]?.mediaPath; if (p && !out[st.id]) out[st.id] = p; }
    if (stories.featured?.hero && !out[stories.featured.id]) out[stories.featured.id] = stories.featured.hero.mediaPath;
    return out;
  }, [stories]);
  const bibleAt = bible ? { book: bible.book, bookName: bookByCode(bible.book)?.name ?? bible.book, chapter: bible.chapter, translation: bible.translation } : null;
  const items: ContinueItem[] = useMemo(() => continueItems({
    modules,
    stories: stories?.continueLearning ?? [],
    studies: (studies ?? []).slice(0, 3),
    bible: bibleAt,
    storyCovers,
  }), [modules, stories, studies, bible, storyCovers]);
  const [lead, ...more] = items;
  const { modulesCompleted, totalModules } = getModuleProgressCounts(modules);
  const storiesUnderWay = (stories?.continueLearning ?? []).filter(isStoryInProgress).length;
  const go = (r: ContinueItem["route"]) => router.push(r as any);
  const topPad = insets.top + capsuleTopInset + (Platform.OS === "web" ? 67 : 0);
  const wide = isTablet;

  // Header: the person's name and what's actually under way (nothing invented).
  const firstName = profile?.displayName?.split(" ")[0] ?? "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const underWay = items.filter((i) => i.progress === null || i.progress > 0).length;
  const toDo = overview?.toDo.length ?? 0;
  const summary = [
    underWay ? `${underWay} ${underWay === 1 ? "activity" : "activities"} in progress` : null,
    toDo ? `${toDo} ${COMPREHENSIVE_CHECKS} to do` : null,
  ].filter(Boolean).join(" · ") || "Grow in Scripture, understanding and discipleship.";

  // Explore Learning: "where you are" in each experience, from the data above.
  const hub: LearningHubDetails = {
    school: { status: totalModules ? `${modulesCompleted} of ${totalModules} modules complete` : null },
    stories: { status: storiesUnderWay ? `${storiesUnderWay} ${storiesUnderWay === 1 ? "story" : "stories"} in progress` : null },
    centre: { status: toDo ? `${toDo} ${COMPREHENSIVE_CHECKS} to do` : null },
    evaluations: { status: pendingEvaluations.length ? `${pendingEvaluations.length} waiting for you` : null },
  };

  return (
    <View style={[s.screen, { paddingTop: topPad }]}>
      <ScrollView ref={scrollRef} contentContainerStyle={[s.scroll, wide && { paddingHorizontal: isLargeTablet ? 32 : 24 }, { paddingBottom: insets.bottom + 100 }, centeredMaxWidth(contentMaxWidth)]} showsVerticalScrollIndicator={false}>
        {/* Header — personal, compact, so the learning content gets the space */}
        <View style={s.header}>
          <Text style={s.eyebrow}>Learning</Text>
          <Text style={[s.title, wide && { fontSize: 34, lineHeight: 40 }]} accessibilityRole="header">
            {firstName ? `${greeting}, ${firstName}` : "Your learning"}
          </Text>
          <Text style={s.subtitle}>{summary}</Text>
        </View>

        {/* Continue Learning */}
        <SectionHeading s={s} title="Continue Learning" />
        {lead ? (
          <FeaturedLearningCard item={featured(lead)} colors={colors} wide={wide} onPress={() => go(lead.route)} />
        ) : !loaded.stories || !loaded.studies ? <ActivityIndicator color={colors.accentGreen} style={{ marginVertical: 24 }} accessibilityLabel="Loading your learning" />
          : (
            <View style={s.empty}>
              <Ionicons name="compass-outline" size={22} color={colors.accentGreen} />
              <Text style={[s.meta, { flex: 1 }]}>Nothing in progress yet. Choose where to begin below — Kingdom School's Foundations or the first Kingdom Story are good places to start.</Text>
            </View>
          )}
        {more.length > 0 && (
          <FlatList horizontal data={more} keyExtractor={(x) => x.key} showsHorizontalScrollIndicator={Platform.OS === "web"}
            style={s.rail} contentContainerStyle={[{ gap: 10, paddingTop: 12 }, s.railContent]}
            renderItem={({ item }) => <CompactLearningCard item={featured(item)} colors={colors} onPress={() => go(item.route)} />} />
        )}

        {/* Explore Learning */}
        <SectionHeading s={s} title="Explore Learning" />
        <LearningHub colors={colors} details={hub} columns={wide ? 4 : 2} />
      </ScrollView>
    </View>
  );
}

function SectionHeading({ s, title, action }: { s: ReturnType<typeof makeStyles>; title: string; action?: React.ReactNode }) {
  return (
    <View style={s.sectionRow}>
      <Text style={s.section} accessibilityRole="header">{title}</Text>
      {action}
    </View>
  );
}

// A Continue Learning item as card content: its own picture — a story cover,
// a Kingdom School module photo, or the Bible cover (shown whole) — or its icon.
function featured(item: ContinueItem): FeaturedLearning {
  const art = item.kind === "bible" ? { bundled: BIBLE_COVER, background: BIBLE_COVER_BG, ratio: 1 }
    : item.imagePath ? { path: item.imagePath } : { url: item.imageUrl ?? null };
  return { typeLabel: item.typeLabel, title: item.title, detail: item.detail, progress: item.progress, icon: item.icon, art };
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { paddingHorizontal: 16 },
    header: { gap: 4, paddingTop: 6 },
    eyebrow: { fontSize: 12, lineHeight: 16, color: c.amber, fontFamily: "Inter_700Bold", letterSpacing: 1.2, textTransform: "uppercase" },
    title: { fontSize: 28, lineHeight: 34, color: c.textDark, fontFamily: "Inter_700Bold", letterSpacing: -0.6 },
    subtitle: { fontSize: 14, lineHeight: 20, color: c.textMuted, fontFamily: "Inter_500Medium" },
    sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 30, marginBottom: 12, minHeight: 32 },
    section: { flex: 1, fontSize: 19, lineHeight: 25, color: c.textDark, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
    meta: { fontSize: 12.5, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    // The row runs to the screen edges so cards slide out of view naturally.
    rail: { marginHorizontal: -16 },
    railContent: { paddingHorizontal: 16 },
    empty: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 18, backgroundColor: c.card },
  });
}

// One tab's error stays in that tab (components/ScreenErrorBoundary.tsx).
export default withScreenBoundary(LearnTab, "tabs/learn");
