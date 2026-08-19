import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, ContactThread, ContactMessageStatus } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const STATUS_DISPLAY: Record<ContactMessageStatus, { label: string; color: string }> = {
  unread: { label: "Received", color: "#888" },
  read: { label: "Being reviewed", color: "#B8860B" },
  replied: { label: "Replied", color: "#1D9E75" },
  forwarded: { label: "Being handled", color: "#4A90D9" },
  closed: { label: "Resolved", color: "#555" },
};

export default function ContactThreadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { messageId } = useLocalSearchParams<{ messageId: string }>();
  const { getContactThread } = useData();
  const [thread, setThread] = useState<ContactThread | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!messageId) return;
    setLoading(true);
    setThread(await getContactThread(messageId));
    setLoading(false);
  }, [messageId, getContactThread]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }
  if (!thread) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <Text style={styles.emptyText}>Message not found.</Text>
      </View>
    );
  }

  const statusInfo = STATUS_DISPLAY[thread.message.status];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{thread.message.subject}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30 }}>
        <Text style={styles.reference}>{thread.message.referenceNumber}</Text>
        <View style={[styles.statusBadge, { backgroundColor: `${statusInfo.color}22`, alignSelf: "flex-start" }]}>
          <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
        </View>

        <View style={styles.originalCard}>
          <Text style={styles.originalLabel}>Your message</Text>
          <Text style={styles.originalBody}>{thread.message.body}</Text>
          <Text style={styles.originalDate}>{new Date(thread.message.createdAt).toLocaleString()}</Text>
        </View>

        {thread.replies.length > 0 && (
          <>
            <Text style={styles.repliesTitle}>REPLIES</Text>
            {thread.replies.map((reply) => (
              <View key={reply.id} style={styles.replyCard}>
                <Text style={styles.replyDept}>{reply.fromDepartment.replace(/_/g, " ")} team</Text>
                <Text style={styles.replyBody}>{reply.body}</Text>
                <Text style={styles.replyDate}>{new Date(reply.createdAt).toLocaleString()}</Text>
              </View>
            ))}
          </>
        )}

        {thread.replies.length > 0 && (
          <TouchableOpacity style={styles.inboxLink} onPress={() => router.push("/(tabs)/messages" as any)}>
            <Text style={styles.inboxLinkText}>View reply in your messages inbox →</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginHorizontal: 8 },
  reference: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginBottom: 8 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 16 },
  statusBadgeText: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  originalCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 14, padding: 16, gap: 8, marginBottom: 20 },
  originalLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  originalBody: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 21 },
  originalDate: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  repliesTitle: { fontSize: 11, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 8 },
  replyCard: { backgroundColor: "rgba(29,158,117,0.06)", borderWidth: 1, borderColor: "rgba(29,158,117,0.2)", borderRadius: 14, padding: 16, gap: 6, marginBottom: 10 },
  replyDept: { fontSize: 12, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold", textTransform: "capitalize" },
  replyBody: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 21 },
  replyDate: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  inboxLink: { alignItems: "center", paddingVertical: 14 },
  inboxLinkText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
});