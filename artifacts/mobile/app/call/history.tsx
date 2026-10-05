import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Platform, Alert } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import type { CallType } from "@/contexts/DataContext";
import { getApiUrl } from "@/lib/apiUrl";
import { startPeerCall, buildCallRouteParams } from "@/lib/callStart";
import colors from "@/constants/colors";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

interface CallHistoryEntry {
  id: string; callType: CallType | "group"; status: string; durationSeconds: number;
  createdAt: string; conversationId: string | null; otherUserId: string | null; otherUserName: string | null;
  direction?: "incoming" | "outgoing";
}

// p2p_call_logs.status → what this user sees. The labels match the chat's
// call-summary card (calls.ts UNANSWERED_LABEL); direction decides whether
// an unanswered call reads as "Missed" (it rang here) or "No answer".
const UNANSWERED_STATUSES = new Set(["missed", "declined", "cancelled", "busy"]);
function outcomeLabel(item: CallHistoryEntry): string {
  const incoming = item.direction === "incoming";
  switch (item.status) {
    case "ended": return formatDuration(item.durationSeconds);
    case "missed": return incoming ? "Missed" : "No answer";
    case "declined": return "Declined";
    case "cancelled": return "Cancelled";
    case "busy": return "Busy";
    default: return "—"; // never settled (both apps closed mid-call)
  }
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
  const [callingBackId, setCallingBackId] = useState<string | null>(null);

  // Missed-call callback — same shared start sequence every other call
  // site uses (lib/callStart.ts). /calls/start enforces the relationship and
  // block checks server-side; any refusal surfaces through showAlert.
  async function callBack(item: CallHistoryEntry) {
    if (!profile?.id || !item.otherUserId || callingBackId) return;
    const callType = item.callType === "video" ? "video" : "audio";
    setCallingBackId(item.id);
    try {
      const result = await startPeerCall({
        supabase, currentUserId: profile.id, otherUserId: item.otherUserId,
        callType, onAlert: showAlert, source: "call_history_callback",
      });
      if (!result) return;
      router.push({
        pathname: callType === "video" ? "/call/video" : "/call/audio",
        params: buildCallRouteParams({
          channelName: result.channelName, otherUserId: item.otherUserId,
          otherUserName: item.otherUserName ?? "Peer", callType,
          callId: result.incomingCallId, conversationId: result.conversationId, callLogId: result.callLogId,
        }),
      } as any);
    } finally {
      setCallingBackId(null);
    }
  }

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
            const incoming = item.direction === "incoming";
            const unanswered = UNANSWERED_STATUSES.has(item.status);
            // Red = a call that rang here and nobody picked up.
            const missed = incoming && (item.status === "missed" || item.status === "cancelled");
            // Any unanswered plain 1:1 audio/video call with a known peer
            // calls straight back; group/pastoral/crisis calls, or a stale
            // record with no peer id, keep the open-the-chat behavior.
            const canCallBack = unanswered && !!item.otherUserId && (item.callType === "audio" || item.callType === "video");
            const typeLabel = TYPE_LABEL[item.callType] ?? "Call";
            const directionLabel = item.direction ? (incoming ? "Incoming" : "Outgoing") : null;
            return (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={canCallBack || item.conversationId ? 0.7 : 1}
                disabled={callingBackId === item.id}
                accessibilityLabel={canCallBack ? `Call back ${item.otherUserName ?? ""}` : undefined}
                onPress={() => {
                  if (canCallBack) { void callBack(item); return; }
                  if (item.conversationId) router.push(`/messages/${item.conversationId}` as any);
                }}
              >
                <View style={[styles.iconWrap, missed && styles.iconWrapMissed]}>
                  <Ionicons name={TYPE_ICON[item.callType] ?? "call"} size={18} color={missed ? "#B91C1C" : colors.accentGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.otherUserName ?? "Someone"}</Text>
                  <Text style={[styles.rowMeta, missed && styles.rowDurationMissed]}>
                    {missed ? `Missed ${typeLabel.toLowerCase()}` : typeLabel}
                    {directionLabel ? ` · ${directionLabel}` : ""} · {formatDate(item.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.rowDuration, missed && styles.rowDurationMissed]}>
                  {outcomeLabel(item)}
                </Text>
                {callingBackId === item.id ? (
                  <ActivityIndicator size="small" color={colors.accentGreen} style={{ marginLeft: 10 }} />
                ) : canCallBack ? (
                  <Ionicons name={item.callType === "video" ? "videocam-outline" : "call-outline"} size={20} color={colors.accentGreen} style={{ marginLeft: 10 }} />
                ) : null}
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