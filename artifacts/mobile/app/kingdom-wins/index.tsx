import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getKingdomWinsFeed, KINGDOM_CATEGORY_LABELS, type KingdomWin, type KingdomEntryType } from "@/lib/kingdomWinsApi";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Kingdom Wins / Testimonies — "Look what God has done." Deliberately
// calm: no likes, no follower counts, no ranking, no infinite-scroll
// video feed. Two entry types share this feed (kingdom_win/testimony),
// each visually labeled, never blurred into one undifferentiated stream.
export default function KingdomWinsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [filter, setFilter] = useState<KingdomEntryType | "all">("all");
  const [entries, setEntries] = useState<KingdomWin[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const result = await getKingdomWinsFeed({ entryType: filter === "all" ? undefined : filter, limit: 30 });
      setEntries(result.entries);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Kingdom Wins</Text>
        <TouchableOpacity onPress={() => router.push("/kingdom-wins/my-stories" as any)} accessibilityLabel="My Stories" accessibilityRole="button">
          <Ionicons name="person-circle-outline" size={24} color={c.textDark} />
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>Look what God has done.</Text>

      <View style={styles.tabRow}>
        {(["all", "kingdom_win", "p2p_impact", "testimony"] as const).map((f) => (
          <TouchableOpacity key={f} style={[styles.tab, filter === f && styles.tabActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
              {f === "all" ? "All" : f === "kingdom_win" ? "God's Faithfulness" : f === "p2p_impact" ? "P2P Impact" : "Testimonies"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.shareBtn} onPress={() => router.push("/kingdom-wins/create" as any)}>
        <Ionicons name="add-circle" size={18} color="#fff" />
        <Text style={styles.shareBtnText}>Share a Kingdom Win</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : entries.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="sparkles-outline" size={32} color={c.textMuted} />
          <Text style={styles.emptyTitle}>Your story could encourage someone.</Text>
          <Text style={styles.emptyText}>These are stories of what God is doing in the lives of people in this community — be the first to share.</Text>
          <TouchableOpacity style={styles.emptyCta} onPress={() => router.push("/kingdom-wins/create" as any)}>
            <Text style={styles.emptyCtaText}>Share a Kingdom Win</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/kingdom-wins/${item.id}` as any)} activeOpacity={0.85}>
              <View style={styles.cardHeader}>
                <View style={[styles.entryBadge, item.entryType === "testimony" && styles.entryBadgeTestimony, item.entryType === "p2p_impact" && styles.entryBadgeImpact]}>
                  <Text style={styles.entryBadgeText}>{item.entryType === "testimony" ? "Testimony" : item.entryType === "p2p_impact" ? "P2P Impact" : "Kingdom Win"}</Text>
                </View>
                <Text style={styles.categoryText}>{KINGDOM_CATEGORY_LABELS[item.category]}</Text>
                <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardBody} numberOfLines={3}>{item.body}</Text>
              <Text style={styles.authorText}>{item.isAnonymous ? "Anonymous" : item.authorName ?? "A peer"}</Text>
              {(item.mediaType || item.scriptureReferenceId) && (
                <View style={styles.iconsRow}>
                  {!!item.mediaType && <Ionicons name={item.mediaType === "video" ? "videocam-outline" : "image-outline"} size={13} color={c.textMuted} />}
                  {!!item.scriptureReferenceId && <Ionicons name="book-outline" size={13} color={c.textMuted} />}
                </View>
              )}
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
    subtitle: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 2, marginBottom: 12 },
    tabRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 10 },
    tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    tabActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    tabText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    tabTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
    shareBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 12, marginHorizontal: 16, marginBottom: 14 },
    shareBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
    emptyTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    emptyCta: { backgroundColor: c.primaryGreen, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
    emptyCtaText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, gap: 5 },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    entryBadge: { backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    entryBadgeTestimony: { backgroundColor: "rgba(224,164,65,0.15)" },
    entryBadgeImpact: { backgroundColor: "rgba(94,114,228,0.15)" },
    entryBadgeText: { fontSize: 10, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    categoryText: { flex: 1, fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium" },
    timeText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 2 },
    cardBody: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    authorText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 2 },
    iconsRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  });
}
