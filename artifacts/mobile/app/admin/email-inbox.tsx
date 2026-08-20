import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useData, ContactAdminInboxItem, ContactDepartment } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

type InboxTab = "inbox" | "sent" | "forwarded" | "received" | "closed";
const TABS: { key: InboxTab; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "forwarded", label: "Forwarded" },
  { key: "received", label: "Received" },
  { key: "closed", label: "Closed" },
];

const DEPARTMENT_LABELS: Record<ContactDepartment, string> = {
  help_request: "Help Request", crisis_response: "Crisis Response", p2p_support: "P2P Support", marketing: "Marketing",
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

function getDepartmentLabel(role: string): string {
  if (role === "admin_marketing") return "Marketing";
  if (role === "super_admin") return "All Departments";
  return "Help & Support";
}

export default function AdminEmailInbox() {
  const { profile } = useAuth();
  const { getAdminContactInbox, getContactAdminStats } = useData();
  const router = useRouter();
  const [tab, setTab] = useState<InboxTab>("inbox");
  const [deptFilter, setDeptFilter] = useState<ContactDepartment | "all">("all");
  const [messages, setMessages] = useState<ContactAdminInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [all, stats] = await Promise.all([getAdminContactInbox(), getContactAdminStats()]);
    setMessages(all);
    setUnreadCount(stats?.totalUnread ?? 0);
    setOverdueCount(stats?.overdue ?? 0);
    setLoading(false);
  }, [getAdminContactInbox, getContactAdminStats]);

  useEffect(() => { load(); }, [load]);

  const availableDepartments = useMemo(
    () => Array.from(new Set(messages.map((m) => m.toDepartment))),
    [messages]
  );

  const filtered = useMemo(() => {
    let rows = messages;
    if (tab === "inbox") rows = rows.filter((m) => m.status === "unread" || m.status === "read");
    else if (tab === "sent") rows = rows.filter((m) => m.status === "replied");
    else if (tab === "forwarded") rows = rows.filter((m) => m.status === "forwarded");
    else if (tab === "received") rows = rows.filter((m) => m.assignedTo === profile?.id);
    else if (tab === "closed") rows = rows.filter((m) => m.status === "closed");
    if (deptFilter !== "all") rows = rows.filter((m) => m.toDepartment === deptFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((m) =>
        m.subject.toLowerCase().includes(q) || m.bodyPreview.toLowerCase().includes(q) ||
        m.referenceNumber.toLowerCase().includes(q) || (m.fromUsername ?? "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [messages, tab, deptFilter, search, profile?.id]);

  return (
    <View style={styles.container}>
      <View style={styles.inboxHeader}>
        <Text style={styles.inboxTitle}>{getDepartmentLabel(profile?.role ?? "")} Inbox</Text>
        <View style={styles.inboxStats}>
          <Text style={styles.unreadCount}>{unreadCount} unread</Text>
          {overdueCount > 0 && <Text style={styles.overdueCount}>⚠️ {overdueCount} overdue</Text>}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tabChip, tab === t.key && styles.tabChipActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabChipText, tab === t.key && styles.tabChipTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {availableDepartments.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.deptBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}>
          <TouchableOpacity style={[styles.deptChip, deptFilter === "all" && styles.deptChipActive]} onPress={() => setDeptFilter("all")}>
            <Text style={[styles.deptChipText, deptFilter === "all" && styles.deptChipTextActive]}>All Departments</Text>
          </TouchableOpacity>
          {availableDepartments.map((d) => (
            <TouchableOpacity key={d} style={[styles.deptChip, deptFilter === d && styles.deptChipActive]} onPress={() => setDeptFilter(d)}>
              <Text style={[styles.deptChipText, deptFilter === d && styles.deptChipTextActive]}>{DEPARTMENT_LABELS[d]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by subject, username, or reference"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No messages here.</Text>}
          renderItem={({ item }) => {
            const isUnread = item.status === "unread";
            const isUrgent = item.priority === "urgent";
            const isHigh = item.priority === "high";
            return (
              <TouchableOpacity
                style={[styles.card, isUnread && styles.cardUnread, isUrgent && styles.cardUrgent]}
                onPress={() => router.push(`/admin/email-message/${item.id}` as any)}
                activeOpacity={0.85}
              >
                <View style={styles.cardTopRow}>
                  <Text style={[styles.senderName, isUnread && styles.boldText]}>@{item.fromUsername ?? "unknown"}</Text>
                  <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
                </View>
                <Text style={[styles.subject, isUnread && styles.boldText]} numberOfLines={1}>{item.subject}</Text>
                <Text style={styles.preview} numberOfLines={1}>{item.bodyPreview}</Text>
                <View style={styles.tagsRow}>
                  <Text style={styles.referenceTag}>{item.referenceNumber}</Text>
                  {isUrgent && <Text style={styles.urgentTag}>🔴 URGENT</Text>}
                  {isHigh && <Text style={styles.highTag}>🟡 HIGH</Text>}
                  {item.status === "forwarded" && <Text style={styles.forwardedTag}>↗️ FORWARDED</Text>}
                </View>
                {isUnread && <View style={styles.unreadDot} />}
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
  inboxHeader: { padding: 16, paddingBottom: 8 },
  inboxTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  inboxStats: { flexDirection: "row", gap: 14, marginTop: 4 },
  unreadCount: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  overdueCount: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_600SemiBold" },
  tabBar: { flexGrow: 0, marginBottom: 8 },
  tabChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  tabChipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  tabChipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  tabChipTextActive: { color: "#fff", fontWeight: "700" },
  deptBar: { flexGrow: 0, marginBottom: 8 },
  deptChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: "rgba(29,158,117,0.06)", borderWidth: 1, borderColor: colors.borderBeige },
  deptChipActive: { backgroundColor: colors.textDark, borderColor: colors.textDark },
  deptChipText: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_500Medium" },
  deptChipTextActive: { color: "#fff", fontWeight: "700" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 14, gap: 10 },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  card: {
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, position: "relative",
  },
  cardUnread: { borderColor: colors.accentGreen },
  cardUrgent: { borderColor: "#B91C1C", borderWidth: 1.5 },
  boldText: { fontWeight: "700" },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  senderName: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  timeText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  subject: { fontSize: 15, color: colors.textDark, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  preview: { fontSize: 12, color: colors.textMid, marginTop: 2, fontFamily: "Inter_400Regular" },
  tagsRow: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  referenceTag: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  urgentTag: { fontSize: 10, fontWeight: "700", color: "#B91C1C", fontFamily: "Inter_700Bold" },
  highTag: { fontSize: 10, fontWeight: "700", color: "#D97706", fontFamily: "Inter_700Bold" },
  forwardedTag: { fontSize: 10, fontWeight: "700", color: "#4A90D9", fontFamily: "Inter_700Bold" },
  unreadDot: { position: "absolute", top: 14, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentGreen },
});