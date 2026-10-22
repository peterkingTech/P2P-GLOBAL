import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import colors from "@/constants/colors";
import {
  getCatalogueOverview, TOPIC_STATUSES, TOPIC_STATUS_LABELS, TOPIC_PRIORITIES, PRIORITY_LABELS, type CatalogueOverview,
} from "@/lib/kingdomStoriesApi";

// Catalogue progress for editors. Counts only — no completion percentages:
// a topic count says what is planned, not how much of the catalogue is
// "done", and chapters are shown as "3 of 5 complete", never as a percentage.
export default function KingdomStoriesCatalogueScreen() {
  const router = useRouter();
  const [data, setData] = useState<CatalogueOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await getCatalogueOverview()); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load the catalogue."); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 60 }}>
      <TouchableOpacity onPress={() => router.push("/admin/kingdom-stories" as any)} style={styles.back} accessibilityRole="link">
        <Ionicons name="chevron-back" size={16} color={colors.textMid} />
        <Text style={styles.backText}>Kingdom Stories</Text>
      </TouchableOpacity>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Catalogue</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push("/admin/kingdom-stories/topics/new" as any)}>
          <Ionicons name="add" size={15} color="#fff" />
          <Text style={styles.primaryBtnText}>New topic</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : !data ? <ActivityIndicator color={colors.primaryGreen} style={{ marginTop: 40 }} /> : (
        <>
          <View style={styles.totals}>
            {[
              ["Active categories", data.totals.activeCategories],
              ["Topics", data.totals.topics],
              ["Topics with a story", data.totals.topicsWithStory],
              ["Published stories", data.storiesByStatus.published ?? 0],
            ].map(([label, n]) => (
              <View key={label as string} style={styles.totalCard}>
                <Text style={styles.totalNum}>{n as number}</Text>
                <Text style={styles.totalLabel}>{label as string}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.heading}>Topics by status</Text>
          <View style={styles.chips}>
            {TOPIC_STATUSES.map((s) => (
              <TouchableOpacity key={s} style={styles.statChip} onPress={() => router.push(`/admin/kingdom-stories/topics?status=${s}` as any)}>
                <Text style={styles.statChipNum}>{data.topicsByStatus[s] ?? 0}</Text>
                <Text style={styles.statChipLabel}>{TOPIC_STATUS_LABELS[s]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.heading}>Topics by priority</Text>
          <View style={styles.chips}>
            {TOPIC_PRIORITIES.map((p) => (
              <TouchableOpacity key={p} style={styles.statChip} onPress={() => router.push(`/admin/kingdom-stories/topics?priority=${p}` as any)}>
                <Text style={styles.statChipNum}>{data.topicsByPriority[p] ?? 0}</Text>
                <Text style={styles.statChipLabel}>{PRIORITY_LABELS[p]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.heading}>Stories by status</Text>
          <Text style={styles.line}>
            {(["draft", "review", "published", "archived"] as const).map((s) => `${data.storiesByStatus[s] ?? 0} ${s}`).join(" · ")}
          </Text>

          {data.storiesInProgress.length > 0 && (
            <>
              <Text style={styles.heading}>Stories in progress</Text>
              {data.storiesInProgress.map((s) => (
                <TouchableOpacity key={s.id} style={styles.row} onPress={() => router.push(`/admin/kingdom-stories/${s.id}` as any)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{s.title}</Text>
                    <Text style={styles.rowMeta}>
                      {s.status === "review" ? "In review" : "Draft"} · {s.chapters === 0 ? "no chapters yet" : `${s.complete} of ${s.chapters} chapter${s.chapters === 1 ? "" : "s"} complete`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </>
          )}

          <Text style={styles.heading}>Categories</Text>
          {data.categories.map((c) => (
            <TouchableOpacity key={c.id} style={[styles.row, c.status !== "published" && { opacity: 0.6 }]} onPress={() => router.push(`/admin/kingdom-stories/topics?category=${c.id}` as any)}>
              <Ionicons name={(c.icon ?? "book-outline") as any} size={18} color={colors.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{c.title}{c.status !== "published" ? " (inactive)" : ""}</Text>
                <Text style={styles.rowMeta}>
                  {c.topics} topic{c.topics === 1 ? "" : "s"} · {c.publishedStories} published · {c.storiesInProgress} in progress
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  back: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", paddingVertical: 4 },
  backText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 20, color: colors.textDark, fontFamily: "Inter_700Bold" },
  primaryBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryGreen, borderRadius: 9, paddingHorizontal: 12, minHeight: 40 },
  primaryBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  error: { color: "#B91C1C", fontFamily: "Inter_500Medium", marginTop: 20 },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  totalCard: { flexBasis: "47%", flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 12 },
  totalNum: { fontSize: 22, color: colors.textDark, fontFamily: "Inter_700Bold" },
  totalLabel: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  heading: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 },
  statChipNum: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_700Bold" },
  statChipLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  line: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 12 },
  rowTitle: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
});
