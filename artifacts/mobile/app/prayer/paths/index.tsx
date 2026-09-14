import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getPrayerPaths, type PrayerPath } from "@/lib/prayerPathsApi";

// "Pray the Word" Stage 3 — Prayer Paths browse. A Prayer Path is a
// guided, curated Scripture-prayer sequence — not a Bible course, not a
// social challenge.
export default function PrayerPathsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [paths, setPaths] = useState<PrayerPath[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setPaths(await getPrayerPaths()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Prayer Paths</Text>
        <View style={{ width: 22 }} />
      </View>
      <Text style={styles.subtitle}>Guided Scripture-prayer journeys for a season or a moment.</Text>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : paths.length === 0 ? (
        <View style={styles.centerFill}><Text style={styles.emptyText}>No prayer paths are published yet.</Text></View>
      ) : (
        <FlatList
          data={paths}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/prayer/paths/${item.slug}` as any)} activeOpacity={0.85}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {!!item.description && <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>}
              <View style={styles.metaRow}>
                <Ionicons name="book-outline" size={13} color={c.textMuted} />
                <Text style={styles.metaText}>{item.scriptureCount ?? 0} Scriptures</Text>
                {!!item.estimatedMinutes && (
                  <>
                    <Text style={styles.metaDot}>·</Text>
                    <Ionicons name="time-outline" size={13} color={c.textMuted} />
                    <Text style={styles.metaText}>~{item.estimatedMinutes} min</Text>
                  </>
                )}
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
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    subtitle: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4, marginBottom: 16, paddingHorizontal: 24 },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 16, gap: 6 },
    cardTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardDesc: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
    metaText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    metaDot: { color: c.textMuted, marginHorizontal: 2 },
  });
}
