import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import StoryImage from "@/components/kingdom-stories/StoryImage";
import { cardProgress } from "@/lib/storybook";
import { getKingdomStoriesFeed, getCatalogueCategories, categoryCountLabels, formatTopicNumber, type KingdomStory, type CatalogueCategory } from "@/lib/kingdomStoriesApi";

// One category: its description, its PUBLISHED stories, and — as a number
// only — how many more are planned. Planned topics are never listed or
// presented as stories.
export default function KingdomStoryCategoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [stories, setStories] = useState<KingdomStory[]>([]);
  const [category, setCategory] = useState<CatalogueCategory | null>(null);
  const [fallbackTitle, setFallbackTitle] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const [res, cats] = await Promise.all([
        getKingdomStoriesFeed({ category: slug, limit: 50 }),
        getCatalogueCategories().catch(() => null), // older server: no counts
      ]);
      setStories(res.stories);
      setCategory(cats?.categories.find((k) => k.slug === slug) ?? null);
      setFallbackTitle(res.stories[0]?.category?.title ?? slug);
    } catch {
      // Offline / signed out: show the empty state rather than an unhandled error.
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const counts = category ? categoryCountLabels(category) : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity hitSlop={10} onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={2}>{category?.title || fallbackTitle || "Kingdom Stories"}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : (
        <FlatList
          data={stories}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          ListHeaderComponent={category ? (
            <View style={styles.intro}>
              {!!category.description && <Text style={styles.description}>{category.description}</Text>}
              <View style={styles.countRow}>
                <View style={styles.countPill}><Ionicons name="book-outline" size={12} color={category.publishedStories ? c.accentGreen : c.textMuted} /><Text style={[styles.countText, !!category.publishedStories && { color: c.accentGreen }]}>{counts!.published}</Text></View>
                {!!counts!.planned && <View style={styles.countPill}><Ionicons name="time-outline" size={12} color={c.textMuted} /><Text style={styles.countText}>{counts!.planned}</Text></View>}
              </View>
            </View>
          ) : null}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="book-outline" size={32} color={c.textMuted} />
              <Text style={styles.emptyText}>
                {category && category.plannedTopics > 0
                  ? `No stories are published in this category yet. ${category.plannedTopics} ${category.plannedTopics === 1 ? "is" : "are"} being prepared.`
                  : "No stories in this category yet."}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.card, { flexDirection: "row", gap: 12, alignItems: "center" }]} onPress={() => router.push(`/kingdom-stories/${item.id}` as any)} activeOpacity={0.88}
              accessibilityRole="button" accessibilityLabel={[formatTopicNumber(item.topicNumber), item.title, cardProgress(item.myProgress)].filter(Boolean).join(". ")}>
              {item.media?.[0] ? <View style={{ width: 72, height: 72 }}><StoryImage media={item.media[0]} aspectRatio={1} rounded={10} thumb showCaption={false} /></View> : null}
              <View style={{ flex: 1, gap: 3 }}>
                {formatTopicNumber(item.topicNumber) ? <Text style={styles.cardNo}>{formatTopicNumber(item.topicNumber)}</Text> : null}
                <Text style={styles.cardTitle}>{item.title}</Text>
                {!!item.subtitle && <Text style={styles.cardSubtitle} numberOfLines={2}>{item.subtitle}</Text>}
                {!!cardProgress(item.myProgress) && <Text style={[styles.cardSubtitle, { color: c.accentGreen }]}>{cardProgress(item.myProgress)}</Text>}
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
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, marginBottom: 12 },
    title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    intro: { gap: 10, marginBottom: 6 },
    description: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
    countRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    countPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    countText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    emptyWrap: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 60, paddingHorizontal: 40 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, gap: 4 },
    cardNo: { fontSize: 10, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.6, textTransform: "uppercase" },
    cardTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardSubtitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
