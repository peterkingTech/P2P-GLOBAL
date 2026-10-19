import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getLibrary, type Library, type LibraryItem } from "@/lib/groupLearningApi";

// The central P2P Library: Core Foundation curriculum and P2P Plans by
// category — published content only, from the one source of truth
// (p2p_curriculums). Opened from a group's Learning home (s = scope,
// g = group id, kept as short names so they never collide with sibling
// route segments) or on its own; choosing happens on the series outline.
export default function LearningLibraryScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  const { s, g } = useLocalSearchParams<{ s?: string; g?: string }>();
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setLib(await getLibrary()); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load the library."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (item: LibraryItem) => router.push({ pathname: "/learning/curriculum/[curriculumId]", params: { curriculumId: item.id, s: s ?? "", g: g ?? "" } } as any);
  const Item = ({ item }: { item: LibraryItem }) => (
    <TouchableOpacity style={styles.item} onPress={() => open(item)} accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.lessonCount} lessons`}>
      <Ionicons name={item.type === "core" ? "school-outline" : "map-outline"} size={20} color={c.accentGreen} />
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.itemSub} numberOfLines={1}>{item.subtitle ? `${item.subtitle} · ` : ""}{item.lessonCount} {item.lessonCount === 1 ? "lesson" : "lessons"}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "P2P Library" }} />
      {loading ? <ActivityIndicator color={c.primaryGreen} style={{ marginTop: 40 }} /> : error || !lib ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{error ?? "Couldn't load the library."}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => { setLoading(true); load(); }} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}>
          <Text style={styles.section}>Core Foundation</Text>
          {lib.core.length ? <View style={styles.card}>{lib.core.map((i) => <Item key={i.id} item={i} />)}</View> : <Text style={styles.muted}>Nothing published yet.</Text>}
          <Text style={styles.section}>P2P Plans</Text>
          {lib.categories.length === 0 ? <Text style={styles.muted}>No plans published yet.</Text> : lib.categories.map((cat) => (
            <View key={cat.id} style={{ gap: 6 }}>
              <Text style={styles.category}>{cat.title}</Text>
              <View style={styles.card}>{cat.plans.map((i) => <Item key={i.id} item={i} />)}</View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { padding: 24, alignItems: "center", gap: 12 },
    scroll: { padding: 16, paddingBottom: 40, gap: 10 },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 6 },
    category: { fontSize: 12, color: c.textMid, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase" },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, paddingHorizontal: 14 },
    item: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    itemTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    itemSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    muted: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    retry: { minHeight: 44, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, justifyContent: "center" },
    retryText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
