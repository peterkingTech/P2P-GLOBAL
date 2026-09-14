import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, Image } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  getKingdomStoriesFeed, getKingdomStoryCategories, getKingdomStoryMediaSignedUrl,
  CONTENT_TYPE_LABELS, type KingdomStory, type KingdomStoryCategory,
} from "@/lib/kingdomStoriesApi";

// Kingdom Stories home — reached from Discover, not a bottom tab (per
// product decision). "Stories of faith, mission, sacrifice, revival,
// discipleship, and the work of God across generations." No official
// account, no creator profile, no follower/like mechanics — the content
// itself is the product.
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

  const [categories, setCategories] = useState<KingdomStoryCategory[]>([]);
  const [featured, setFeatured] = useState<KingdomStory | null>(null);
  const [latest, setLatest] = useState<KingdomStory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [cats, featuredRes, latestRes] = await Promise.all([
        getKingdomStoryCategories(),
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

  return (
    <View style={[styles2.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles2.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles2.title}>Kingdom Stories</Text>
        <View style={{ width: 22 }} />
      </View>
      <Text style={styles2.subtitle}>Stories of faith, mission, sacrifice, revival, and the work of God across generations.</Text>

      {loading ? (
        <View style={styles2.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : (
        <FlatList
          data={latest}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
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
                <FlatList
                  horizontal showsHorizontalScrollIndicator={false}
                  data={categories}
                  keyExtractor={(cat) => cat.id}
                  contentContainerStyle={{ gap: 8 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles2.categoryChip} onPress={() => router.push(`/kingdom-stories/category/${item.slug}` as any)}>
                      <Text style={styles2.categoryChipText}>{item.title}</Text>
                    </TouchableOpacity>
                  )}
                />
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
          renderItem={({ item }) => (
            <TouchableOpacity style={styles2.card} onPress={() => router.push(`/kingdom-stories/${item.id}` as any)} activeOpacity={0.88}>
              <StoryCoverThumb story={item} small />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles2.cardCategory}>{item.category?.title ?? (item.contentType ? CONTENT_TYPE_LABELS[item.contentType] : "")}</Text>
                <Text style={styles2.cardTitle} numberOfLines={2}>{item.title}</Text>
                {!!item.subtitle && <Text style={styles2.cardSubtitle} numberOfLines={1}>{item.subtitle}</Text>}
              </View>
            </TouchableOpacity>
          )}
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
    subtitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4, marginBottom: 14, paddingHorizontal: 24, lineHeight: 17 },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    featuredCard: { borderRadius: 16, overflow: "hidden", height: 180, backgroundColor: c.card },
    featuredOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 14, backgroundColor: "rgba(0,0,0,0.45)" },
    featuredBadge: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1 },
    featuredTitle: { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 4 },
    featuredCategory: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
    categoryChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    categoryChipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    emptyWrap: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 60, paddingHorizontal: 40 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    card: { flexDirection: "row", gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 10, alignItems: "center" },
    cardCategory: { fontSize: 10, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.3 },
    cardTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardSubtitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
