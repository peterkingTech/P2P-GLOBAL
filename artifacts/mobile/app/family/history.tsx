import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getWorshipHistory, type WorshipHistoryEntry } from "@/lib/familyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// A family-scoped list over the existing p2p_family_worship_history table —
// this screen is the first UI caller getWorshipHistory has ever had (the
// route/client function already existed; nothing here duplicates the
// Gathering/session tables, it only reads their already-recorded summary).
export default function FamilyGatheringHistoryScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  const { familyId } = useLocalSearchParams<{ familyId: string }>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entries, setEntries] = useState<WorshipHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!familyId) return;
    try {
      setError(null);
      setEntries(await getWorshipHistory(familyId));
    } catch (e: any) {
      setError(e.message ?? "Couldn't load Gathering History.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [familyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "Gathering History" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Gathering History" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        {error ? (
          <View style={styles.section}>
            <Text style={styles.emptyText}>{error}</Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.section}>
            <Text style={styles.emptyText}>No Gatherings yet. Once your family completes a Family Gathering, it will appear here.</Text>
          </View>
        ) : (
          <View style={styles.section}>
            {entries.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={styles.row}
                onPress={() => router.push({ pathname: "/family/gathering-summary", params: { historyId: entry.id, familyId } } as any)}
                accessibilityRole="button"
                accessibilityLabel={`Gathering on ${formatDate(entry.created_at)}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowDate}>{formatDate(entry.created_at)}</Text>
                  {!!entry.lesson_title && <Text style={styles.rowLesson}>{entry.lesson_title}</Text>}
                  <Text style={styles.rowMeta}>
                    {formatDuration(entry.duration_seconds)} · {entry.participant_count} participant{entry.participant_count === 1 ? "" : "s"}
                    {entry.scripture_reference ? ` · ${entry.scripture_reference}` : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40 },
    section: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19 },
    row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    rowDate: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rowLesson: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 1 },
    rowMeta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  });
}
