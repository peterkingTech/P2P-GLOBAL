import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, ScrollView, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import colors from "@/constants/colors";
import {
  getTopics, reorderTopics, getKingdomStoryCategories, editorCategoryOrder,
  TOPIC_STATUSES, TOPIC_STATUS_LABELS, TOPIC_PRIORITIES,
  type KingdomStoryTopic, type KingdomStoryCategory, type TopicStatus, type TopicPriority,
} from "@/lib/kingdomStoriesApi";

// Catalogue topics (editors). Filter by category, status, priority, period,
// region; search titles. Within one category (no other filter) the topics can
// be put in order — that order is the category's production order.
const PAGE = 100;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function TopicsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; status?: string; priority?: string }>();
  const [categories, setCategories] = useState<KingdomStoryCategory[]>([]);
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [status, setStatus] = useState<TopicStatus | undefined>(TOPIC_STATUSES.includes(params.status as TopicStatus) ? (params.status as TopicStatus) : undefined);
  const [priority, setPriority] = useState<TopicPriority | undefined>(TOPIC_PRIORITIES.includes(params.priority as TopicPriority) ? (params.priority as TopicPriority) : undefined);
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState("");
  const [region, setRegion] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [topics, setTopics] = useState<KingdomStoryTopic[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);

  useEffect(() => { getKingdomStoryCategories().then((c) => setCategories(editorCategoryOrder(c))).catch(() => {}); }, []);

  const filters = { category, status, priority, q: q.trim() || undefined, period: period.trim() || undefined, region: region.trim() || undefined };
  const canReorder = !!category && !status && !priority && !filters.q && !filters.period && !filters.region;

  const load = useCallback(async (page = 0) => {
    setLoading(true);
    try {
      const r = await getTopics({ ...filters, page, limit: canReorder ? 200 : PAGE });
      setTopics((cur) => (page === 0 ? r.topics : [...cur, ...r.topics]));
      setTotal(r.total);
    } catch (e: any) {
      showAlert("Couldn't load topics", e?.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, status, priority, q, period, region]);

  useFocusEffect(useCallback(() => {
    const t = setTimeout(() => load(0), q || period || region ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]));

  async function move(index: number, delta: number) {
    if (!category) return;
    const next = [...topics];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setTopics(next);
    setReordering(true);
    try { await reorderTopics(category, next.map((t) => t.id)); }
    catch (e: any) { showAlert("Couldn't reorder", e?.message ?? "Please try again."); await load(0); }
    finally { setReordering(false); }
  }

  const catTitle = (id: string) => categories.find((c) => c.id === id)?.title ?? "";
  const Chip = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <TouchableOpacity onPress={() => router.push("/admin/kingdom-stories/catalogue" as any)} style={styles.back} accessibilityRole="link">
          <Ionicons name="chevron-back" size={16} color={colors.textMid} />
          <Text style={styles.backText}>Catalogue</Text>
        </TouchableOpacity>
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <Ionicons name="search" size={15} color={colors.textMuted} />
            <TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder="Search topic titles" placeholderTextColor={colors.textMuted} accessibilityLabel="Search topic titles" />
          </View>
          <TouchableOpacity style={styles.newBtn} onPress={() => router.push(`/admin/kingdom-stories/topics/new${category ? `?category=${category}` : ""}` as any)}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.newBtnText}>New</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip active={!category} label="All categories" onPress={() => setCategory(undefined)} />
          {categories.map((c) => <Chip key={c.id} active={category === c.id} label={c.status === "published" ? c.title : `${c.title} (inactive)`} onPress={() => setCategory(c.id)} />)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip active={!status} label="Any status" onPress={() => setStatus(undefined)} />
          {TOPIC_STATUSES.map((s) => <Chip key={s} active={status === s} label={TOPIC_STATUS_LABELS[s]} onPress={() => setStatus(s)} />)}
        </ScrollView>
        <View style={styles.chipRow}>
          <Chip active={!priority} label="Any priority" onPress={() => setPriority(undefined)} />
          {TOPIC_PRIORITIES.map((p) => <Chip key={p} active={priority === p} label={p} onPress={() => setPriority(p)} />)}
          <TouchableOpacity onPress={() => setMoreFilters(!moreFilters)} style={{ marginLeft: "auto" }}>
            <Text style={styles.link}>{moreFilters ? "Fewer filters" : "Period / region"}</Text>
          </TouchableOpacity>
        </View>
        {moreFilters && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput style={[styles.input, { flex: 1 }]} value={period} onChangeText={setPeriod} placeholder="Historical period" placeholderTextColor={colors.textMuted} />
            <TextInput style={[styles.input, { flex: 1 }]} value={region} onChangeText={setRegion} placeholder="Region" placeholderTextColor={colors.textMuted} />
          </View>
        )}
        <Text style={styles.count}>
          {total} topic{total === 1 ? "" : "s"}{canReorder ? " · use the arrows to set this category's order" : ""}
        </Text>
      </View>

      <FlatList
        data={topics}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 60 }}
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.primaryGreen} style={{ marginTop: 30 }} /> : <Text style={styles.empty}>No topics match.</Text>}
        onEndReached={() => { if (!loading && !canReorder && topics.length < total) load(Math.floor(topics.length / PAGE)); }}
        renderItem={({ item, index }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/admin/kingdom-stories/topics/${item.id}` as any)}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>
                {item.priority} · {TOPIC_STATUS_LABELS[item.status]}{!category ? ` · ${catTitle(item.categoryId)}` : ""}
                {item.stories?.length ? ` · ${item.stories.length === 1 ? "1 story" : `${item.stories.length} stories`}` : ""}
              </Text>
              {!!item.overlapNote && <Text style={styles.overlap}>Possible overlap — review</Text>}
            </View>
            {canReorder ? (
              <View style={{ gap: 4 }}>
                <TouchableOpacity disabled={index === 0 || reordering} onPress={() => move(index, -1)} style={[styles.arrow, (index === 0 || reordering) && { opacity: 0.3 }]} accessibilityLabel={`Move ${item.title} up`}>
                  <Ionicons name="arrow-up" size={14} color={colors.textMid} />
                </TouchableOpacity>
                <TouchableOpacity disabled={index === topics.length - 1 || reordering} onPress={() => move(index, 1)} style={[styles.arrow, (index === topics.length - 1 || reordering) && { opacity: 0.3 }]} accessibilityLabel={`Move ${item.title} down`}>
                  <Ionicons name="arrow-down" size={14} color={colors.textMid} />
                </TouchableOpacity>
              </View>
            ) : <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  top: { padding: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  back: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  backText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  searchRow: { flexDirection: "row", gap: 8 },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 10, minHeight: 40 },
  searchInput: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", paddingVertical: 8 },
  newBtn: { flexDirection: "row", gap: 4, alignItems: "center", backgroundColor: colors.accentGreen, borderRadius: 10, paddingHorizontal: 12 },
  newBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chipRow: { flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "nowrap" },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  chipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  chipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  chipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  link: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  count: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: 30, fontFamily: "Inter_400Regular" },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 12 },
  cardTitle: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  cardMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  overlap: { fontSize: 11, color: "#92400E", fontFamily: "Inter_500Medium" },
  arrow: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 6, padding: 5 },
});
