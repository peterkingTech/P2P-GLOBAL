import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, TextInput, useWindowDimensions, RefreshControl } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors as T, type as TT, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import {
  getDiscoverHome, getCatalogueCategories, searchKingdomStories, saveStory, unsaveStory, formatTopicNumber, categoryCountLabels,
  type DiscoverHome, type CatalogueCategory, type KingdomStory, type StoryCard,
} from "@/lib/kingdomStoriesApi";
import { CoverArt, DiscoverRow, StoryPosterCard, progressOf } from "@/components/kingdom-stories/DiscoverRow";

// Kingdom Stories discovery — a learning library with a cinematic browse
// (reached from Discover). Everything shown is real: an editor's Featured
// story, the reader's own Continue Learning / Favourites / Saved / Recently
// viewed, published editorial collections, a row per category in topic order,
// and Recently added. No popularity or recommendations are invented. Search
// covers published stories only; categories show published and planned
// counts separately, as before.

export default function KingdomStoriesDiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [home, setHome] = useState<DiscoverHome | null>(null);
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KingdomStory[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [heroFav, setHeroFav] = useState(false);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      const [h, cats] = await Promise.all([getDiscoverHome(), getCatalogueCategories().then((r) => r.categories).catch(() => [] as CatalogueCategory[])]);
      setHome(h); setCategories(cats); setFailed(false);
      setHeroFav(!!h.featured?.mine?.favourite);
    } catch { if (!home) setFailed(true); }
    finally { setLoading(false); setRefreshing(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  async function toggleHeroFavourite() {
    const f = home?.featured;
    if (!f) return;
    const on = !heroFav;
    setHeroFav(on);
    try { await (on ? saveStory(f.id, "favourite") : unsaveStory(f.id, "favourite")); } catch { setHeroFav(!on); }
  }

  const f = home?.featured ?? null;
  const fProg = f ? progressOf(f) : null;
  // The Featured image is shown WHOLE (its own 16:9 shape, capped on wide screens with the sides softly
  // filled) so the corner credit — “P2P Global | Creative Studios” — is never cropped or covered;
  // the title and buttons sit below it.
  const heroH = Math.max(insets.top + 120, Math.min(560, Math.round(width * 9 / 16)));
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.textSecondary} />}>
        {/* Hero: the Featured story (or a calm title band when none is featured) */}
        <View style={{ height: f ? heroH : insets.top + 120 }}>
          {f ? <CoverArt path={f.hero?.mediaPath ?? f.media?.[0]?.mediaPath} alt={f.hero?.altText ?? f.media?.[0]?.altText ?? null} /> : null}
          <LinearGradient colors={["rgba(11,18,14,0.6)", "rgba(11,18,14,0)"]} locations={[0, 0.45]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={22} color={T.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.brand}>Kingdom Stories</Text>
            <TouchableOpacity onPress={() => router.push("/kingdom-stories/library" as any)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="My library">
              <Ionicons name="library-outline" size={22} color={T.textPrimary} />
            </TouchableOpacity>
          </View>
          {!f ? (
            <Text style={[styles.heroSub, { paddingHorizontal: 16, marginTop: 8 }]}>Stories of faith, mission, sacrifice, revival, and the work of God across generations.</Text>
          ) : null}
        </View>
        {f ? (
            <View style={styles.heroText}>
              <Text style={styles.heroKicker}>{["Featured", formatTopicNumber(f.topicNumber), f.category?.title].filter(Boolean).join(" · ")}</Text>
              <Text style={styles.heroTitle} accessibilityRole="header">{f.title}</Text>
              {f.subtitle ? <Text style={styles.heroSub} numberOfLines={3}>{f.subtitle}</Text> : null}
              <View style={styles.heroActions}>
                <TouchableOpacity style={styles.playBtn} onPress={() => startOrContinue(f)} accessibilityRole="button"
                  accessibilityLabel={fProg && fProg.fraction < 1 ? `Continue story. ${fProg.label}` : "Start story"}>
                  <Ionicons name="book" size={18} color={T.onLight} />
                  <Text style={styles.playText}>{fProg && fProg.fraction < 1 ? "Continue Story" : fProg?.fraction === 1 ? "Read Again" : "Start Story"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => open(f)} accessibilityRole="button" accessibilityLabel="View chapters">
                  <Ionicons name="list" size={18} color={T.textPrimary} /><Text style={styles.ghostText}>View Chapters</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.roundBtn} onPress={toggleHeroFavourite} accessibilityRole="button" accessibilityState={{ selected: heroFav }}
                  accessibilityLabel={heroFav ? "Remove from My Favourites" : "Add to My Favourites"}>
                  <Ionicons name={heroFav ? "heart" : "heart-outline"} size={20} color={heroFav ? "#FB7185" : T.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>
        ) : null}

        <View style={styles.searchWrap}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={T.textTertiary} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search published stories" placeholderTextColor={T.textFaint}
              style={styles.searchInput} returnKeyType="search" accessibilityLabel="Search published stories" autoCorrect={false} />
            {!!query && (
              <TouchableOpacity onPress={() => setQuery("")} accessibilityLabel="Clear search" accessibilityRole="button" hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={T.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loading ? <ActivityIndicator color={T.growth} style={{ marginTop: 40 }} />
          : failed ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={30} color={T.textTertiary} />
              <Text style={styles.emptyText}>Kingdom Stories couldn't load. Check your connection.</Text>
              <TouchableOpacity onPress={() => { setLoading(true); load(); }} style={styles.retry} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
            </View>
          ) : results !== null || searching ? (
            <View style={styles.resultsGrid}>
              {searching && !results ? <ActivityIndicator color={T.growth} style={{ marginTop: 20 }} />
                : (results ?? []).length === 0 ? <Text style={styles.emptyText}>No published stories match “{query.trim()}”.</Text>
                : (results ?? []).map((s) => <StoryPosterCard key={s.id} story={s as StoryCard} width={Math.min(160, (width - 52) / 3)} onPress={() => open(s)} />)}
            </View>
          ) : home ? (
            <>
              <DiscoverRow title="Continue Learning" stories={home.continueLearning} wide onOpen={startOrContinue}
                onSeeAll={() => router.push({ pathname: "/kingdom-stories/library", params: { shelf: "in_progress" } } as any)} />
              {!home.continueLearning.length && home.recentlyViewed.length === 0 && home.totalPublished > 0 ? (
                <View style={styles.startHere}>
                  <Ionicons name="sparkles-outline" size={18} color={T.light} />
                  <Text style={styles.startHereText}>Start a story below — your progress, favourites and saved stories will appear here.</Text>
                </View>
              ) : null}
              {home.collections.map((col) => (
                <DiscoverRow key={col.id} title={col.title} subtitle={col.description} stories={col.stories}
                  onOpen={open} onSeeAll={col.total > col.stories.length || col.total > 4 ? () => router.push(`/kingdom-stories/collection/${col.slug}` as any) : undefined} />
              ))}
              <DiscoverRow title="My Favourites" stories={home.favourites} onOpen={open} onSeeAll={() => router.push({ pathname: "/kingdom-stories/library", params: { shelf: "favourites" } } as any)} />
              <DiscoverRow title="Saved for Later" stories={home.later} onOpen={open} onSeeAll={() => router.push({ pathname: "/kingdom-stories/library", params: { shelf: "later" } } as any)} />
              {home.categoryRows.map((r) => (
                <DiscoverRow key={r.category.id} title={r.category.title} subtitle={`${r.total} ${r.total === 1 ? "story" : "stories"}`} stories={r.stories} onOpen={open}
                  onSeeAll={() => router.push(`/kingdom-stories/category/${r.category.slug}` as any)} />
              ))}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.background },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  iconBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
  brand: { flex: 1, textAlign: "center", color: T.textPrimary, fontSize: 15, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  heroText: { paddingHorizontal: 16, paddingTop: 14, gap: 6, maxWidth: 760, width: "100%" },
  heroKicker: { color: T.light, ...TT.label, textTransform: "uppercase" },
  heroTitle: { color: T.textPrimary, fontSize: 30, lineHeight: 36, fontFamily: "Inter_700Bold" },
  heroSub: { color: T.textSecondary, ...TT.body },
  heroActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" },
  playBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F4EFE4", borderRadius: 10, paddingHorizontal: 18, minHeight: 46 },
  playText: { color: T.onLight, ...TT.bodyEmph, fontSize: 15 },
  ghostBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 10, paddingHorizontal: 16, minHeight: 46 },
  ghostText: { color: T.textPrimary, ...TT.bodyEmph },
  roundBtn: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" },
  searchWrap: { paddingHorizontal: 16, marginTop: 10 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: T.surfaceRaised, borderRadius: 12, paddingHorizontal: 12, minHeight: MIN_TOUCH_TARGET, borderWidth: 1, borderColor: T.borderFaint },
  searchInput: { flex: 1, color: T.textPrimary, ...TT.body, paddingVertical: 10 },
  resultsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 16, marginTop: 16 },
  startHere: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 18, padding: 12, borderRadius: 12, backgroundColor: T.lightSoft },
  startHereText: { flex: 1, color: T.textSecondary, ...TT.caption },
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
