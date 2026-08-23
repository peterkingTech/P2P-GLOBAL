import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useData, OfficialMailThreadMessage, ComposeDepartment } from "@/contexts/DataContext";
import { useAuth, type OfficialAccountType } from "@/contexts/AuthContext";
import { OfficialBadge } from "@/components/OfficialBadge";
import { authedFetch } from "@/lib/adminFetch";
import { startPeerCall, buildCallRouteParams } from "@/lib/callStart";
import colors from "@/constants/colors";

// Help-request tier -> the P2P Official identity that responds, matching
// DEPARTMENT_TO_OFFICIAL_TYPE in officialMessages.ts (crisis_safeguarding ->
// crisis_response, support_help -> support).
const TIER_CONFIG: Record<"crisis" | "struggling", {
  officialType: OfficialAccountType; department: ComposeDepartment; defaultSubject: string; label: string; color: string;
}> = {
  crisis: { officialType: "crisis_response", department: "crisis_safeguarding", defaultSubject: "Response to your crisis help request", label: "CRISIS", color: "#B91C1C" },
  struggling: { officialType: "support", department: "support_help", defaultSubject: "Response to your help request", label: "STRUGGLING", color: colors.accentGreen },
};

// Official mail thread for a Help Request — replaces the old personal-DM
// "Message them" flow. Peer sees this branded "P2P Official," never the
// individual admin's identity (peer reads/replies via the ordinary
// app/messages/[id].tsx screen, which is a real conversation member; call
// buttons are hidden there for any official-account conversation). Admin
// isn't a conversation member, so this screen is the only place an admin
// can read/reply — Call here starts a REAL personal call exactly like the
// Help Requests list's Call button, unrelated to the official text thread.
export default function HelpMailThreadScreen() {
  const { helpRequestId, targetUserId, targetUserName, tier } = useLocalSearchParams<{
    helpRequestId: string; targetUserId: string; targetUserName: string; tier: string;
  }>();
  const router = useRouter();
  const { supabase, user } = useAuth();
  const { getOfficialMailThreadWithUser, sendOfficialMessage } = useData();

  const config = TIER_CONFIG[tier === "crisis" ? "crisis" : "struggling"];

  const [messages, setMessages] = useState<OfficialMailThreadMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);

  const load = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    const thread = await getOfficialMailThreadWithUser(targetUserId, config.officialType);
    setMessages(thread.messages);
    setConversationId(thread.conversationId);
    setSubject(thread.subject);
    setLoading(false);
  }, [targetUserId, config.officialType, getOfficialMailThreadWithUser]);

  useEffect(() => { load(); }, [load]);

  async function linkToHelpRequest(newConversationId: string) {
    if (!helpRequestId) return;
    try {
      await authedFetch(`/admin/help-requests/${helpRequestId}/link-conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: newConversationId }),
      });
    } catch (e) {
      console.error("link-conversation failed", e);
    }
  }

  async function handleSend() {
    const trimmed = body.trim();
    if (!trimmed || !targetUserId || sending) return;
    setSending(true);
    const wasFirstMessage = !conversationId;
    const result = await sendOfficialMessage({
      targetUserId, department: config.department,
      subject: subject ?? config.defaultSubject, body: trimmed,
    });
    setSending(false);
    if (!result.success) {
      Alert.alert("Message not sent", result.error ?? "Please try again.");
      return;
    }
    setBody("");
    if (wasFirstMessage && result.conversationId) {
      await linkToHelpRequest(result.conversationId);
    }
    await load();
  }

  async function handleCall() {
    if (!targetUserId || !user || calling) return;
    setCalling(true);
    try {
      const result = await startPeerCall({
        supabase, currentUserId: user.id, otherUserId: targetUserId,
        onAlert: (title, message) => Alert.alert(title, message),
      });
      if (!result) return;

      await linkToHelpRequest(result.conversationId);
      router.push({
        pathname: "/call/audio",
        params: buildCallRouteParams({
          channelName: result.channelName, otherUserId: targetUserId, otherUserName: targetUserName || "this user",
          callId: result.incomingCallId, conversationId: result.conversationId, callLogId: result.callLogId,
        }),
      } as any);
    } finally {
      setCalling(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{targetUserName || "Peer"}</Text>
          <View style={[styles.tierBadge, { backgroundColor: config.color }]}>
            <Text style={styles.tierBadgeText}>{config.label}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleCall} disabled={calling} style={styles.callBtn}>
          {calling ? <ActivityIndicator size="small" color={colors.accentGreen} /> : <Ionicons name="call-outline" size={20} color={colors.accentGreen} />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No messages yet. Send the first official mail below.</Text>}
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.isFromOfficial && styles.bubbleRowMine]}>
              <View style={styles.bubbleStack}>
                {item.isFromOfficial && (
                  <View style={styles.officialRow}>
                    <OfficialBadge accountType={config.officialType} size="small" />
                    {item.sentByAdminUsername && <Text style={styles.officialAdmin}>via @{item.sentByAdminUsername}</Text>}
                  </View>
                )}
                <View style={[styles.bubble, item.isFromOfficial ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, item.isFromOfficial && styles.bubbleTextMine]}>{item.body}</Text>
                </View>
              </View>
            </View>
          )}
        />
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={body}
          onChangeText={setBody}
          placeholder="Write your official reply…"
          placeholderTextColor={colors.textMuted}
          multiline
        />
        <TouchableOpacity style={[styles.sendBtn, (sending || !body.trim()) && styles.sendBtnDisabled]} onPress={handleSend} disabled={sending || !body.trim()}>
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingTop: 50, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  tierBadge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  tierBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
  callBtn: { padding: 6, width: 34, alignItems: "center" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleStack: { maxWidth: "78%" },
  officialRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, justifyContent: "flex-end" },
  officialAdmin: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTheirs: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  bubbleMine: { backgroundColor: colors.accentGreen },
  bubbleText: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  bubbleTextMine: { color: "#fff" },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: colors.borderBeige,
  },
  input: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
    maxHeight: 100, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.accentGreen, alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.5 },
});