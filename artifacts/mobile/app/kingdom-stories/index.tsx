import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, TextInput, useWindowDimensions, RefreshControl, FlatList, Platform, AccessibilityInfo, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type as TT, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import { ART_TEXT, useStoryStyles, type StoryPalette } from "@/lib/storyTheme";
import {
  getDiscoverHome, getCatalogueCategories, searchKingdomStories, saveStory, unsaveStory, formatTopicNumber, categoryCountLabels,
  type DiscoverHome, type CatalogueCategory, type KingdomStory, type StoryCard, type HeroSource,
} from "@/lib/kingdomStoriesApi";
import { CoverArt, DiscoverRow, StoryPosterCard, progressOf, storyAction } from "@/components/kingdom-stories/DiscoverRow";
import { AppButton, IconButton } from "@/components/ui";
import { useFullScreenPhotoHeight } from "@/hooks/useLayout";
import StudyTogetherLink from "@/components/learning/StudyTogetherLink";

// Kingdom Stories — a learning library with a cinematic browse, in the
// reader's light/dark theme. Everything shown is real:
//   • the hero: an editor's Featured story, else the reader's next story in
//     the biblical order, else the first story in that order (API decides);
//     a manually swipeable set of slides (other Featured stories, the next
//     journey story, stories being read) with dots that say which is shown.
//     It never turns by itself, so it can't move under a reader, a screen
//     reader's focus, or someone who prefers reduced motion;
//   • Continue Your Stories — stories with real progress, most recent first;
//   • Continue the Biblical Story — the next story in the editors' order and
//     what follows it (each category keeps its own order);
//   • Recommended — each with the reason it is suggested;
//   • collections, a row per category in topic order, the reader's shelves,
//     Recently added, and the category grid (published and planned counts
//     kept separate).
// No popularity is invented. Opening a story never counts as progress; the
// buttons say Start / Continue / Review from the storybook's own progress.
// Chapters, reflections and Comprehensive Checks stay in the existing reader.

const HERO_KICKER: Record<HeroSource, string> = { featured: "Featured", journey: "Next in your biblical journey", first: "Start here", continue: "Continue your story" };

export default function KingdomStoriesDiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { T, s: styles } = useStoryStyles(makeStyles);
  const [home, setHome] = useState<DiscoverHome | null>(null);
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KingdomStory[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  const [slide, setSlide] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const slidesRef = useRef<FlatList>(null);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {}); }, []);
  const searchSeq = useRef(0);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const [h, cats] = await Promise.all([getDiscoverHome(), getCatalogueCategories().then((r) => r.categories).catch(() => [] as CatalogueCategory[])]);
      setHome(h); setCategories(cats); setFailed(false); loaded.current = true;
      const all = [...(h.heroSlides ?? []), ...(h.hero ? [h.hero] : []), ...(h.featured ? [h.featured] : [])];
      setFavs(Object.fromEntries(all.map((x) => [x.id, !!x.mine?.favourite])));
    } catch { if (!loaded.current) setFailed(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Search published stories (debounced; the latest query wins).
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { searchSeq.current++; setResults(null); setSearching(false); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(() => {
      searchKingdomStories(term).then((r) => { if (seq === searchSeq.current) setResults(r.stories); })
        .catch(() => { if (seq === searchSeq.current) setResults([]); })
        .finally(() => { if (seq === searchSeq.current) setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const open = (s: { id: string }) => router.push(`/kingdom-stories/${s.id}` as any);
  const startOrContinue = (s: { id: string }) => router.push({ pathname: "/kingdom-stories/[id]", params: { id: s.id, open: "next" } } as any);

  // Older API (no `heroSlides` / `hero`): the editor's Featured story, as before.
  const one = home ? (home.hero ?? (home.featured ? { ...home.featured, source: "featured" as const } : null)) : null;
  const slides = home?.heroSlides?.length ? home.heroSlides : one ? [one] : [];
  const hero = slides[Math.min(slide, slides.length - 1)] ?? null;
  const heroFav = hero ? !!favs[hero.id] : false;
  async function toggleHeroFavourite() {
    if (!hero) return;
    const id = hero.id, on = !favs[id];
    setFavs((f) => ({ ...f, [id]: on }));
    try { await (on ? saveStory(id, "favourite") : unsaveStory(id, "favourite")); } catch { setFavs((f) => ({ ...f, [id]: !on })); }
  }
  const onSlideEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setSlide(Math.max(0, Math.min(slides.length - 1, Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))));
  const goToSlide = (i: number) => { setSlide(i); slidesRef.current?.scrollToIndex({ index: i, animated: !reduceMotion }); };

  const hProg = hero ? progressOf(hero) : null;
  const hAction = hero ? storyAction(hero) : null;
  const journey = home?.journey ?? null;
  const catInfo = new Map(categories.map((c) => [c.id, c]));
  // The Featured image fills the device screen (owner decision 2026-10-30): full width and height,
  // cropped to fit. The title and buttons sit below it.
  const heroH = useFullScreenPhotoHeight();
  const barIcon = hero ? ART_TEXT.text : T.textPrimary;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.textSecondary} />}>
        {/* Hero artwork (or a calm title band when there is no story yet) */}
        <View style={{ height: hero ? heroH : insets.top + 120 }}>
          {slides.length ? (
            <FlatList ref={slidesRef} data={slides} keyExtractor={(x) => x.id} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onSlideEnd} onScrollEndDrag={Platform.OS === "web" ? onSlideEnd : undefined}
              getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })} initialNumToRender={1} windowSize={3}
              accessibilityLabel={`Featured stories, ${slides.length} ${slides.length === 1 ? "slide" : "slides"}. Swipe to see more`}
              renderItem={({ item }) => (
                <TouchableOpacity activeOpacity={0.95} onPress={() => open(item)} style={{ width, height: heroH }} accessibilityRole="button" accessibilityLabel={`${item.title}. Open story details`}>
                  <CoverArt fit="cover" path={item.hero?.mediaPath ?? item.media?.[0]?.mediaPath} alt={item.hero?.altText ?? item.media?.[0]?.altText ?? null} />
                </TouchableOpacity>
              )} />
          ) : null}
          {hero ? <LinearGradient colors={["rgba(0,0,0,0.6)", "rgba(0,0,0,0)"]} locations={[0, 0.45]} style={StyleSheet.absoluteFill} pointerEvents="none" /> : null}
          <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity hitSlop={10} onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/learn" as any))} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={22} color={barIcon} />
            </TouchableOpacity>
            <Text style={[styles.brand, { color: barIcon }]} accessibilityRole="header">Kingdom Stories</Text>
            <TouchableOpacity hitSlop={10} onPress={() => router.push("/kingdom-stories/library" as any)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="My library">
              <Ionicons name="library-outline" size={22} color={barIcon} />
            </TouchableOpacity>
          </View>
          {!hero ? <Text style={[styles.heroSub, { paddingHorizontal: 16, marginTop: 8 }]}>Discover the story of God's work throughout history.</Text> : null}
        </View>
        {slides.length > 1 ? (
          <View style={styles.dots}>
            {slides.map((x, i) => (
              <TouchableOpacity key={x.id} onPress={() => goToSlide(i)} style={styles.dotHit} accessibilityRole="button"
                accessibilityState={{ selected: i === slide }} accessibilityLabel={`Slide ${i + 1} of ${slides.length}: ${x.title}`}>
                <View style={[styles.dot, i === slide && styles.dotOn]} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {hero && hAction ? (
          <View style={styles.heroText}>
            <Text style={styles.heroKicker}>{[HERO_KICKER[hero.source], formatTopicNumber(hero.topicNumber), hero.category?.title].filter(Boolean).join(" · ")}</Text>
            <Text style={styles.heroTitle}>{hero.title}</Text>
            {hero.subtitle ? <Text style={styles.heroSub} numberOfLines={3}>{hero.subtitle}</Text> : null}
            {hProg ? (
              <View style={styles.heroProgress} accessible accessibilityLabel={`Your progress: ${hProg.label}`}>
                <View style={styles.heroTrack}><View style={[styles.heroFill, { width: `${Math.max(4, Math.round(hProg.fraction * 100))}%` }]} /></View>
                <Text style={styles.heroProgressText}>{hProg.label}</Text>
              </View>
            ) : null}
            <View style={styles.heroActions}>
              <AppButton label={hAction.label} onPress={() => startOrContinue(hero)} size="lg" icon={hAction.icon} accessibilityLabel={`${hAction.label}: ${hero.title}${hProg ? `. ${hProg.label}` : ""}`} />
              <AppButton label="View Story Details" onPress={() => open(hero)} variant="secondary" size="lg" icon="information-circle-outline" accessibilityLabel={`View story details: ${hero.title}`} />
              <IconButton icon="heart-outline" selectedIcon="heart" selected={heroFav} variant="tinted" onPress={toggleHeroFavourite}
                color={heroFav ? "#E11D48" : undefined} accessibilityLabel={heroFav ? "Remove from My Favourites" : "Add to My Favourites"} />
            </View>
          </View>
        ) : null}

        <View style={styles.searchWrap}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={T.textTertiary} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search stories, people, categories" placeholderTextColor={T.textFaint}
              style={styles.searchInput} returnKeyType="search" accessibilityLabel="Search published stories" autoCorrect={false} />
            {!!query && (
              <TouchableOpacity onPress={() => setQuery("")} accessibilityLabel="Clear search" accessibilityRole="button" hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={T.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <StudyTogetherLink note="Kingdom Stories you read with others" style={{ marginHorizontal: 16, marginBottom: 8 }} />

        {loading ? <ActivityIndicator color={T.growth} style={{ marginTop: 40 }} accessibilityLabel="Loading Kingdom Stories" />
          : failed ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={30} color={T.textTertiary} />
              <Text style={styles.emptyText}>Kingdom Stories couldn't load. Check your connection.</Text>
              <AppButton label="Try again" onPress={() => { setLoading(true); load(); }} variant="tertiary" />
            </View>
          ) : results !== null || searching ? (
            <View style={styles.resultsGrid}>
              {searching && !results ? <ActivityIndicator color={T.growth} style={{ marginTop: 20 }} />
                : (results ?? []).length === 0 ? <Text style={styles.emptyText}>No published stories match “{query.trim()}”.</Text>
                : (results ?? []).map((x) => <StoryPosterCard key={x.id} story={x as StoryCard} width={Math.min(160, (width - 52) / 3)} onPress={() => open(x)} />)}
            </View>
          ) : home ? (
            <>
              {/* Continue Your Stories — real progress only */}
              <DiscoverRow title="Continue Your Stories" stories={home.continueLearning} wide onOpen={startOrContinue}
                onSeeAll={() => router.push({ pathname: "/kingdom-stories/library", params: { shelf: "in_progress" } } as any)} />
              {!home.continueLearning.length && journey?.state === "start" ? (
                <TouchableOpacity style={styles.startHere} onPress={() => startOrContinue(journey.story)} accessibilityRole="button"
                  accessibilityLabel={`You haven't started a story yet. Begin with ${journey.story.title}`}>
                  <Ionicons name="sparkles-outline" size={18} color={T.light} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.startHereTitle}>Begin at the beginning</Text>
                    <Text style={styles.startHereText}>You haven't started a story yet. Start with “{journey.story.title}” — the first story in the biblical order. Your progress will appear here.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={T.textTertiary} />
                </TouchableOpacity>
              ) : null}

              {/* Continue the Biblical Story — the editors' order, never sorted by date or title */}
              {journey ? (
                <View style={styles.journey}>
                  <Text style={styles.sectionKicker}>{journey.state === "continue" ? "Continue the biblical story" : "Next in your biblical journey"}</Text>
                  {hero?.id !== journey.story.id ? (
                    <TouchableOpacity style={styles.journeyCard} onPress={() => startOrContinue(journey.story)} activeOpacity={0.88} accessibilityRole="button"
                      accessibilityLabel={`${storyAction(journey.story).label}: ${journey.story.title}. ${journey.category?.title ?? ""}, story ${journey.position} of ${journey.categoryTotal}`}>
                      <View style={styles.journeyArt}><CoverArt path={journey.story.media?.[0]?.mediaPath} /></View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={styles.journeyTitle} numberOfLines={2}>{journey.story.title}</Text>
                        <Text style={styles.journeyMeta}>{[journey.category?.title, `Story ${journey.position} of ${journey.categoryTotal}`].filter(Boolean).join(" · ")}</Text>
                        <View style={styles.journeyBtn}><Ionicons name={storyAction(journey.story).icon} size={14} color={T.growth} /><Text style={styles.journeyBtnText}>{storyAction(journey.story).label}</Text></View>
                      </View>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.journeyMeta}>{[journey.category?.title, `Story ${journey.position} of ${journey.categoryTotal}`].filter(Boolean).join(" · ")} — shown above</Text>
                  )}
                </View>
              ) : null}
              <DiscoverRow title={journey?.category ? `Coming up in ${journey.category.title}` : "Coming up"} subtitle="In biblical order" stories={journey?.upNext ?? []} onOpen={open}
                onSeeAll={journey?.category ? () => { const c = catInfo.get(journey.category!.id); if (c) router.push(`/kingdom-stories/category/${c.slug}` as any); } : undefined} />

              <DiscoverRow title="Recommended for You" stories={(home.recommended ?? []).filter((x) => x.id !== journey?.story.id)} onOpen={open} />

              {home.collections.map((col) => (
                <DiscoverRow key={col.id} title={col.title} subtitle={col.description} stories={col.stories}
                  onOpen={open} onSeeAll={col.total > col.stories.length || col.total > 4 ? () => router.push(`/kingdom-stories/collection/${col.slug}` as any) : undefined} />
              ))}
              {home.categoryRows.map((r) => (
                <DiscoverRow key={r.category.id} title={r.category.title}
                  subtitle={catInfo.get(r.category.id)?.description ?? `${r.total} ${r.total === 1 ? "story" : "stories"}`} stories={r.stories} onOpen={open}
                  onSeeAll={() => router.push(`/kingdom-stories/category/${r.category.slug}` as any)} />
              ))}
              <DiscoverRow title="My Favourites" stories={home.favourites} onOpen={open} onSeeAll={() => router.push({ pathname: "/kingdom-stories/library", params: { shelf: "favourites" } } as any)} />
              <DiscoverRow title="Saved for Later" stories={home.later} onOpen={open} onSeeAll={() => router.push({ pathname: "/kingdom-stories/library", params: { shelf: "later" } } as any)} />
              <DiscoverRow title="Recently Added" stories={home.recentlyAdded} onOpen={open} onSeeAll={() => router.push({ pathname: "/kingdom-stories/all", params: { sort: "recent" } } as any)} />
              <DiscoverRow title="Recently Viewed" stories={home.recentlyViewed} onOpen={open} onSeeAll={() => router.push({ pathname: "/kingdom-stories/library", params: { shelf: "recent" } } as any)} />

              {home.totalPublished === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="book-outline" size={30} color={T.textTertiary} />
                  <Text style={styles.emptyText}>Kingdom Stories will appear here as new stories are published.</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.browseAll} onPress={() => router.push("/kingdom-stories/all" as any)} accessibilityRole="button" accessibilityLabel={`Browse all ${home.totalPublished} stories`}>
                  <Ionicons name="grid-outline" size={18} color={T.textPrimary} />
                  <Text style={styles.browseAllText}>Browse all {home.totalPublished} stories</Text>
                  <Ionicons name="chevron-forward" size={16} color={T.textTertiary} />
                </TouchableOpacity>
              )}

              {categories.length > 0 && (
                <View style={{ marginTop: 26, paddingHorizontal: 16, gap: 10 }}>
                  <Text style={styles.sectionTitle} accessibilityRole="header">Browse by category</Text>
                  <View style={styles.grid}>
                    {categories.map((cat) => {
                      const counts = categoryCountLabels(cat);
                      return (
                        <TouchableOpacity key={cat.id} style={styles.catCard} onPress={() => router.push(`/kingdom-stories/category/${cat.slug}` as any)} activeOpacity={0.85}
                          accessibilityRole="button" accessibilityLabel={`${cat.title}. ${counts.published}${counts.planned ? `, ${counts.planned}` : ""}`}>
                          <Ionicons name={(cat.icon ?? "book-outline") as any} size={18} color={T.growth} />
                          <Text style={styles.catTitle} numberOfLines={3}>{cat.title}</Text>
                          <Text style={[styles.catCount, cat.publishedStories > 0 && { color: T.growth }]}>{counts.published}</Text>
                          {!!counts.planned && <Text style={styles.catPlanned}>{counts.planned}</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </>
          ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(T: StoryPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: T.background },
    topBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
    iconBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
    brand: { flex: 1, textAlign: "center", fontSize: 15, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
    dots: { flexDirection: "row", justifyContent: "center", marginTop: 6 },
    dotHit: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.border },
    dotOn: { width: 20, backgroundColor: T.growth },
    heroText: { paddingHorizontal: 16, paddingTop: 14, gap: 6, width: "100%" },
    heroKicker: { color: T.light, ...TT.label, textTransform: "uppercase" },
    heroTitle: { color: T.textPrimary, fontSize: 30, lineHeight: 36, fontFamily: "Inter_700Bold" },
    heroSub: { color: T.textSecondary, ...TT.body },
    heroProgress: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
    heroTrack: { flex: 1, maxWidth: 220, height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: T.border },
    heroFill: { height: 4, backgroundColor: T.growth },
    heroProgressText: { color: T.textSecondary, ...TT.caption },
    heroActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" },
    searchWrap: { paddingHorizontal: 16, marginTop: 14 },
    searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: T.surfaceRaised, borderRadius: 12, paddingHorizontal: 12, minHeight: MIN_TOUCH_TARGET, borderWidth: 1, borderColor: T.borderFaint },
    searchInput: { flex: 1, color: T.textPrimary, ...TT.body, paddingVertical: 10 },
    resultsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 16, marginTop: 16 },
    startHere: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 22, padding: 14, borderRadius: 14, backgroundColor: T.lightSoft, minHeight: MIN_TOUCH_TARGET },
    startHereTitle: { color: T.textPrimary, ...TT.bodyEmph },
    startHereText: { color: T.textSecondary, ...TT.caption },
    journey: { marginTop: 24, marginHorizontal: 16, gap: 8 },
    sectionKicker: { color: T.light, ...TT.label, textTransform: "uppercase" },
    journeyCard: { flexDirection: "row", gap: 12, padding: 10, borderRadius: 14, backgroundColor: T.surfaceRaised, borderWidth: 1, borderColor: T.borderFaint, alignItems: "center" },
    journeyArt: { width: 96, aspectRatio: 2 / 3, borderRadius: 10, overflow: "hidden" },
    journeyTitle: { color: T.textPrimary, ...TT.title, fontSize: 16 },
    journeyMeta: { color: T.textTertiary, ...TT.caption },
    journeyBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, alignSelf: "flex-start", minHeight: 32, paddingHorizontal: 10, borderRadius: 8, backgroundColor: T.growthSoft },
    journeyBtnText: { color: T.growth, ...TT.bodyEmph, fontSize: 13 },
    browseAll: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 26, paddingHorizontal: 14, minHeight: 52, borderRadius: 12, backgroundColor: T.surfaceRaised },
    browseAllText: { flex: 1, color: T.textPrimary, ...TT.bodyEmph },
    sectionTitle: { color: T.textPrimary, ...TT.display },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    catCard: { flexBasis: "47%", flexGrow: 1, minHeight: 104, backgroundColor: T.surface, borderWidth: 1, borderColor: T.borderFaint, borderRadius: 14, padding: 12, gap: 6, justifyContent: "space-between" },
    catTitle: { color: T.textPrimary, fontSize: 13, lineHeight: 17, fontFamily: "Inter_700Bold" },
    catCount: { color: T.textTertiary, fontSize: 11, fontFamily: "Inter_600SemiBold" },
    catPlanned: { color: T.textFaint, fontSize: 11, fontFamily: "Inter_400Regular" },
    empty: { alignItems: "center", gap: 10, paddingVertical: 50, paddingHorizontal: 40 },
    emptyText: { color: T.textTertiary, ...TT.caption, textAlign: "center", marginTop: 8 },
    retry: { minHeight: MIN_TOUCH_TARGET, justifyContent: "center", paddingHorizontal: 16 },
    retryText: { color: T.growth, ...TT.bodyEmph },
  });
}
