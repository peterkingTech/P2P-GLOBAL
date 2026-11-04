import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, ActivityIndicator, FlatList } from "react-native";
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
import { FeaturedLearningCard, CompactLearningCard, ProgressBar, ProgressStat, type FeaturedLearning } from "@/components/learning/LearningCards";
import { getDiscoverHome, type DiscoverHome } from "@/lib/kingdomStoriesApi";
import { getMyStudies, type MyStudies } from "@/lib/studyTogetherApi";
import { getLearningOverview, type LearningOverview } from "@/lib/learningCentreApi";
import { loadPosition, type ReadingPosition } from "@/lib/bibleReadingPrefs";
import { bookByCode } from "@/lib/bibleReaderApi";
import { continueItems, isStoryInProgress, type ContinueItem } from "@/lib/learningHome";
import { COMPREHENSIVE_CHECKS } from "@/lib/terminology";
import { loadCached, peekCached, qk } from "@/lib/query";
import { usePerfVisit } from "@/lib/perf";
import { AppButton } from "@/components/ui";
import { BIBLE_COVER, BIBLE_COVER_BG } from "@/constants/artwork";

// The Learning tab — the Learning Centre landing. One clean starting point:
//   a personal header (your name, what's under way);
//   Continue Learning — the most relevant unfinished activity (real progress
//     only: Kingdom School module, Kingdom Story, shared study, Bible chapter);
//   Explore Learning — Bible Study, Kingdom School, Kingdom Stories, Study Together;
//   Your Learning Journey — the existing Learning Centre data (My Learning).
// Kingdom School's full dashboard lives on its own screen (/kingdom-school);
// nothing is duplicated here. Each section loads on its own, so one slow or
// failed source never blocks the others. Everything comes from the shared
// cache first (instant on return), then refreshes: the stories home is the
// same cached copy Kingdom Stories uses, so the two never fetch it twice.

export default function LearnTab() {
  const insets = useSafeAreaInsets();
  const capsuleTopInset = useTabCapsuleTopInset(insets.top);
  const scrollRef = React.useRef<ScrollView>(null);
  useScrollToTopOnTabReselect("learn", scrollRef);
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth, isTablet, isLargeTablet } = useLayout();
  const { modules } = useData();
  const { profile } = useAuth();

  const [stories, setStories] = useState<DiscoverHome | null>(() => peekCached<DiscoverHome>(qk.storiesHome()) ?? null);
  const [studies, setStudies] = useState<MyStudies["active"] | null>(() => peekCached<MyStudies>(qk.myStudies())?.active ?? null);
  const [overview, setOverview] = useState<LearningOverview | null>(() => peekCached<LearningOverview>(qk.learningOverview()) ?? null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [bible, setBible] = useState<ReadingPosition | null>(null);
  const [loaded, setLoaded] = useState(() => ({ stories: !!stories, studies: !!studies }));

  const load = useCallback(() => {
    // Stories home: shared with Kingdom Stories (finishing a chapter marks it outdated).
    loadCached(qk.storiesHome(), () => getDiscoverHome(), { maxAgeMs: 30_000 }).then(setStories).catch(() => {}).finally(() => setLoaded((l) => ({ ...l, stories: true })));
    // Studies and Comprehensive Checks change elsewhere — shown from memory, always refreshed.
    loadCached(qk.myStudies(), () => getMyStudies(), { fresh: true }).then((r) => setStudies(r.active)).catch(() => setStudies((x) => x ?? [])).finally(() => setLoaded((l) => ({ ...l, studies: true })));
    loadCached(qk.learningOverview(), () => getLearningOverview(), { fresh: true }).then((o) => { setOverview(o); setOverviewFailed(false); }).catch(() => setOverviewFailed(true));
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
  const lessonsCompleted = modules.reduce((n, m) => n + m.completedLessons, 0);
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

  // Explore Learning: each experience's picture and "where you are", from the data above.
  const schoolPhoto = (modules.find((m) => !m.isLocked && m.lessonCount > 0 && m.completedLessons < m.lessonCount && m.imageUrl) ?? modules.find((m) => m.imageUrl))?.imageUrl ?? null;
  const storyPhoto = stories?.featured?.hero?.mediaPath ?? Object.values(storyCovers)[0] ?? null;
  const studyPhoto = (studies ?? []).map((x) => (x.contentType === "kingdom_story" && x.contentId ? storyCovers[x.contentId] : null)).find(Boolean) ?? null;
  const hub: LearningHubDetails = {
    bible: { status: bibleAt ? `Last read: ${bibleAt.bookName} ${bibleAt.chapter}` : null },
    school: { status: totalModules ? `${modulesCompleted} of ${totalModules} modules complete` : null, art: { url: schoolPhoto } },
    stories: { status: storiesUnderWay ? `${storiesUnderWay} ${storiesUnderWay === 1 ? "story" : "stories"} in progress` : null, art: { path: storyPhoto } },
    together: { status: studies?.length ? `${studies.length} active ${studies.length === 1 ? "study" : "studies"}` : null, art: { path: studyPhoto } },
  };

  const journey = overview ? [
    { key: "todo", label: "To do", n: overview.toDo.length, icon: "create-outline", highlight: true },
    { key: "review", label: "Awaiting review", n: overview.awaitingReview.length, icon: "hourglass-outline", highlight: false },
    { key: "feedback", label: "Feedback received", n: overview.feedback.length, icon: "chatbubble-ellipses-outline", highlight: true },
    { key: "toReview", label: "Waiting for your review", n: overview.toReview.length, icon: "people-outline", highlight: true },
  ] : [];

  return (
    <View style={[s.screen, { paddingTop: topPad }]}>
      <ScrollView ref={scrollRef} contentContainerStyle={[s.scroll, wide && { paddingHorizontal: isLargeTablet ? 32 : 24 }, { paddingBottom: insets.bottom + 100 }, centeredMaxWidth(contentMaxWidth)]} showsVerticalScrollIndicator={false}>
        {/* Header — personal, compact, so the learning content gets the space */}
        <View style={s.header}>
          <Text style={s.eyebrow}>Learning Centre</Text>
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
        <LearningHub colors={colors} details={hub} columns={wide ? 2 : 1} />

        {/* Your Learning Journey — the existing Learning Centre (My Learning) */}
        <SectionHeading s={s} title="Your Learning Journey"
          action={<AppButton label="My Learning" onPress={() => router.push("/learning" as any)} variant="tertiary" icon="chevron-forward" iconPosition="trailing" accessibilityLabel="Open My Learning" />} />
        <Pressable style={({ pressed }) => [s.journey, wide && { padding: 20 }, pressed && { opacity: 0.94 }]} onPress={() => router.push("/learning" as any)} accessibilityRole="button"
          accessibilityLabel={`My Learning. ${modulesCompleted} of ${totalModules} Kingdom School modules completed${overview ? `. ${journey.map((j) => `${j.n} ${j.label}`).join(", ")}` : ""}`}>
          {/* Kingdom School progress — from the modules already loaded */}
          <View style={s.journeyTop}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.journeyKicker}>Kingdom School</Text>
              <Text style={s.journeyFigure}>
                {modulesCompleted}<Text style={s.journeyOf}> of {totalModules} modules complete</Text>
              </Text>
            </View>
            <View style={s.lessonsBadge}>
              <Text style={s.lessonsN}>{lessonsCompleted}</Text>
              <Text style={s.lessonsLabel}>{lessonsCompleted === 1 ? "lesson" : "lessons"}{"\n"}completed</Text>
            </View>
          </View>
          {totalModules > 0 ? <ProgressBar value={modulesCompleted / totalModules} color={colors.progressFill} track={colors.progressTrack} height={6} /> : null}

          {/* Comprehensive Checks — the Learning Centre overview */}
          <Text style={[s.journeyKicker, { marginTop: 18 }]}>{COMPREHENSIVE_CHECKS}</Text>
          {overview ? (
            <View style={s.stats}>
              {journey.map((j) => <ProgressStat key={j.key} value={j.n} label={j.label} icon={j.icon} colors={colors} highlight={j.highlight} wide={wide} />)}
            </View>
          ) : overviewFailed ? <Text style={[s.meta, { marginTop: 6 }]}>Your {COMPREHENSIVE_CHECKS} couldn't load. Tap to open My Learning.</Text>
            : <ActivityIndicator color={colors.accentGreen} style={{ marginVertical: 12 }} />}
          <Text style={[s.meta, { marginTop: 12 }]}>From Kingdom School, Kingdom Stories, Family Circle and Church</Text>
        </Pressable>

        {/* My Evaluations — feedback on my checks, and serving others as an evaluator (Peer Evaluation Engine) */}
        <SectionHeading s={s} title="My Evaluations"
          action={<AppButton label="Open" onPress={() => router.push("/evaluation" as any)} variant="tertiary" icon="chevron-forward" iconPosition="trailing" accessibilityLabel="Open My Evaluations" />} />
        <Pressable style={({ pressed }) => [s.journey, wide && { padding: 20 }, pressed && { opacity: 0.94 }]} onPress={() => router.push("/evaluation" as any)} accessibilityRole="button"
          accessibilityLabel="My Evaluations: feedback on your checks, and serving others as an evaluator">
          <Text style={s.meta}>Follow each check from submission to feedback, discuss it with your evaluator, and — when you are ready — serve a fellow disciple as an evaluator.</Text>
        </Pressable>
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
    journey: { padding: 16, borderRadius: 20, backgroundColor: c.card },
    journeyTop: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginBottom: 10 },
    journeyKicker: { fontSize: 11, lineHeight: 15, color: c.amber, fontFamily: "Inter_700Bold", letterSpacing: 1, textTransform: "uppercase" },
    journeyFigure: { fontSize: 28, lineHeight: 34, color: c.textDark, fontFamily: "Inter_700Bold", letterSpacing: -0.6 },
    journeyOf: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_500Medium", letterSpacing: 0 },
    lessonsBadge: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.lightCream },
    lessonsN: { fontSize: 20, lineHeight: 24, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    lessonsLabel: { fontSize: 11, lineHeight: 14, color: c.textMuted, fontFamily: "Inter_500Medium" },
    stats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  });
}
