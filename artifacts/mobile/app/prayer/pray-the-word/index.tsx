import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, TextInput } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getTopics, type PrayerTopic } from "@/lib/prayerTopicsApi";
import { getRecentPrayerActivity, getSavedScriptures } from "@/lib/prayerLibraryApi";

// "Pray the Word" Stage 2 — "Turn Scripture into prayer." Topic discovery
// landing screen. Deliberately calm: no counts-as-status, no likes, no
// leaderboard — just curated topics to browse into.
export default function PrayTheWordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [topics, setTopics] = useState<PrayerTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [recentCount, setRecentCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const [t, recent, saved] = await Promise.all([getTopics(), getRecentPrayerActivity(), getSavedScriptures()]);
      setTopics(t);
      setRecentCount(recent.length);
      setSavedCount(saved.length);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = search.trim()
    ? topics.filter((t) => t.title.toLowerCase().includes(search.trim().toLowerCase()))
    : topics;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Pray the Word</Text>
        <View style={{ width: 22 }} />
      </View>
      <Text style={styles.subtitle}>Turn Scripture into prayer.</Text>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={c.textMuted} />
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search topics..." placeholderTextColor={c.textMuted} />
      </View>

      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.quickCard} onPress={() => router.push("/prayer/discover" as any)}>
          <Ionicons name="compass-outline" size={18} color={c.accentGreen} />
          <Text style={styles.quickCardText}>What are you carrying today?</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.quickRow, { marginTop: 8 }]}>
        <TouchableOpacity style={styles.quickCardHalf} onPress={() => router.push("/prayer/library" as any)}>
          <Ionicons name="bookmark-outline" size={16} color={c.accentGreen} />
          <Text style={styles.quickCardHalfText}>Saved Scriptures{savedCount > 0 ? ` (${savedCount})` : ""}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickCardHalf} onPress={() => router.push("/prayer/library" as any)}>
          <Ionicons name="time-outline" size={16} color={c.accentGreen} />
          <Text style={styles.quickCardHalfText}>Recently Prayed{recentCount > 0 ? ` (${recentCount})` : ""}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeading}>Browse Topics</Text>
      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.centerFill}><Text style={styles.emptyText}>No topics match yet.</Text></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(t) => t.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.topicCard} onPress={() => router.push(`/prayer/pray-the-word/${item.slug}` as any)} activeOpacity={0.85}>
              <Text style={styles.topicTitle}>{item.title}</Text>
              {!!item.description && <Text style={styles.topicDesc} numberOfLines={2}>{item.description}</Text>}
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
    subtitle: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 2, marginBottom: 14 },
    searchBar: {
      flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
      borderRadius: 12, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
    },
    searchInput: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    quickRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16 },
    quickCard: {
      flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(29,158,117,0.08)",
      borderWidth: 1, borderColor: c.accentGreen, borderRadius: 12, padding: 14,
    },
    quickCardText: { flex: 1, fontSize: 14, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    quickCardHalf: {
      flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.card, borderWidth: 1,
      borderColor: c.borderBeige, borderRadius: 10, padding: 10, justifyContent: "center",
    },
    quickCardHalfText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 18, marginBottom: 10, paddingHorizontal: 16 },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    topicCard: {
      flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14,
      padding: 14, minHeight: 90, justifyContent: "center", gap: 6,
    },
    topicTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    topicDesc: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 15 },
  });
}
