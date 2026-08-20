import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  FlatList, Image, KeyboardAvoidingView, Platform, Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useData, ComposeUserSearchResult, ComposeDepartment } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const DEPARTMENT_OPTIONS: { value: ComposeDepartment; label: string }[] = [
  { value: "support_help", label: "Support & Help" },
  { value: "crisis_safeguarding", label: "Crisis & Safeguarding" },
  { value: "account_security", label: "Account & Security" },
  { value: "report_user", label: "Report a User" },
  { value: "feedback_suggestions", label: "Feedback & Suggestions" },
  { value: "general_contact", label: "General Contact" },
];

const MAX_BODY_LENGTH = 2000;

interface ComposeMessageModalProps {
  visible: boolean;
  onClose: () => void;
  onSent: () => void;
}

// Compose lives entirely inside the Email Inbox screen as a modal — the
// admin never navigates away to send mail, matching the "everything from
// the Email" requirement this was built under. All the actual send logic
// (find-or-create the P2P Global <-> user conversation, derive the sending
// identity from department, persist subject/department/sent_by_admin_id)
// happens server-side in officialMessages.ts; this is purely the form.
export function ComposeMessageModal({ visible, onClose, onSent }: ComposeMessageModalProps) {
  const { searchUsersForCompose, sendOfficialMessage } = useData();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ComposeUserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ComposeUserSearchResult | null>(null);

  const [department, setDepartment] = useState<ComposeDepartment | null>(null);
  const [showDeptPicker, setShowDeptPicker] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentOk, setSentOk] = useState(false);

  const resetForm = useCallback(() => {
    setSentOk(false);
    setSelectedUser(null);
    setQuery("");
    setResults([]);
    setDepartment(null);
    setShowDeptPicker(false);
    setSubject("");
    setBody("");
    setSendError(null);
    setSending(false);
  }, []);

  // Fresh form every time the modal opens, so a previous send's state never
  // leaks into the next one.
  useEffect(() => { if (visible) resetForm(); }, [visible, resetForm]);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchUsersForCompose(query);
      if (!cancelled) { setResults(r); setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, searchUsersForCompose]);

  const canSend = !!selectedUser && !!department && subject.trim().length >= 3 && body.trim().length >= 5 && !sending;

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedUser || !department || sending) return;
    setSending(true);
    setSendError(null);
    const result = await sendOfficialMessage({
      targetUserId: selectedUser.userId, department, subject: subject.trim(), body: body.trim(),
    });
    setSending(false);
    if (result.success) {
      setSentOk(true);
      onSent();
    } else {
      setSendError(result.error ?? "Message could not be sent. Please try again.");
    }
  }, [canSend, sending, selectedUser, department, subject, body, sendOfficialMessage, onSent]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Compose</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={colors.textDark} />
            </TouchableOpacity>
          </View>

          {sentOk && selectedUser ? (
            <View style={styles.centerFill}>
              <Ionicons name="checkmark-circle" size={44} color={colors.accentGreen} />
              <Text style={styles.confirmTitle}>Message sent</Text>
              <Text style={styles.confirmSub}>@{selectedUser.username} will see this in their Messages, clearly marked as coming from P2P Global.</Text>
              <TouchableOpacity style={styles.sendBtn} onPress={resetForm}>
                <Text style={styles.sendBtnText}>Compose Another</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkBtn} onPress={onClose}>
                <Text style={styles.linkBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={[]}
              keyExtractor={() => "x"}
              renderItem={null}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <View style={styles.form}>
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>FROM</Text>
                    <View style={styles.fromRow}>
                      <View style={styles.fromIconWrap}><Ionicons name="checkmark-circle" size={16} color="#fff" /></View>
                      <Text style={styles.fromText}>P2P Global</Text>
                    </View>
                  </View>

                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>TO</Text>
                    {selectedUser ? (
                      <View style={styles.selectedUserRow}>
                        {selectedUser.photoUrl ? (
                          <Image source={{ uri: selectedUser.photoUrl }} style={styles.avatar} />
                        ) : (
                          <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={16} color={colors.textMuted} /></View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.selectedUserHandle}>@{selectedUser.username}</Text>
                          <Text style={styles.selectedUserName}>{selectedUser.fullName ?? "—"}</Text>
                          {selectedUser.email && <Text style={styles.selectedUserEmail}>{selectedUser.email}</Text>}
                        </View>
                        <TouchableOpacity onPress={() => setSelectedUser(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <>
                        <View style={styles.searchBar}>
                          <Ionicons name="search" size={16} color={colors.textMuted} />
                          <TextInput
                            style={styles.searchInput}
                            value={query}
                            onChangeText={setQuery}
                            placeholder="Search user by name, username or email"
                            placeholderTextColor={colors.textMuted}
                            autoCapitalize="none"
                          />
                          {searching && <ActivityIndicator size="small" color={colors.accentGreen} />}
                        </View>
                        {results.map((item) => (
                          <TouchableOpacity
                            key={item.userId}
                            style={styles.resultRow}
                            onPress={() => { setSelectedUser(item); setQuery(""); setResults([]); }}
                          >
                            {item.photoUrl ? (
                              <Image source={{ uri: item.photoUrl }} style={styles.avatar} />
                            ) : (
                              <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={16} color={colors.textMuted} /></View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={styles.selectedUserHandle}>@{item.username}</Text>
                              <Text style={styles.selectedUserName}>{item.fullName ?? "—"}</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </>
                    )}
                  </View>

                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>DEPARTMENT</Text>
                    <TouchableOpacity style={styles.deptSelector} onPress={() => setShowDeptPicker((v) => !v)}>
                      <Text style={department ? styles.deptSelectorText : styles.deptSelectorPlaceholder}>
                        {department ? DEPARTMENT_OPTIONS.find((d) => d.value === department)?.label : "Select department"}
                      </Text>
                      <Ionicons name={showDeptPicker ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                    {showDeptPicker && (
                      <View style={styles.deptOptionsBox}>
                        {DEPARTMENT_OPTIONS.map((opt) => (
                          <TouchableOpacity
                            key={opt.value}
                            style={styles.deptOptionRow}
                            onPress={() => { setDepartment(opt.value); setShowDeptPicker(false); }}
                          >
                            <Text style={styles.deptOptionText}>{opt.label}</Text>
                            {department === opt.value && <Ionicons name="checkmark" size={16} color={colors.accentGreen} />}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>

                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>SUBJECT</Text>
                    <TextInput
                      style={styles.input}
                      value={subject}
                      onChangeText={setSubject}
                      placeholder="Subject"
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>

                  <View style={styles.section}>
                    <View style={styles.messageLabelRow}>
                      <Text style={styles.sectionLabel}>MESSAGE</Text>
                      <Text style={styles.charCount}>{body.length}/{MAX_BODY_LENGTH}</Text>
                    </View>
                    <TextInput
                      style={[styles.input, styles.textarea]}
                      value={body}
                      onChangeText={(t) => setBody(t.slice(0, MAX_BODY_LENGTH))}
                      placeholder="Write your message here…"
                      placeholderTextColor={colors.textMuted}
                      multiline
                      maxLength={MAX_BODY_LENGTH}
                    />
                  </View>

                  {sendError && <Text style={styles.errorText}>{sendError}</Text>}

                  <TouchableOpacity style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]} disabled={!canSend} onPress={handleSend}>
                    {sending ? (
                      <View style={styles.sendingRow}>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={styles.sendBtnText}>Sending…</Text>
                      </View>
                    ) : (
                      <Text style={styles.sendBtnText}>➤ Send Message</Text>
                    )}
                  </TouchableOpacity>
                </View>
              }
            />
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default ComposeMessageModal;

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%" },
  sheetHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
  },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  centerFill: { alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 30, paddingVertical: 40 },
  confirmTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  confirmSub: { fontSize: 13, color: colors.textMid, textAlign: "center", fontFamily: "Inter_400Regular", marginBottom: 10 },
  form: { padding: 16, paddingBottom: 30 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 8 },
  fromRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(29,158,117,0.08)", borderWidth: 1, borderColor: "rgba(29,158,117,0.25)",
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, alignSelf: "flex-start",
  },
  fromIconWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accentGreen, alignItems: "center", justifyContent: "center" },
  fromText: { fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  resultRow: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 10, marginTop: 6,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
  },
  selectedUserRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 12, padding: 10,
  },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarFallback: { backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
  selectedUserName: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  selectedUserHandle: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  selectedUserEmail: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  deptSelector: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12,
  },
  deptSelectorText: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium" },
  deptSelectorPlaceholder: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  deptOptionsBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, marginTop: 6, overflow: "hidden" },
  deptOptionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  deptOptionText: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular",
  },
  textarea: { minHeight: 100, textAlignVertical: "top" },
  messageLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  charCount: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginBottom: 8 },
  errorText: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_500Medium", marginBottom: 10 },
  sendBtn: { backgroundColor: colors.primaryGreen, borderRadius: 12, alignItems: "center", paddingVertical: 14, marginTop: 4 },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sendingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  linkBtn: { marginTop: 6, padding: 8 },
  linkBtnText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
});