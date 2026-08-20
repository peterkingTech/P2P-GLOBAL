import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useData, SentOfficialMessage, ComposeDepartment } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const DEPARTMENT_LABELS: Record<ComposeDepartment, string> = {
  support_help: "Support & Help",
  crisis_safeguarding: "Crisis & Safeguarding",
  account_security: "Account & Security",
  report_user: "Report a User",
  feedback_suggestions: "Feedback & Suggestions",
  general_contact: "General Contact",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminSentMessages() {
  const router = useRouter();
  const { getSentOfficialMessages } = useData();
  const [messages, setMessages] = useState<SentOfficialMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setMessages(await getSentOfficialMessages());
    setLoading(false);
  }, [getSentOfficialMessages]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sent Messages</Text>
        <TouchableOpacity style={styles.composeBtn} onPress={() => router.push("/admin/send-message" as any)}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.composeBtnText}>Compose</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No official messages sent yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <Text style={styles.recipientText}>
                  To @{item.recipientUsername ?? "unknown"}{item.recipientFullName ? ` · ${item.recipientFullName}` : ""}
                </Text>
                <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
              </View>
              <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
              <Text style={styles.preview} numberOfLines={1}>{item.bodyPreview}</Text>
              <View style={styles.tagsRow}>
                <Text style={styles.deptTag}>{DEPARTMENT_LABELS[item.department]}</Text>
                <Text style={[styles.readTag, item.isRead ? styles.readTagRead : styles.readTagUnread]}>
                  {item.isRead ? "✓ Read" : "Unread"}
                </Text>
                {item.sentByAdminUsername && <Text style={styles.sentByTag}>sent by @{item.sentByAdminUsername}</Text>}
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  composeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryGreen,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7,
  },
  composeBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 14, gap: 10 },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14 },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recipientText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  timeText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  subject: { fontSize: 15, color: colors.textDark, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  preview: { fontSize: 12, color: colors.textMid, marginTop: 2, fontFamily: "Inter_400Regular" },
  tagsRow: { flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "center" },
  deptTag: { fontSize: 10, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  readTag: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  readTagRead: { color: colors.textMuted },
  readTagUnread: { color: "#B8860B" },
  sentByTag: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});