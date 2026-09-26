import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getKingdomStoriesFeed, type KingdomStory } from "@/lib/kingdomStoriesApi";

export default function KingdomStoryCategoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [stories, setStories] = useState<KingdomStory[]>([]);
  const [categoryTitle, setCategoryTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await getKingdomStoriesFeed({ category: slug, limit: 40 });
      setStories(res.stories);
      setCategoryTitle(res.stories[0]?.category?.title ?? slug);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>{categoryTitle || "Kingdom Stories"}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : stories.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="book-outline" size={32} color={c.textMuted} />
          <Text style={styles.emptyText}>No stories in this category yet.</Text>
        </View>
      ) : (
        <FlatList
          data={stories}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/kingdom-stories/${item.id}` as any)} activeOpacity={0.88}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {!!item.subtitle && <Text style={styles.cardSubtitle} numberOfLines={2}>{item.subtitle}</Text>}
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
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
    title: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, gap: 4 },
    cardTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardSubtitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
