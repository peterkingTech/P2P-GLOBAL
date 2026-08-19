import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, ContactMessageListItem, ContactMessageStatus } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const STATUS_DISPLAY: Record<ContactMessageStatus, { label: string; color: string; icon: string }> = {
  unread: { label: "Received", color: "#888", icon: "📩" },
  read: { label: "Being reviewed", color: "#B8860B", icon: "👁️" },
  replied: { label: "Replied", color: "#1D9E75", icon: "✅" },
  forwarded: { label: "Being handled", color: "#4A90D9", icon: "↗️" },
  closed: { label: "Resolved", color: "#555", icon: "✓" },
};

const DEPARTMENT_LABELS: Record<string, string> = {
  help_request: "Help Request", crisis_response: "Crisis Response", p2p_support: "P2P Support", marketing: "Marketing",
};

export default function MyContactMessages() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getMyContactMessages } = useData();
  const [messages, setMessages] = useState<ContactMessageListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setMessages(await getMyContactMessages());
    setLoading(false);
  }, [getMyContactMessages]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Messages to P2P Global</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No messages yet.</Text>
              <Text style={styles.emptySub}>Messages you send to P2P Global will show up here.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const statusInfo = STATUS_DISPLAY[item.status];
            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => router.push(`/messages/contact-thread/${item.id}` as any)}
              >
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardSubject} numberOfLines={1}>{item.subject}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: `${statusInfo.color}22` }]}>
                    <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>{statusInfo.icon} {statusInfo.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>
                  {DEPARTMENT_LABELS[item.toDepartment] ?? item.toDepartment} · {new Date(item.createdAt).toLocaleDateString()}
                </Text>
                <Text style={styles.cardReference}>{item.referenceNumber}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", flex: 1, textAlign: "center" },
  emptyWrap: { alignItems: "center", marginTop: 60, gap: 6, paddingHorizontal: 30 },
  emptyText: { fontSize: 15, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14, gap: 4 },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardSubject: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  cardMeta: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  cardReference: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});