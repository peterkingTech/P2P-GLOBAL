import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  FlatList, Image, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useData, UsernameSearchResult } from "@/contexts/DataContext";
import { OfficialAccountType } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

const TYPE_INFO: Record<OfficialAccountType, { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; description: string }> = {
  crisis_response: { icon: "shield-checkmark", color: "#1D9E75", label: "Crisis Response", description: "Safeguarding, urgent welfare, crisis follow-up" },
  announcement: { icon: "megaphone", color: "#B8860B", label: "Announcements", description: "Community announcements, feature updates" },
  support: { icon: "help-circle", color: "#1D9E75", label: "Support", description: "Support follow-up, account help" },
  general: { icon: "checkmark-circle", color: "#1D9E75", label: "P2P Global", description: "Account notices, warnings, administrative information" },
};

export default function AdminSendMessage() {
  const { searchUsersByUsername, getOfficialMessageAllowedTypes, sendOfficialMessage } = useData();

  const [allowedTypes, setAllowedTypes] = useState<OfficialAccountType[]>([]);
  const [officialType, setOfficialType] = useState<OfficialAccountType | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UsernameSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UsernameSearchResult | null>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentOk, setSentOk] = useState(false);

  useEffect(() => {
    getOfficialMessageAllowedTypes().then((types) => {
      setAllowedTypes(types);
      if (types.length === 1) setOfficialType(types[0]);
    });
  }, [getOfficialMessageAllowedTypes]);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchUsersByUsername(query);
      if (!cancelled) { setResults(r); setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, searchUsersByUsername]);

  const canSend = !!selectedUser && !!officialType && subject.trim().length >= 3 && body.trim().length >= 5 && !sending;

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedUser || !officialType) return;
    setSending(true);
    setSendError(null);
    const result = await sendOfficialMessage({
      targetUserId: selectedUser.userId, officialAccountType: officialType,
      subject: subject.trim(), body: body.trim(),
    });
    setSending(false);
    if (result.success) {
      setSentOk(true);
    } else {
      setSendError(result.error ?? "Message could not be sent. Please try again.");
    }
  }, [canSend, selectedUser, officialType, subject, body, sendOfficialMessage]);

  const resetForm = useCallback(() => {
    setSentOk(false);
    setSelectedUser(null);
    setQuery("");
    setResults([]);
    setSubject("");
    setBody("");
    setSendError(null);
  }, []);

  if (sentOk && selectedUser) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <Ionicons name="checkmark-circle" size={48} color={colors.accentGreen} />
        <Text style={styles.confirmTitle}>Message sent</Text>
        <Text style={styles.confirmSub}>@{selectedUser.username} will see this in their Messages, clearly marked as coming from P2P Global.</Text>
        <TouchableOpacity style={styles.sendBtn} onPress={resetForm}>
          <Text style={styles.sendBtnText}>Send Another Message</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Send Official Message</Text>
        <Text style={styles.headerSub}>Proactively message a user as P2P Global — separate from replying to a Contact P2P Global request.</Text>
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
              <Text style={styles.selectedUserName}>{selectedUser.fullName ?? selectedUser.username}</Text>
              <Text style={styles.selectedUserHandle}>@{selectedUser.username}</Text>
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
                placeholder="Search by username or name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
              />
              {searching && <ActivityIndicator size="small" color={colors.accentGreen} />}
            </View>
            {results.length > 0 && (
              <View style={styles.resultsBox}>
                <FlatList
                  data={results}
                  keyExtractor={(u) => u.userId}
                  scrollEnabled={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.resultRow} onPress={() => { setSelectedUser(item); setQuery(""); setResults([]); }}>
                      {item.photoUrl ? (
                        <Image source={{ uri: item.photoUrl }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={16} color={colors.textMuted} /></View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedUserName}>{item.fullName ?? item.username}</Text>
                        <Text style={styles.selectedUserHandle}>@{item.username}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>SEND AS</Text>
        <View style={styles.typeRow}>
          {allowedTypes.map((t) => {
            const info = TYPE_INFO[t];
            const active = officialType === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, active && { backgroundColor: info.color, borderColor: info.color }]}
                onPress={() => setOfficialType(t)}
              >
                <Ionicons name={info.icon} size={13} color={active ? "#fff" : info.color} />
                <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{info.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {officialType && <Text style={styles.typeDescription}>{TYPE_INFO[officialType].description}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>SUBJECT</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="Brief subject line"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>MESSAGE</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={body}
          onChangeText={setBody}
          placeholder="Write the message the user will receive..."
          placeholderTextColor={colors.textMuted}
          multiline
        />
      </View>

      {sendError && <Text style={styles.errorText}>{sendError}</Text>}

      <TouchableOpacity style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]} disabled={!canSend} onPress={handleSend}>
        {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendBtnText}>Send Message</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream, padding: 16 },
  centerFill: { alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 30 },
  confirmTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  confirmSub: { fontSize: 13, color: colors.textMid, textAlign: "center", fontFamily: "Inter_400Regular", marginBottom: 10 },
  header: { marginBottom: 16 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 8 },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  resultsBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, marginTop: 6, overflow: "hidden" },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  selectedUserRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 12, padding: 10,
  },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarFallback: { backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
  selectedUserName: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  selectedUserHandle: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
  },
  typeChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  typeChipTextActive: { color: "#fff", fontWeight: "700" },
  typeDescription: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular",
  },
  textarea: { minHeight: 110, textAlignVertical: "top" },
  errorText: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_500Medium", marginBottom: 10 },
  sendBtn: { backgroundColor: colors.primaryGreen, borderRadius: 12, alignItems: "center", paddingVertical: 14, marginTop: 4 },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});