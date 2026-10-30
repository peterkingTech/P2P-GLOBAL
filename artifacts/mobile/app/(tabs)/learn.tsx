import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, FlatList, Image } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useScrollToTopOnTabReselect, useTabCapsuleTopInset } from "@/components/IPadTabCapsule";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";
import { useData, getModuleProgressCounts } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import LearningHub from "@/components/LearningHub";
import { CoverArt } from "@/components/kingdom-stories/DiscoverRow";
import { getDiscoverHome, type DiscoverHome } from "@/lib/kingdomStoriesApi";
import { getMyStudies, type StudyCard } from "@/lib/studyTogetherApi";
import { getLearningOverview, type LearningOverview } from "@/lib/learningCentreApi";
import { loadPosition, type ReadingPosition } from "@/lib/bibleReadingPrefs";
import { bookByCode } from "@/lib/bibleReaderApi";
import { continueItems, type ContinueItem } from "@/lib/learningHome";
import { COMPREHENSIVE_CHECKS } from "@/lib/terminology";
import { AppButton } from "@/components/ui";
import { BIBLE_COVER, BIBLE_COVER_BG } from "@/constants/artwork";

// The Learning tab — the Learning Centre landing. One clean starting point:
//   Continue Learning — the most relevant unfinished activity (real progress
//     only: Kingdom School module, Kingdom Story, shared study, Bible chapter);
//   Explore Learning — Kingdom School, Kingdom Stories, Bible Study, Study Together;
//   Your Learning Journey — the existing Learning Centre data (My Learning).
// Kingdom School's full dashboard lives on its own screen (/kingdom-school);
// nothing is duplicated here. Each section loads on its own, so one slow or
// failed source never blocks the others.

export default function LearnTab() {
  const insets = useSafeAreaInsets();
  const capsuleTopInset = useTabCapsuleTopInset(insets.top);
  const scrollRef = React.useRef<ScrollView>(null);
  useScrollToTopOnTabReselect("learn", scrollRef);
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useLayout();
  const { modules } = useData();

  const [stories, setStories] = useState<DiscoverHome | null>(null);
  const [studies, setStudies] = useState<StudyCard[] | null>(null);
  const [overview, setOverview] = useState<LearningOverview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [bible, setBible] = useState<ReadingPosition | null>(null);
  const [loaded, setLoaded] = useState({ stories: false, studies: false });

  const load = useCallback(() => {
    getDiscoverHome().then(setStories).catch(() => {}).finally(() => setLoaded((l) => ({ ...l, stories: true })));
    getMyStudies().then((r) => setStudies(r.active)).catch(() => setStudies([])).finally(() => setLoaded((l) => ({ ...l, studies: true })));
    getLearningOverview().then((o) => { setOverview(o); setOverviewFailed(false); }).catch(() => setOverviewFailed(true));
    loadPosition().then(setBible).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

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
  const items: ContinueItem[] = useMemo(() => continueItems({
    modules,
    stories: stories?.continueLearning ?? [],
    studies: (studies ?? []).slice(0, 3),
    bible: bible ? { book: bible.book, bookName: bookByCode(bible.book)?.name ?? bible.book, chapter: bible.chapter, translation: bible.translation } : null,
    storyCovers,
  }), [modules, stories, studies, bible, storyCovers]);
  const [lead, ...more] = items;
  const { modulesCompleted } = getModuleProgressCounts(modules);
  const go = (r: ContinueItem["route"]) => router.push(r as any);
  const topPad = insets.top + capsuleTopInset + (Platform.OS === "web" ? 67 : 0);
  const journey = overview ? [
    { key: "todo", label: "To do", n: overview.toDo.length, icon: "create-outline" },
    { key: "review", label: "Awaiting review", n: overview.awaitingReview.length, icon: "hourglass-outline" },
    { key: "feedback", label: "Feedback", n: overview.feedback.length, icon: "chatbubble-ellipses-outline" },
    { key: "toReview", label: "To review", n: overview.toReview.length, icon: "people-outline" },
  ] : [];

  return (
    <View style={[s.screen, { paddingTop: topPad }]}>
      <ScrollView ref={scrollRef} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }, centeredMaxWidth(contentMaxWidth)]} showsVerticalScrollIndicator={false}>
        {/* Header — compact, so the learning content gets the space */}
        <Text style={s.title} accessibilityRole="header">Learning Centre</Text>
        <Text style={s.subtitle}>Grow in Scripture, understanding and discipleship.</Text>

        {/* Continue Learning */}
        <Text style={s.section} accessibilityRole="header">Continue Learning</Text>
        {lead ? (
          <TouchableOpacity style={s.lead} onPress={() => go(lead.route)} activeOpacity={0.88} accessibilityRole="button"
            accessibilityLabel={`Continue ${lead.typeLabel}: ${lead.title}${lead.detail ? `. ${lead.detail}` : ""}`}>
            <ContinueArt item={lead} size={34} color={colors.accentGreen} frame={s.leadArt} defaultRatio={2 / 3} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.kicker}>{lead.typeLabel}</Text>
              <Text style={s.leadTitle} numberOfLines={2}>{lead.title}</Text>
              {lead.detail ? <Text style={s.meta} numberOfLines={2}>{lead.detail}</Text> : null}
              {lead.progress !== null ? <View style={s.track}><View style={[s.fill, { width: `${Math.max(3, Math.round(lead.progress * 100))}%` }]} /></View> : null}
              <View style={s.continueBtn}><Text style={s.continueText}>Continue</Text><Ionicons name="arrow-forward" size={14} color="#fff" /></View>
            </View>
          </TouchableOpacity>
        ) : !loaded.stories || !loaded.studies ? <ActivityIndicator color={colors.accentGreen} style={{ marginVertical: 20 }} accessibilityLabel="Loading your learning" />
          : (
            <View style={s.empty}>
              <Text style={s.meta}>Nothing in progress yet. Choose where to begin below — Kingdom School's Foundations or the first Kingdom Story are good places to start.</Text>
            </View>
          )}
        {more.length > 0 && (
          <FlatList horizontal data={more} keyExtractor={(x) => x.key} showsHorizontalScrollIndicator={Platform.OS === "web"} contentContainerStyle={{ gap: 10, paddingTop: 10 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.mini} onPress={() => go(item.route)} accessibilityRole="button" accessibilityLabel={`Continue ${item.typeLabel}: ${item.title}`}>
                {item.imagePath || item.imageUrl || item.kind === "bible"
                  ? <ContinueArt item={item} size={18} color={colors.accentGreen} frame={s.miniArt} defaultRatio={16 / 9} />
                  : <Ionicons name={item.icon as any} size={18} color={colors.accentGreen} />}
                <Text style={s.kicker} numberOfLines={1}>{item.typeLabel}</Text>
                <Text style={s.miniTitle} numberOfLines={2}>{item.title}</Text>
                {item.detail ? <Text style={s.meta} numberOfLines={1}>{item.detail}</Text> : null}
              </TouchableOpacity>
            )} />
        )}

        {/* Explore Learning */}
        <Text style={s.section} accessibilityRole="header">Explore Learning</Text>
        <LearningHub colors={colors} />

        {/* Your Learning Journey — the existing Learning Centre (My Learning) */}
        <View style={s.sectionRow}>
          <Text style={[s.section, { marginTop: 0, marginBottom: 0, flex: 1 }]} accessibilityRole="header">Your Learning Journey</Text>
          <AppButton label="My Learning" onPress={() => router.push("/learning" as any)} variant="tertiary" icon="chevron-forward" iconPosition="trailing" accessibilityLabel="Open My Learning" />
        </View>
        <TouchableOpacity style={s.journey} onPress={() => router.push("/learning" as any)} activeOpacity={0.85} accessibilityRole="button"
          accessibilityLabel={overview ? `My Learning. ${journey.map((j) => `${j.n} ${j.label}`).join(", ")}. ${modulesCompleted} Kingdom School modules completed` : "My Learning"}>
          {overview ? (
            <View style={s.journeyGrid}>
              {journey.map((j) => (
                <View key={j.key} style={s.stat}>
                  <Ionicons name={j.icon as any} size={16} color={j.n ? colors.accentGreen : colors.textMuted} />
                  <Text style={s.statN}>{j.n}</Text>
                  <Text style={s.statLabel} numberOfLines={1}>{j.label}</Text>
                </View>
              ))}
            </View>
          ) : overviewFailed ? <Text style={s.meta}>Your {COMPREHENSIVE_CHECKS} couldn't load. Tap to open My Learning.</Text>
            : <ActivityIndicator color={colors.accentGreen} />}
          <Text style={[s.meta, { marginTop: 8 }]}>{COMPREHENSIVE_CHECKS} from Kingdom School, Kingdom Stories, Family Circle and Church · {modulesCompleted} Kingdom School {modulesCompleted === 1 ? "module" : "modules"} completed</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

// The photo for a Continue Learning item: a story cover (signed media path),
// a Kingdom School module photo (plain URL), or the item's icon when there is
// no photo or it fails to load. Never cropped: the frame takes the photo's
// own shape once it loads, so the whole picture — faces and characters —
// shows, with no blur and no empty bands.
function ContinueArt({ item, size, color, frame, defaultRatio }: { item: ContinueItem; size: number; color: string; frame: object; defaultRatio: number }) {
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    setRatio(null);
    if (!item.imagePath && item.imageUrl) Image.getSize(item.imageUrl, (w, h) => { if (w && h) setRatio(w / h); }, () => {});
  }, [item.imagePath, item.imageUrl]);
  // The Bible item shows the Bible cover (square artwork, shown whole).
  const isBible = item.kind === "bible";
  const r = isBible ? 1 : Math.min(2, Math.max(0.5, ratio ?? defaultRatio));
  // A fixed-width frame (the large card) widens for wide photos so they
  // aren't shrunk to a sliver; the small cards' frames are already full width.
  const widen = (frame as { width?: number }).width && r > 1 ? { width: 150 } : null;
  let art: React.ReactNode = <Ionicons name={item.icon as any} size={size} color={color} />;
  if (isBible) art = <Image source={BIBLE_COVER} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no" />;
  else if (item.imagePath) art = <CoverArt path={item.imagePath} fit="whole" onRatio={setRatio} />;
  else if (item.imageUrl && !failed) {
    art = <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="contain" onError={() => setFailed(true)}
      accessibilityElementsHidden importantForAccessibility="no" />;
  }
  return <View style={[frame, { aspectRatio: r }, widen, isBible ? { backgroundColor: BIBLE_COVER_BG } : null]}>{art}</View>;
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { paddingHorizontal: 16 },
    title: { fontSize: 26, lineHeight: 32, color: c.textDark, fontFamily: "Inter_700Bold" },
    subtitle: { fontSize: 13, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    section: { fontSize: 17, lineHeight: 23, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 26, marginBottom: 10 },
    sectionRow: { flexDirection: "row", alignItems: "center", marginTop: 26, marginBottom: 10 },
    seeAll: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44, paddingHorizontal: 4 },
    seeAllText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    lead: { flexDirection: "row", gap: 14, padding: 12, borderRadius: 18, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center" },
    leadArt: { width: 96, aspectRatio: 2 / 3, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: c.cardBeige },
    kicker: { fontSize: 11, lineHeight: 15, color: c.amber, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase" },
    leadTitle: { fontSize: 18, lineHeight: 23, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    track: { height: 5, borderRadius: 3, overflow: "hidden", backgroundColor: c.progressTrack, marginTop: 4 },
    fill: { height: 5, backgroundColor: c.progressFill },
    continueBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 10, backgroundColor: c.primaryGreen },
    continueText: { fontSize: 13, color: "#fff", fontFamily: "Inter_700Bold" },
    mini: { width: 168, padding: 12, gap: 4, borderRadius: 14, overflow: "hidden", backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    miniArt: { marginHorizontal: -12, marginTop: -12, marginBottom: 6, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: c.cardBeige },
    miniTitle: { fontSize: 14, lineHeight: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    empty: { padding: 14, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    journey: { padding: 14, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    journeyGrid: { flexDirection: "row", gap: 8 },
    stat: { flex: 1, alignItems: "center", gap: 2 },
    statN: { fontSize: 20, lineHeight: 25, color: c.textDark, fontFamily: "Inter_700Bold" },
    statLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium" },
  });
}
