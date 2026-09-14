import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getTestimonyFeed, type PrayerTestimony, type TestimonyType } from "@/lib/prayerTestimonyApi";

const TABS: { key: TestimonyType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "answered_prayer", label: "Answered Prayer" },
  { key: "growth", label: "Growth" },
];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TestimonyFeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [tab, setTab] = useState<TestimonyType | "all">("all");
  const [items, setItems] = useState<PrayerTestimony[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getTestimonyFeed(tab === "all" ? undefined : tab);
      setItems(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Testimonies</Text>
        <TouchableOpacity onPress={() => router.push("/prayer/testimony/record" as any)} accessibilityLabel="Share a testimony" accessibilityRole="button">
          <Ionicons name="add-circle" size={26} color={c.accentGreen} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="sparkles-outline" size={28} color={c.textMuted} />
          <Text style={styles.emptyText}>No testimonies yet. Be the first to share what God has done.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.accentGreen} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/prayer/testimony/${item.id}` as any)} activeOpacity={0.85}>
              <View style={styles.cardHeader}>
                <Ionicons name={item.testimonyType === "answered_prayer" ? "checkmark-circle" : "leaf"} size={16} color={c.accentGreen} />
                <Text style={styles.cardType}>{item.testimonyType === "answered_prayer" ? "Answered Prayer" : "Growth"}</Text>
                {item.mediaType === "video" && <Ionicons name="videocam" size={14} color={c.textMuted} />}
                <Text style={styles.cardTime}>{timeAgo(item.createdAt)}</Text>
              </View>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.cardSnippet} numberOfLines={2}>{item.testimonyText}</Text>
              <Text style={styles.cardAuthor}>{item.isAnonymous ? "Anonymous" : item.authorName ?? "A peer"}</Text>
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
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    tabRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
    tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    tabActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    tabText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    tabTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 14, gap: 4 },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    cardType: { flex: 1, fontSize: 11, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    cardTime: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 2 },
    cardSnippet: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    cardAuthor: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 2 },
  });
}
