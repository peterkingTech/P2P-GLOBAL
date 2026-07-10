import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useData, ModerationFlag, ModerationFlagStatus } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

const STATUS_FILTERS: Array<{ value: ModerationFlagStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "escalated", label: "Escalated" },
  { value: "warned", label: "Warned" },
  { value: "removed", label: "Removed" },
  { value: "dismissed", label: "Dismissed" },
];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ModerationQueueScreen() {
  const { getModerationQueue, moderateFlag } = useData();
  const { supabase } = useAuth();
  const router = useRouter();
  const [flags, setFlags] = useState<ModerationFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ModerationFlagStatus>("open");
  const [acting, setActing] = useState<string | null>(null);
  const [messaging, setMessaging] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFlags(await getModerationQueue(statusFilter));
    setLoading(false);
  }, [getModerationQueue, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function act(flag: ModerationFlag, action: "dismiss" | "warn" | "remove" | "escalate") {
    setActing(flag.id);
    try {
      const err = await moderateFlag(flag.id, action, undefined);
      if (err) {
        Alert.alert("Couldn't complete action", err);
        return;
      }
      setFlags((prev) => prev.filter((f) => f.id !== flag.id));
    } finally {
      setActing(null);
    }
  }

  function confirmAction(flag: ModerationFlag, action: "dismiss" | "warn" | "remove" | "escalate") {
    const copy: Record<string, { title: string; body: string }> = {
      dismiss: { title: "Dismiss this report?", body: "No action will be taken and the post stays up." },
      warn: { title: "Warn this user?", body: "This logs a warning against their account. The post stays up." },
      remove: { title: "Remove this content?", body: "This permanently deletes the flagged post or comment." },
      escalate: { title: "Escalate to admin?", body: "This creates a case in the admin Help Requests queue for a church leader, regional admin, or super admin to review with full context." },
    };
    Alert.alert(copy[action].title, copy[action].body, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: action === "remove" ? "destructive" : "default", onPress: () => act(flag, action) },
    ]);
  }

  async function handleMessagePoster(flag: ModerationFlag) {
    setMessaging(flag.id);
    try {
      const { data, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: flag.authorId });
      if (error || !data) {
        Alert.alert("Can't message this user", "You can only message peers you already share a connection with, or help-request submitters.");
        return;
      }
      router.push(`/messages/${data}` as any);
    } finally {
      setMessaging(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterChip, statusFilter === f.value && styles.filterChipActive]}
            onPress={() => setStatusFilter(f.value)}
          >
            <Text style={[styles.filterChipText, statusFilter === f.value && styles.filterChipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : (
        <FlatList
          data={flags}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>Nothing here right now.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.contentTypeBadge}>
                  <Ionicons name="flag" size={11} color="#fff" />
                  <Text style={styles.contentTypeBadgeText}>
                    {item.contentType === "prayer_post" ? "Prayer post" : "Comment"}
                  </Text>
                </View>
                <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
              </View>

              {item.contentSnapshot && (
                <Text style={styles.snapshot} numberOfLines={4}>"{item.contentSnapshot}"</Text>
              )}
              {item.reason && <Text style={styles.reason}>Reason: {item.reason}</Text>}
              {item.reporterName && <Text style={styles.reporter}>Reported by {item.reporterName}</Text>}

              {item.poster && (
                <View style={styles.posterRow}>
                  <View style={styles.posterAvatar}>
                    <Text style={styles.posterAvatarText}>{item.poster.fullName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.posterName}>{item.poster.fullName}</Text>
                    <Text style={styles.posterHistory}>
                      {item.poster.totalFlags === 0
                        ? "No prior flags"
                        : `${item.poster.totalFlags} prior flag${item.poster.totalFlags === 1 ? "" : "s"} · ` +
                          `${item.poster.warnedCount} warned · ${item.poster.removedCount} removed · ${item.poster.escalatedCount} escalated`}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.msgIconBtn}
                    onPress={() => handleMessagePoster(item)}
                    disabled={messaging === item.id}
                  >
                    {messaging === item.id ? (
                      <ActivityIndicator size="small" color={colors.accentGreen} />
                    ) : (
                      <Ionicons name="chatbubble-outline" size={16} color={colors.accentGreen} />
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {item.status === "open" ? (
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionDismiss]}
                    onPress={() => confirmAction(item, "dismiss")}
                    disabled={acting === item.id}
                  >
                    <Text style={styles.actionBtnText}>Dismiss</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionWarn]}
                    onPress={() => confirmAction(item, "warn")}
                    disabled={acting === item.id}
                  >
                    <Text style={styles.actionBtnText}>Warn</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionRemove]}
                    onPress={() => confirmAction(item, "remove")}
                    disabled={acting === item.id}
                  >
                    <Text style={styles.actionBtnText}>Remove</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionEscalate]}
                    onPress={() => confirmAction(item, "escalate")}
                    disabled={acting === item.id}
                  >
                    <Text style={styles.actionBtnText}>Escalate</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={[styles.statusPill, styles[`statusPill_${item.status}` as const]]}>
                  <Text style={styles.statusPillText}>{item.status.toUpperCase()}</Text>
                </View>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  filterBar: { flexDirection: "row", gap: 8, flexWrap: "wrap", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
  },
  filterChipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  filterChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  filterChipTextActive: { color: "#fff", fontWeight: "600" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 14, gap: 10 },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  card: {
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 10,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  contentTypeBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, backgroundColor: "#B91C1C",
  },
  contentTypeBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  timeText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  snapshot: { fontSize: 13, color: colors.textDark, fontStyle: "italic", marginBottom: 6, fontFamily: "Inter_400Regular" },
  reason: { fontSize: 12, color: colors.textMid, marginBottom: 2, fontFamily: "Inter_500Medium" },
  reporter: { fontSize: 11, color: colors.textMuted, marginBottom: 8, fontFamily: "Inter_400Regular" },
  posterRow: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.03)", marginTop: 4, marginBottom: 10,
  },
  posterAvatar: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryGreen,
    alignItems: "center", justifyContent: "center",
  },
  posterAvatarText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  posterName: { fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  posterHistory: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  msgIconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(29,158,117,0.08)" },
  actionsRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  actionBtn: { flex: 1, minWidth: 70, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  actionBtnText: { fontSize: 11, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  actionDismiss: { backgroundColor: colors.textMuted },
  actionWarn: { backgroundColor: "#D97706" },
  actionRemove: { backgroundColor: "#B91C1C" },
  actionEscalate: { backgroundColor: colors.primaryGreen },
  statusPill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusPillText: { fontSize: 11, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  statusPill_warned: { backgroundColor: "#D97706" },
  statusPill_removed: { backgroundColor: "#B91C1C" },
  statusPill_escalated: { backgroundColor: colors.primaryGreen },
  statusPill_dismissed: { backgroundColor: colors.textMuted },
});
