import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import colors from "@/constants/colors";
import { getKingdomStoriesAdminList, type KingdomStory, type KingdomStoryStatus } from "@/lib/kingdomStoriesApi";

const STATUS_FILTERS: Array<{ value: KingdomStoryStatus | "all"; label: string }> = [
  { value: "draft", label: "Draft" }, { value: "review", label: "Review" },
  { value: "published", label: "Published" }, { value: "archived", label: "Archived" }, { value: "all", label: "All" },
];

export default function KingdomStoriesAdminListScreen() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<KingdomStoryStatus | "all">("draft");
  const [stories, setStories] = useState<KingdomStory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStories(await getKingdomStoriesAdminList(statusFilter === "all" ? undefined : statusFilter)); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity key={f.value} style={[styles.filterChip, statusFilter === f.value && styles.filterChipActive]} onPress={() => setStatusFilter(f.value)}>
            <Text style={[styles.filterChipText, statusFilter === f.value && styles.filterChipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.newBtn} onPress={() => router.push("/admin/kingdom-stories/create" as any)}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.newBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : (
        <FlatList
          data={stories}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No stories here yet.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/admin/kingdom-stories/${item.id}` as any)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardMeta}>{item.isFeatured ? "★ Featured · " : ""}Updated {new Date(item.updatedAt).toLocaleDateString()}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  filterBar: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  filterChipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  filterChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  filterChipTextActive: { color: "#fff", fontWeight: "600" },
  newBtn: { flexDirection: "row", gap: 4, alignItems: "center", backgroundColor: colors.accentGreen, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginLeft: "auto" },
  newBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 14, gap: 10 },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  cardMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
});
