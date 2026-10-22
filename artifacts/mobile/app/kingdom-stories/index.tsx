import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, Image, TextInput } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  getKingdomStoriesFeed, getKingdomStoryCategories, getCatalogueCategories, getKingdomStoryMediaSignedUrl, searchKingdomStories,
  categoryCountLabels, CONTENT_TYPE_LABELS, type KingdomStory, type CatalogueCategory,
} from "@/lib/kingdomStoriesApi";

// Kingdom Stories home — reached from Discover, not a bottom tab (per
// product decision). "Stories of faith, mission, sacrifice, revival,
// discipleship, and the work of God across generations." No official
// account, no creator profile, no follower/like mechanics — the content
// itself is the product. Categories show how many stories are PUBLISHED and,
// separately, how many are planned; only published stories can be opened or
// found by search.
const thumbStyles = StyleSheet.create({
  thumb: { width: "100%", height: "100%" },
  thumbSmall: { width: 64, height: 64, borderRadius: 10 },
  placeholder: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#1D9E75" },
  placeholderSmall: { width: 64, height: 64, borderRadius: 10 },
});

function StoryCoverThumb({ story, small }: { story: KingdomStory; small?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const cover = story.media?.[0];
    if (cover) getKingdomStoryMediaSignedUrl(cover.mediaPath).then(setUrl);
  }, [story.media]);
  if (!url) return <View style={[thumbStyles.placeholder, small && thumbStyles.placeholderSmall]}><Ionicons name="book-outline" size={20} color="#fff" /></View>;
  return <Image source={{ uri: url }} style={[thumbStyles.thumb, small && thumbStyles.thumbSmall]} resizeMode="cover" />;
}

export default function KingdomStoriesHomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles2 = makeStyles(c);

  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [countsKnown, setCountsKnown] = useState(true);
  const [featured, setFeatured] = useState<KingdomStory | null>(null);
  const [latest, setLatest] = useState<KingdomStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KingdomStory[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      const [cats, featuredRes, latestRes] = await Promise.all([
        // Older servers have no catalogue endpoint: fall back to the plain list (no counts).
        getCatalogueCategories().then((r) => { setCountsKnown(true); return r.categories; }).catch(async () => {
          setCountsKnown(false);
          return (await getKingdomStoryCategories()).map((k) => ({ id: k.id, slug: k.slug, title: k.title, description: k.description, icon: k.icon ?? null, displayOrder: k.displayOrder, publishedStories: 0, plannedTopics: 0 }));
        }),
        getKingdomStoriesFeed({ featured: true, limit: 1 }),
        getKingdomStoriesFeed({ limit: 20 }),
      ]);
      setCategories(cats);
      setFeatured(featuredRes.stories[0] ?? null);
      setLatest(latestRes.stories);
    } finally {
      setLoading(false);
    }
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

  const renderStory = ({ item }: { item: KingdomStory }) => (
    <TouchableOpacity style={styles2.card} onPress={() => router.push(`/kingdom-stories/${item.id}` as any)} activeOpacity={0.88}>
      <StoryCoverThumb story={item} small />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles2.cardCategory}>{item.category?.title ?? (item.contentType ? CONTENT_TYPE_LABELS[item.contentType] : "")}</Text>
        <Text style={styles2.cardTitle} numberOfLines={2}>{item.title}</Text>
        {!!item.subtitle && <Text style={styles2.cardSubtitle} numberOfLines={1}>{item.subtitle}</Text>}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles2.screen, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles2.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles2.title}>Kingdom Stories</Text>
        <View style={{ width: 22 }} />
      </View>
      <Text style={styles2.subtitle}>Stories of faith, mission, sacrifice, revival, and the work of God across generations.</Text>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <View style={styles2.searchBox}>
          <Ionicons name="search" size={16} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search published stories"
            placeholderTextColor={c.textMuted}
            style={styles2.searchInput}
            returnKeyType="search"
            accessibilityLabel="Search published stories"
            autoCorrect={false}
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery("")} accessibilityLabel="Clear search" accessibilityRole="button" hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={c.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles2.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : results !== null || searching ? (
        <FlatList
          data={results ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            searching ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 30 }} /> : (
              <View style={styles2.emptyWrap}>
                <Ionicons name="search-outline" size={28} color={c.textMuted} />
                <Text style={styles2.emptyText}>No published stories match “{query.trim()}”.</Text>
              </View>
            )
          }
          renderItem={renderStory}
        />
      ) : (
        <FlatList
          data={latest}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: 16, marginBottom: 6 }}>
              {featured && (
                <TouchableOpacity style={styles2.featuredCard} onPress={() => router.push(`/kingdom-stories/${featured.id}` as any)} activeOpacity={0.88}>
                  <StoryCoverThumb story={featured} />
                  <View style={styles2.featuredOverlay}>
                    <Text style={styles2.featuredBadge}>FEATURED</Text>
                    <Text style={styles2.featuredTitle} numberOfLines={2}>{featured.title}</Text>
                    {!!featured.category && <Text style={styles2.featuredCategory}>{featured.category.title}</Text>}
                  </View>
                </TouchableOpacity>
              )}

              {categories.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text style={styles2.sectionHeading}>Browse by category</Text>
                  <View style={styles2.grid}>
                    {categories.map((cat) => {
                      const counts = categoryCountLabels(cat);
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          style={styles2.catCard}
                          onPress={() => router.push(`/kingdom-stories/category/${cat.slug}` as any)}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel={countsKnown ? `${cat.title}. ${counts.published}${counts.planned ? `, ${counts.planned}` : ""}` : cat.title}
                        >
                          <Ionicons name={(cat.icon ?? "book-outline") as any} size={18} color={c.accentGreen} />
                          <Text style={styles2.catTitle} numberOfLines={3}>{cat.title}</Text>
                          {countsKnown && (
                            <View style={{ gap: 1 }}>
                              <Text style={[styles2.catCount, cat.publishedStories > 0 && { color: c.accentGreen }]}>{counts.published}</Text>
                              {!!counts.planned && <Text style={styles2.catPlanned}>{counts.planned}</Text>}
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              <Text style={styles2.sectionHeading}>Latest Stories</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles2.emptyWrap}>
              <Ionicons name="book-outline" size={32} color={c.textMuted} />
              <Text style={styles2.emptyText}>Kingdom Stories will appear here as new stories are published.</Text>
            </View>
          }
          renderItem={renderStory}
        />
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    subtitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4, marginBottom: 12, paddingHorizontal: 24, lineHeight: 17 },
    searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
    searchInput: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", paddingVertical: 10 },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    featuredCard: { borderRadius: 16, overflow: "hidden", height: 180, backgroundColor: c.card },
    featuredOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 14, backgroundColor: "rgba(0,0,0,0.45)" },
    featuredBadge: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1 },
    featuredTitle: { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 4 },
    featuredCategory: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    catCard: { flexBasis: "47%", flexGrow: 1, minHeight: 104, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 12, gap: 6, justifyContent: "space-between" },
    catTitle: { fontSize: 13, color: c.textDark, fontFamily: "Inter_700Bold", lineHeight: 17 },
    catCount: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    catPlanned: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    emptyWrap: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 60, paddingHorizontal: 40 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    card: { flexDirection: "row", gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 10, alignItems: "center" },
    cardCategory: { fontSize: 10, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.3 },
    cardTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardSubtitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
