import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useData, HelpRequest, HelpRequestTier, HelpRequestStatus } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";

const TIER_FILTERS: Array<{ value: HelpRequestTier | "all"; label: string }> = [
  { value: "all", label: "All Tiers" },
  { value: "crisis", label: "Crisis" },
  { value: "struggling", label: "Struggling" },
];

const STATUS_FILTERS: Array<{ value: HelpRequestStatus | "all"; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "open", label: "Open" },
  { value: "contacted", label: "Contacted" },
  { value: "resolved", label: "Resolved" },
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

export default function HelpRequestsScreen() {
  const { getHelpRequests, updateHelpRequestStatus } = useData();
  const { supabase, user } = useAuth();
  const router = useRouter();
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [messaging, setMessaging] = useState<string | null>(null);
  const [calling, setCalling] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<HelpRequestTier | "all">("all");
  const [statusFilter, setStatusFilter] = useState<HelpRequestStatus | "all">("all");

  // Best-effort — the DM/call itself already succeeded by the time this
  // runs, so a failure here (e.g. flaky network) shouldn't block the admin;
  // it just means the crisis thread banner won't show on this particular
  // conversation.
  async function linkConversationToHelpRequest(reqId: string, conversationId: string) {
    try {
      await authedFetch(`/admin/help-requests/${reqId}/link-conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
    } catch (e) {
      console.error("linkConversationToHelpRequest failed", e);
    }
  }

  async function handleMessageThem(req: HelpRequest) {
    if (!req.userId) {
      Alert.alert("Account removed", "This user's account no longer exists and cannot be messaged.");
      return;
    }
    setMessaging(req.id);
    try {
      const { data, error } = await supabase.rpc("p2p_start_direct_conversation", { target_id: req.userId });
      if (error || !data) {
        console.error("p2p_start_direct_conversation failed", error);
        Alert.alert("Couldn't start conversation", error?.message ?? "Please try again.");
        return;
      }
      await linkConversationToHelpRequest(req.id, data as string);
      router.push(`/messages/${data}` as any);
    } catch (e: any) {
      console.error("handleMessageThem threw", e);
      Alert.alert("Couldn't start conversation", e?.message ?? "A network error occurred. Please try again.");
    } finally {
      setMessaging(null);
    }
  }

  async function handleCallThem(req: HelpRequest) {
    if (!req.userId) {
      Alert.alert("Account removed", "This user's account no longer exists and cannot be called.");
      return;
    }
    if (!user) return;
    setCalling(req.id);
    try {
      // Reuse the same eligibility check messaging uses (super_admin, or
      // church_leader/regional_admin/moderator/peer_guide/admin_help
      // responding to a help request — see migration 078) — /calls/start
      // itself trusts the caller-supplied ids with no permission check of
      // its own, so this RPC is the only gate.
      const { data: conversationId, error: convErr } = await supabase.rpc("p2p_start_direct_conversation", { target_id: req.userId });
      if (convErr || !conversationId) {
        console.error("p2p_start_direct_conversation failed", convErr);
        Alert.alert("Couldn't start call", convErr?.message ?? "Please try again.");
        return;
      }

      const apiUrl = getApiUrl();
      const channelRes = await fetch(`${apiUrl}/calls/peer-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentUserId: user.id, otherUserId: req.userId }),
      });
      const channelData = await channelRes.json();
      if (!channelRes.ok) throw new Error(channelData.error || "Failed to start call");
      const channelName = channelData.channelName as string;

      const startRes = await fetch(`${apiUrl}/calls/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelName, callType: "audio", callerId: user.id, recipientId: req.userId, conversationId,
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || "Failed to start call");

      await linkConversationToHelpRequest(req.id, conversationId as string);
      router.push({
        pathname: "/call/audio",
        params: {
          channelName,
          otherUserId: req.userId,
          otherUserName: req.userName || "this user",
          callType: "audio",
          isInitiator: "true",
          callId: startData.incomingCallId,
          conversationId,
          callLogId: startData.callLogId,
        },
      } as any);
    } catch (e: any) {
      console.error("handleCallThem threw", e);
      Alert.alert("Couldn't start call", e?.message ?? "Please try again.");
    } finally {
      setCalling(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getHelpRequests({
      tier: tierFilter === "all" ? undefined : tierFilter,
      status: statusFilter === "all" ? undefined : statusFilter,
    });
    setRequests(data);
    setLoading(false);
  }, [getHelpRequests, tierFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function cycleStatus(req: HelpRequest) {
    const next: HelpRequestStatus = req.status === "open" ? "contacted" : req.status === "contacted" ? "resolved" : "open";
    setRequests((prev) => prev.map((r) => (r.id === req.id ? { ...r, status: next } : r)));
    await updateHelpRequestStatus(req.id, next);

    if (next === "resolved" && req.userId) {
      try {
        await authedFetch("/admin/activity/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionType: "case_resolved", targetUserId: req.userId, targetResourceId: req.id, targetResourceType: "help_request" }),
        });
        const { data: conv } = await supabase
          .from("p2p_conversations")
          .select("id")
          .eq("help_request_id", req.id)
          .maybeSingle();
        if (conv?.id) {
          await fetch(`${getApiUrl()}/feedback/request`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: conv.id, peerUserId: req.userId }),
          });
        }
      } catch (e) {
        console.error("feedback request trigger failed", e);
      }
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        <View style={styles.filterGroup}>
          {TIER_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.value}
              style={[styles.filterChip, tierFilter === f.value && styles.filterChipActive]}
              onPress={() => setTierFilter(f.value)}
            >
              <Text style={[styles.filterChipText, tierFilter === f.value && styles.filterChipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.filterGroup}>
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
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No help requests match these filters.</Text>}
          renderItem={({ item }) => (
            <View style={[styles.card, item.tier === "crisis" && styles.cardCrisis]}>
              <View style={styles.cardHeader}>
                <View style={[styles.tierBadge, item.tier === "crisis" ? styles.tierBadgeCrisis : styles.tierBadgeStruggling]}>
                  <Ionicons name={item.tier === "crisis" ? "alert-circle" : "hand-left"} size={12} color="#fff" />
                  <Text style={styles.tierBadgeText}>{item.tier === "crisis" ? "CRISIS" : "Struggling"}</Text>
                </View>
                <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
              </View>
              <Text style={[styles.userName, !item.userId && { color: colors.textMuted, fontStyle: "italic" }]}>
                {item.userName || "Creator no longer available"}
              </Text>
              {item.category && <Text style={styles.category}>Category: {item.category}</Text>}
              {item.note && <Text style={styles.note}>{item.note}</Text>}
              <TouchableOpacity style={[styles.statusBtn, styles[`status_${item.status}` as const]]} onPress={() => cycleStatus(item)}>
                <Text style={styles.statusBtnText}>{item.status.toUpperCase()} · tap to advance</Text>
              </TouchableOpacity>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.messageBtn, styles.actionBtnHalf]}
                  onPress={() => handleMessageThem(item)}
                  disabled={messaging === item.id || calling === item.id}
                >
                  {messaging === item.id ? (
                    <ActivityIndicator size="small" color={colors.accentGreen} />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-outline" size={14} color={colors.accentGreen} />
                      <Text style={styles.messageBtnText}>Message them</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.callBtn, styles.actionBtnHalf]}
                  onPress={() => handleCallThem(item)}
                  disabled={messaging === item.id || calling === item.id}
                >
                  {calling === item.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="call-outline" size={14} color="#fff" />
                      <Text style={styles.callBtnText}>Call</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  filterBar: { padding: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  filterGroup: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
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
  cardCrisis: { borderColor: "#B91C1C", borderWidth: 1.5 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  tierBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tierBadgeCrisis: { backgroundColor: "#B91C1C" },
  tierBadgeStruggling: { backgroundColor: colors.accentGreen },
  tierBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  timeText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  userName: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  category: { fontSize: 12, color: colors.textMid, marginTop: 4, fontFamily: "Inter_500Medium" },
  note: { fontSize: 13, color: colors.textMid, marginTop: 6, lineHeight: 18, fontFamily: "Inter_400Regular" },
  statusBtn: { marginTop: 10, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  statusBtnText: { fontSize: 11, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  actionBtnHalf: { flex: 1, marginTop: 0 },
  messageBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: colors.accentGreen, backgroundColor: "rgba(29,158,117,0.06)",
  },
  messageBtnText: { fontSize: 12, fontWeight: "600", color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  callBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 8, borderRadius: 8,
    backgroundColor: colors.accentGreen,
  },
  callBtnText: { fontSize: 12, fontWeight: "600", color: "#fff", fontFamily: "Inter_600SemiBold" },
  status_open: { backgroundColor: "#B91C1C" },
  status_contacted: { backgroundColor: "#D97706" },
  status_resolved: { backgroundColor: colors.accentGreen },
});
