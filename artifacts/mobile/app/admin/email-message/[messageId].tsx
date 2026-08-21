import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Modal, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useData, ContactAdminMessageDetail, ContactDepartment, ContactPriority,
} from "@/contexts/DataContext";
import colors from "@/constants/colors";

const DEPARTMENT_LABELS: Record<ContactDepartment, string> = {
  help_request: "Help Request", crisis_response: "Crisis Response", p2p_support: "P2P Support", marketing: "Marketing",
};
const STATUS_COLORS: Record<string, string> = {
  unread: "#888", read: "#B8860B", replied: "#1D9E75", forwarded: "#4A90D9", closed: "#555",
};
const PRIORITY_OPTIONS: ContactPriority[] = ["normal", "high", "urgent"];
const QUICK_RESPONSES = [
  "Thank you for reaching out. We are looking into this and will follow up shortly.",
  "We have received your message and it has been forwarded to the appropriate team.",
  "Could you share a bit more detail so we can help you fully?",
];

function ForwardModal({
  visible, onClose, onSubmit,
}: { visible: boolean; onClose: () => void; onSubmit: (data: { toDepartment?: ContactDepartment; toUsername?: string; note?: string }) => void }) {
  const [mode, setMode] = useState<"department" | "admin">("department");
  const [department, setDepartment] = useState<ContactDepartment>("help_request");
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Forward Message</Text>

          <View style={styles.modeRow}>
            <TouchableOpacity style={[styles.modeChip, mode === "department" && styles.modeChipActive]} onPress={() => setMode("department")}>
              <Text style={[styles.modeChipText, mode === "department" && styles.modeChipTextActive]}>To Department</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeChip, mode === "admin" && styles.modeChipActive]} onPress={() => setMode("admin")}>
              <Text style={[styles.modeChipText, mode === "admin" && styles.modeChipTextActive]}>To Admin (@username)</Text>
            </TouchableOpacity>
          </View>

          {mode === "department" ? (
            <View style={styles.deptPickRow}>
              {(Object.keys(DEPARTMENT_LABELS) as ContactDepartment[]).map((d) => (
                <TouchableOpacity key={d} style={[styles.deptChip, department === d && styles.deptChipActive]} onPress={() => setDepartment(d)}>
                  <Text style={[styles.deptChipText, department === d && styles.deptChipTextActive]}>{DEPARTMENT_LABELS[d]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="username (without @)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
            />
          )}

          <TextInput
            style={[styles.input, styles.noteInput]}
            value={note}
            onChangeText={setNote}
            placeholder="Note for the receiving admin (optional)"
            placeholderTextColor={colors.textMuted}
            multiline
          />

          <Text style={styles.disclaimer}>The sender will NOT be notified that this message was forwarded.</Text>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalSubmitBtn}
              onPress={() => {
                if (mode === "admin" && !username.trim()) {
                  Alert.alert("Enter a username to forward to.");
                  return;
                }
                onSubmit(mode === "department" ? { toDepartment: department, note: note.trim() || undefined } : { toUsername: username.trim(), note: note.trim() || undefined });
              }}
            >
              <Text style={styles.modalSubmitText}>Forward</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function AdminEmailMessageDetail() {
  const { messageId } = useLocalSearchParams<{ messageId: string }>();
  const router = useRouter();
  const {
    getAdminContactMessage, replyToContactMessage, forwardContactMessage,
    closeContactMessage, setContactMessagePriority, setContactMessageStatus,
    starContactMessage, archiveContactMessage,
  } = useData();
  const [detail, setDetail] = useState<ContactAdminMessageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [composeText, setComposeText] = useState("");
  const [composeAsNote, setComposeAsNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [showForward, setShowForward] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!messageId) return;
    setLoading(true);
    setDetail(await getAdminContactMessage(messageId));
    setLoading(false);
  }, [messageId, getAdminContactMessage]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSend = useCallback(async () => {
    if (!messageId || composeText.trim().length === 0) return;
    setSending(true);
    const result = await replyToContactMessage(messageId, composeText.trim(), composeAsNote);
    setSending(false);
    if (result) {
      setComposeText("");
      await load();
    } else {
      Alert.alert("Failed to send. Please try again.");
    }
  }, [messageId, composeText, composeAsNote, replyToContactMessage, load]);

  const handleForward = useCallback(async (data: { toDepartment?: ContactDepartment; toUsername?: string; note?: string }) => {
    if (!messageId) return;
    setBusy(true);
    const result = await forwardContactMessage(messageId, data);
    setBusy(false);
    setShowForward(false);
    if (result) {
      Alert.alert("Message forwarded.");
      await load();
    } else {
      Alert.alert("Failed to forward. Please try again.");
    }
  }, [messageId, forwardContactMessage, load]);

  const handleClose = useCallback(() => {
    Alert.alert("Close this message?", "The sender will be asked for feedback.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Close Message", style: "destructive", onPress: async () => {
          if (!messageId) return;
          setBusy(true);
          const result = await closeContactMessage(messageId);
          setBusy(false);
          if (result) await load();
          else Alert.alert("Failed to close. Please try again.");
        },
      },
    ]);
  }, [messageId, closeContactMessage, load]);

  const handlePriority = useCallback(async (priority: ContactPriority) => {
    if (!messageId) return;
    setBusy(true);
    const result = await setContactMessagePriority(messageId, priority);
    setBusy(false);
    if (result) await load();
  }, [messageId, setContactMessagePriority, load]);

  // Navigates back immediately rather than reloading in place — reloading
  // would re-fetch via GET /contact/admin/inbox/:messageId, which flips
  // status back to "read" the moment it's viewed, undoing this action.
  const handleMarkUnread = useCallback(async () => {
    if (!messageId) return;
    setBusy(true);
    const result = await setContactMessageStatus(messageId, "unread");
    setBusy(false);
    if (result) Alert.alert("Failed to update. Please try again.");
    else router.back();
  }, [messageId, setContactMessageStatus, router]);

  const handleToggleStar = useCallback(async () => {
    if (!messageId || !detail) return;
    const next = !detail.message.isStarredByMe;
    setDetail({ ...detail, message: { ...detail.message, isStarredByMe: next } });
    await starContactMessage(messageId, next);
  }, [messageId, detail, starContactMessage]);

  const handleToggleArchive = useCallback(async () => {
    if (!messageId || !detail) return;
    setBusy(true);
    const next = !detail.message.isArchived;
    const result = await archiveContactMessage(messageId, next);
    setBusy(false);
    if (result) Alert.alert("Failed to update. Please try again.");
    else router.back();
  }, [messageId, detail, archiveContactMessage, router]);

  if (loading) {
    return <View style={[styles.container, styles.centerFill]}><ActivityIndicator color={colors.primaryGreen} /></View>;
  }
  if (!detail) {
    return <View style={[styles.container, styles.centerFill]}><Text style={styles.emptyText}>Message not found.</Text></View>;
  }

  const { message, replies, notes } = detail;
  const timeline = [
    ...replies.map((r) => ({ kind: "reply" as const, at: r.createdAt, item: r })),
    ...notes.map((n) => ({ kind: "note" as const, at: n.createdAt, item: n })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{message.subject}</Text>
        <TouchableOpacity onPress={handleToggleStar} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name={message.isStarredByMe ? "star" : "star-outline"} size={20} color={message.isStarredByMe ? colors.amber : colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        <View style={styles.badgeRow}>
          <View style={[styles.statusBadge, { backgroundColor: `${STATUS_COLORS[message.status]}22` }]}>
            <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[message.status] }]}>{message.status}</Text>
          </View>
          <Text style={styles.reference}>{message.referenceNumber}</Text>
          <Text style={styles.metaDate}>{new Date(message.createdAt).toLocaleString()}</Text>
        </View>

        <TouchableOpacity style={styles.senderCard} onPress={() => message.fromUsername && router.push(`/profile/${message.fromUsername}` as any)}>
          <View style={styles.senderTopRow}>
            <Text style={styles.senderName}>{message.fromDisplayName}</Text>
            {message.fromIsVerified && <Ionicons name="checkmark-circle" size={14} color={colors.accentGreen} />}
          </View>
          <Text style={styles.senderUsername}>@{message.fromUsername ?? "unknown"}</Text>
          <View style={styles.snapshotGrid}>
            <Text style={styles.snapshotItem}>🌍 {message.fromCountry ?? "Unknown"}</Text>
            <Text style={styles.snapshotItem}>⛪ {(message.fromMinistryRole ?? "believer").replace(/_/g, " ")}</Text>
            <Text style={styles.snapshotItem}>🌳 {message.fromTreeStage}</Text>
            <Text style={styles.snapshotItem}>📚 {message.fromModulesCompleted} modules</Text>
            <Text style={styles.snapshotItem}>📅 {message.fromAccountAgeDays ?? 0}d on P2P</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.priorityRow}>
          <Text style={styles.priorityLabel}>Priority:</Text>
          {PRIORITY_OPTIONS.map((p) => (
            <TouchableOpacity key={p} disabled={busy} style={[styles.priorityChip, message.priority === p && styles.priorityChipActive]} onPress={() => handlePriority(p)}>
              <Text style={[styles.priorityChipText, message.priority === p && styles.priorityChipTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.originalCard}>
          <Text style={styles.originalLabel}>ORIGINAL MESSAGE</Text>
          <Text style={styles.originalBody}>{message.body}</Text>
        </View>

        {timeline.length > 0 && (
          <>
            <Text style={styles.threadLabel}>THREAD</Text>
            {timeline.map((entry) => (
              <View key={entry.item.id} style={[styles.threadCard, entry.kind === "note" && styles.noteCard]}>
                <View style={styles.threadTopRow}>
                  <Text style={[styles.threadFrom, entry.kind === "note" && styles.noteFrom]}>
                    {entry.kind === "note" ? "🔒 Internal note" : `@${entry.item.fromAdminUsername ?? "admin"}`}
                  </Text>
                  <Text style={styles.threadDate}>{new Date(entry.at).toLocaleString()}</Text>
                </View>
                <Text style={styles.threadBody}>{entry.kind === "note" ? entry.item.noteText : entry.item.body}</Text>
              </View>
            ))}
          </>
        )}

        <View style={styles.quickRow}>
          {QUICK_RESPONSES.map((q, i) => (
            <TouchableOpacity key={i} style={styles.quickChip} onPress={() => setComposeText(q)}>
              <Text style={styles.quickChipText} numberOfLines={1}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.composeCard}>
          <View style={styles.composeToggleRow}>
            <TouchableOpacity style={[styles.composeToggle, !composeAsNote && styles.composeToggleActive]} onPress={() => setComposeAsNote(false)}>
              <Text style={[styles.composeToggleText, !composeAsNote && styles.composeToggleTextActive]}>Reply to sender</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.composeToggle, composeAsNote && styles.composeToggleActive]} onPress={() => setComposeAsNote(true)}>
              <Text style={[styles.composeToggleText, composeAsNote && styles.composeToggleTextActive]}>🔒 Internal note</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.composeInput}
            value={composeText}
            onChangeText={setComposeText}
            placeholder={composeAsNote ? "Note visible to admins only..." : "Write a reply to the sender..."}
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, (sending || composeText.trim().length === 0) && styles.sendBtnDisabled]}
            disabled={sending || composeText.trim().length === 0}
            onPress={handleSend}
          >
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendBtnText}>{composeAsNote ? "Add Note" : "Send Reply"}</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} disabled={busy} onPress={handleMarkUnread}>
            <Ionicons name="mail-unread-outline" size={16} color={colors.textDark} />
            <Text style={styles.actionBtnText}>Mark Unread</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} disabled={busy} onPress={() => setShowForward(true)}>
            <Ionicons name="arrow-redo" size={16} color={colors.textDark} />
            <Text style={styles.actionBtnText}>Forward</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} disabled={busy} onPress={handleToggleArchive}>
            <Ionicons name={message.isArchived ? "arrow-undo-outline" : "archive-outline"} size={16} color={colors.textDark} />
            <Text style={styles.actionBtnText}>{message.isArchived ? "Unarchive" : "Archive"}</Text>
          </TouchableOpacity>
          {message.status !== "closed" && (
            <TouchableOpacity style={[styles.actionBtn, styles.closeBtn]} disabled={busy} onPress={handleClose}>
              <Ionicons name="checkmark-done" size={16} color="#fff" />
              <Text style={[styles.actionBtnText, { color: "#fff" }]}>Close</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <ForwardModal visible={showForward} onClose={() => setShowForward(false)} onSubmit={handleForward} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.textMuted, fontFamily: "Inter_400Regular" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 50, paddingBottom: 12 },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginHorizontal: 8 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", textTransform: "capitalize" },
  reference: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  metaDate: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  senderCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 14, padding: 14, marginBottom: 12 },
  senderTopRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  senderName: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  senderUsername: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginBottom: 8 },
  snapshotGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  snapshotItem: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_400Regular" },
  priorityRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  priorityLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  priorityChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  priorityChipActive: { backgroundColor: colors.textDark, borderColor: colors.textDark },
  priorityChipText: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  priorityChipTextActive: { color: "#fff", fontWeight: "700" },
  originalCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 14, padding: 16, marginBottom: 16 },
  originalLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 8 },
  originalBody: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 21 },
  threadLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 8 },
  threadCard: { backgroundColor: "rgba(29,158,117,0.06)", borderWidth: 1, borderColor: "rgba(29,158,117,0.2)", borderRadius: 14, padding: 14, marginBottom: 10 },
  noteCard: { backgroundColor: "rgba(184,134,11,0.08)", borderColor: "rgba(184,134,11,0.25)" },
  threadTopRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  threadFrom: { fontSize: 12, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  noteFrom: { color: "#B8860B" },
  threadDate: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  threadBody: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
  quickRow: { gap: 6, marginBottom: 10 },
  quickChip: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  quickChipText: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_400Regular" },
  composeCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 14, padding: 12, marginBottom: 14 },
  composeToggleRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  composeToggle: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige },
  composeToggleActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  composeToggleText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  composeToggleTextActive: { color: "#fff", fontWeight: "700" },
  composeInput: { minHeight: 70, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", textAlignVertical: "top", marginBottom: 10 },
  sendBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, alignItems: "center", paddingVertical: 11 },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  actionBtnText: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  closeBtn: { backgroundColor: colors.textDark, borderColor: colors.textDark },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  modeRow: { flexDirection: "row", gap: 8 },
  modeChip: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  modeChipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  modeChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  modeChipTextActive: { color: "#fff", fontWeight: "700" },
  deptPickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  deptChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  deptChipActive: { backgroundColor: colors.textDark, borderColor: colors.textDark },
  deptChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  deptChipTextActive: { color: "#fff", fontWeight: "700" },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  noteInput: { minHeight: 70, textAlignVertical: "top" },
  disclaimer: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalCancelBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  modalCancelText: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  modalSubmitBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, backgroundColor: colors.primaryGreen },
  modalSubmitText: { fontSize: 13, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
});