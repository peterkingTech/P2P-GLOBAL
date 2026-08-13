import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Platform } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";
import { getApiUrl } from "@/lib/apiUrl";
import colors from "@/constants/colors";

interface CallHistoryEntry {
  id: string; callType: CallType | "group"; status: string; durationSeconds: number;
  createdAt: string; conversationId: string | null; otherUserId: string | null; otherUserName: string | null;
}

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  audio: "call", video: "videocam", pastoral: "heart", crisis: "warning", group: "people",
};
const TYPE_LABEL: Record<string, string> = {
  audio: "Audio call", video: "Video call", pastoral: "Pastoral check-in", crisis: "Crisis call", group: "Group call",
};

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function CallHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const [entries, setEntries] = useState<CallHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/calls/history/${profile.id}`);
      setEntries(await res.json());
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const topPad = insets.top + (Platform.OS === "web" ? 20 : 0);

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Call History</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : entries.length === 0 ? (
        <View style={styles.centerFill}>
          <Ionicons name="call-outline" size={40} color={colors.borderBeige} />
          <Text style={styles.emptyText}>No calls yet.</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          renderItem={({ item }) => {
            const missed = item.status === "missed";
            return (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={item.conversationId ? 0.7 : 1}
                onPress={() => { if (item.conversationId) router.push(`/messages/${item.conversationId}` as any); }}
              >
                <View style={[styles.iconWrap, missed && styles.iconWrapMissed]}>
                  <Ionicons name={TYPE_ICON[item.callType] ?? "call"} size={18} color={missed ? "#B91C1C" : colors.accentGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.otherUserName ?? "Someone"}</Text>
                  <Text style={styles.rowMeta}>
                    {TYPE_LABEL[item.callType] ?? "Call"} · {formatDate(item.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.rowDuration, missed && styles.rowDurationMissed]}>
                  {missed ? "Missed" : formatDuration(item.durationSeconds)}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.navBorder, gap: 12 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
  iconWrapMissed: { backgroundColor: "rgba(185,28,28,0.1)" },
  rowName: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  rowDuration: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  rowDurationMissed: { color: "#B91C1C", fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});