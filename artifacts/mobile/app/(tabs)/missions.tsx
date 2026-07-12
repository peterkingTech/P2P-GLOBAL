import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Platform, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, PrayerWallPost } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function TestimonyCard({ item }: { item: PrayerWallPost }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.avatar}>
          <Ionicons name="sparkles" size={14} color={colors.amber} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardName}>{item.isAnonymous ? "Anonymous" : item.userName}</Text>
          <Text style={s.cardMeta}>{timeAgo(item.createdAt)} · Kingdom Win</Text>
        </View>
      </View>
      <Text style={s.cardBody}>{item.body}</Text>
      <View style={s.cardFooter}>
        <Ionicons name="hand-left-outline" size={13} color={colors.textMuted} />
        <Text style={s.cardFooterText}>{item.prayingCount} praying · {item.amenCount} amen</Text>
      </View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: { paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    title: { fontSize: 22, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    subtitle: { fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 16, fontFamily: "Inter_400Regular" },
    statsRow: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14,
    },
    statBox: { flex: 1, alignItems: "center" },
    statNum: { fontSize: 16, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold" },
    statLabel: { fontSize: 10, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular", textAlign: "center" },
    statDivider: { width: 1, height: 32, backgroundColor: c.borderBeige },
    sectionTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
    loading: { alignItems: "center", paddingVertical: 40 },
    list: { paddingHorizontal: 20, paddingTop: 10 },
    empty: { alignItems: "center", paddingTop: 40, paddingHorizontal: 20, gap: 10 },
    emptyTitle: { fontSize: 16, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
    card: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: "rgba(224,164,65,0.3)",
      padding: 14, marginBottom: 12,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
    avatar: {
      width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(224,164,65,0.15)",
      alignItems: "center", justifyContent: "center",
    },
    cardName: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    cardMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    cardBody: { fontSize: 14, color: c.textMid, lineHeight: 21, fontFamily: "Inter_400Regular", marginBottom: 10 },
    cardFooter: { flexDirection: "row", alignItems: "center", gap: 6 },
    cardFooterText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}

export default function MissionsTab() {
  const insets = useSafeAreaInsets();
  const { getPrayerWallPosts, forestStats, missions } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [testimonies, setTestimonies] = useState<PrayerWallPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const posts = await getPrayerWallPosts("recent");
    setTestimonies(posts.filter((p) => p.postType === "testimony"));
    setLoading(false);
  }, [getPrayerWallPosts]);

  useEffect(() => { load(); }, [load]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const countriesCount = forestStats.countriesReached.length;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={[styles.header, { paddingTop: 20 }]}>
        <Text style={styles.title}>Missions</Text>
        <Text style={styles.subtitle}>What God is doing through this network</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{countriesCount}</Text>
            <Text style={styles.statLabel}>Countries Reached</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{testimonies.length}</Text>
            <Text style={styles.statLabel}>Kingdom Wins Shared</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{missions.length}</Text>
            <Text style={styles.statLabel}>Unreached Groups</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Kingdom Wins</Text>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accentGreen} />
        </View>
      ) : (
        <FlatList
          data={testimonies}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <TestimonyCard item={item} />}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="earth-outline" size={44} color={colors.borderBeige} />
              <Text style={styles.emptyTitle}>No testimonies shared yet</Text>
              <Text style={styles.emptyText}>
                When someone shares how God answered a prayer, it will appear here as a Kingdom Win.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
