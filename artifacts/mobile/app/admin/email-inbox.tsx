import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  useData, ContactAdminInboxItem, ContactDepartment, SentOfficialMessage, ComposeDepartment, OfficialMailDraft,
} from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { ComposeMessageModal } from "@/components/ComposeMessageModal";
import colors from "@/constants/colors";

// P2P Official Mail — the unified surface for Contact P2P Global (received
// tickets, p2p_contact_messages) and Compose (sent official messages,
// p2p_messages). Deliberately does NOT include Help Requests: that system
// triggers a real personal conversation/call for crisis-tier users rather
// than an official-branded reply, and folding it in here would replace
// that real-human response with an impersonal "P2P Official" one — kept as
// its own separate crisis queue by explicit decision.
type InboxTab = "inbox" | "sent" | "forwarded" | "received" | "closed" | "starred" | "archived" | "compose_sent" | "drafts";
const TABS: { key: InboxTab; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "forwarded", label: "Forwarded" },
  { key: "received", label: "Received" },
  { key: "closed", label: "Closed" },
  { key: "starred", label: "Starred" },
  { key: "archived", label: "Archived" },
  { key: "compose_sent", label: "Sent Mail" },
  { key: "drafts", label: "Drafts" },
];

const DEPARTMENT_LABELS: Record<ContactDepartment, string> = {
  help_request: "Help Request", crisis_response: "Crisis Response", p2p_support: "P2P Support", marketing: "Marketing",
};

const COMPOSE_DEPARTMENT_LABELS: Record<ComposeDepartment, string> = {
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

function getDepartmentLabel(role: string): string {
  if (role === "admin_marketing") return "Marketing";
  if (role === "super_admin") return "All Departments";
  return "Help & Support";
}

export default function AdminEmailInbox() {
  const { profile } = useAuth();
  const {
    getAdminContactInbox, getContactAdminStats, getSentOfficialMessages,
    starContactMessage, archiveContactMessage, getOfficialMailDrafts, deleteOfficialMailDraft,
  } = useData();
  const router = useRouter();
  const [tab, setTab] = useState<InboxTab>("inbox");
  const [deptFilter, setDeptFilter] = useState<ContactDepartment | "all">("all");
  const [messages, setMessages] = useState<ContactAdminInboxItem[]>([]);
  const [archivedMessages, setArchivedMessages] = useState<ContactAdminInboxItem[]>([]);
  const [composeSent, setComposeSent] = useState<SentOfficialMessage[]>([]);
  const [drafts, setDrafts] = useState<OfficialMailDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [showCompose, setShowCompose] = useState(false);
  const [resumeDraft, setResumeDraft] = useState<OfficialMailDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [all, archived, stats, sent, draftList] = await Promise.all([
      getAdminContactInbox(), getAdminContactInbox({ archived: true }),
      getContactAdminStats(), getSentOfficialMessages(), getOfficialMailDrafts(),
    ]);
    setMessages(all);
    setArchivedMessages(archived);
    setUnreadCount(stats?.totalUnread ?? 0);
    setOverdueCount(stats?.overdue ?? 0);
    setComposeSent(sent);
    setDrafts(draftList);
    setLoading(false);
  }, [getAdminContactInbox, getContactAdminStats, getSentOfficialMessages, getOfficialMailDrafts]);

  useEffect(() => { load(); }, [load]);

  const availableDepartments = useMemo(
    () => Array.from(new Set(messages.map((m) => m.toDepartment))),
    [messages]
  );

  const filtered = useMemo(() => {
    let rows = tab === "archived" ? archivedMessages : messages;
    if (tab === "inbox") rows = rows.filter((m) => m.status === "unread" || m.status === "read");
    else if (tab === "sent") rows = rows.filter((m) => m.status === "replied");
    else if (tab === "forwarded") rows = rows.filter((m) => m.status === "forwarded");
    else if (tab === "received") rows = rows.filter((m) => m.assignedTo === profile?.id);
    else if (tab === "closed") rows = rows.filter((m) => m.status === "closed");
    else if (tab === "starred") rows = rows.filter((m) => m.isStarredByMe);
    if (deptFilter !== "all") rows = rows.filter((m) => m.toDepartment === deptFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((m) =>
        m.subject.toLowerCase().includes(q) || m.bodyPreview.toLowerCase().includes(q) ||
        m.referenceNumber.toLowerCase().includes(q) || (m.fromUsername ?? "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [messages, archivedMessages, tab, deptFilter, search, profile?.id]);

  const filteredComposeSent = useMemo(() => {
    if (!search.trim()) return composeSent;
    const q = search.trim().toLowerCase();
    return composeSent.filter((m) =>
      m.subject.toLowerCase().includes(q) || m.bodyPreview.toLowerCase().includes(q) ||
      (m.recipientUsername ?? "").toLowerCase().includes(q)
    );
  }, [composeSent, search]);

  const isContactTab = tab !== "compose_sent" && tab !== "drafts";

  const handleToggleStar = useCallback(async (item: ContactAdminInboxItem) => {
    const next = !item.isStarredByMe;
    setMessages((prev) => prev.map((m) => (m.id === item.id ? { ...m, isStarredByMe: next } : m)));
    setArchivedMessages((prev) => prev.map((m) => (m.id === item.id ? { ...m, isStarredByMe: next } : m)));
    await starContactMessage(item.id, next);
  }, [starContactMessage]);

  const handleToggleArchive = useCallback(async (item: ContactAdminInboxItem) => {
    const next = !item.isArchived;
    await archiveContactMessage(item.id, next);
    await load();
  }, [archiveContactMessage, load]);

  const handleDeleteDraft = useCallback((draft: OfficialMailDraft) => {
    Alert.alert("Delete draft?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          await deleteOfficialMailDraft(draft.id);
          setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
        },
      },
    ]);
  }, [deleteOfficialMailDraft]);

  return (
    <View style={styles.container}>
      <View style={styles.inboxHeader}>
        <View style={styles.inboxHeaderTopRow}>
          <View>
            <Text style={styles.mailBrand}>P2P OFFICIAL MAIL</Text>
            <Text style={styles.inboxTitle}>{getDepartmentLabel(profile?.role ?? "")}</Text>
          </View>
          <TouchableOpacity style={styles.composeBtn} onPress={() => { setResumeDraft(null); setShowCompose(true); }}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.composeBtnText}>Compose</Text>
          </TouchableOpacity>
        </View>
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

      {isContactTab && availableDepartments.length > 1 && (
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

      {tab !== "drafts" && (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={tab === "compose_sent" ? "Search sent mail" : "Search by subject, username, or reference"}
            placeholderTextColor={colors.textMuted}
          />
        </View>
      )}

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primaryGreen} /></View>
      ) : tab === "drafts" ? (
        <FlatList
          data={drafts}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No drafts. Anything you start writing and close without sending is saved here.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => { setResumeDraft(item); setShowCompose(true); }}>
              <View style={styles.cardTopRow}>
                <Text style={styles.senderName}>
                  {item.targetUsername ? `To @${item.targetUsername}` : "No recipient yet"}
                </Text>
                <Text style={styles.timeText}>{timeAgo(item.updatedAt)}</Text>
              </View>
              <Text style={styles.subject} numberOfLines={1}>{item.subject || "(No subject)"}</Text>
              <Text style={styles.preview} numberOfLines={1}>{item.body || "(No message)"}</Text>
              <View style={styles.tagsRow}>
                {item.department && <Text style={styles.referenceTag}>{COMPOSE_DEPARTMENT_LABELS[item.department]}</Text>}
                <TouchableOpacity onPress={() => handleDeleteDraft(item)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={styles.deleteDraftText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : tab === "compose_sent" ? (
        <FlatList
          data={filteredComposeSent}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No official messages sent yet. Tap Compose to send one.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <Text style={styles.senderName}>
                  To @{item.recipientUsername ?? "unknown"}{item.recipientFullName ? ` · ${item.recipientFullName}` : ""}
                </Text>
                <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
              </View>
              <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
              <Text style={styles.preview} numberOfLines={1}>{item.bodyPreview}</Text>
              <View style={styles.tagsRow}>
                <Text style={styles.referenceTag}>{COMPOSE_DEPARTMENT_LABELS[item.department]}</Text>
                <Text style={item.isRead ? styles.readTag : styles.unreadTag}>{item.isRead ? "✓ Read" : "Unread"}</Text>
                {item.sentByAdminUsername && <Text style={styles.referenceTag}>sent by @{item.sentByAdminUsername}</Text>}
              </View>
            </View>
          )}
        />
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
                  <View style={styles.cardTopRowActions}>
                    <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
                    <TouchableOpacity onPress={() => handleToggleStar(item)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Ionicons name={item.isStarredByMe ? "star" : "star-outline"} size={16} color={item.isStarredByMe ? colors.amber : colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleToggleArchive(item)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Ionicons name={tab === "archived" ? "arrow-undo-outline" : "archive-outline"} size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
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

      <ComposeMessageModal
        visible={showCompose}
        onClose={() => { setShowCompose(false); setResumeDraft(null); load(); }}
        onSent={load}
        initialDraft={resumeDraft}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  inboxHeader: { padding: 16, paddingBottom: 8 },
  inboxHeaderTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mailBrand: { fontSize: 10, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  inboxTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  sentIconBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
  },
  composeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryGreen,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7,
  },
  composeBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
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
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular", paddingHorizontal: 30 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, position: "relative",
  },
  cardUnread: { borderColor: colors.accentGreen },
  cardUrgent: { borderColor: "#B91C1C", borderWidth: 1.5 },
  boldText: { fontWeight: "700" },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTopRowActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  senderName: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  timeText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  subject: { fontSize: 15, color: colors.textDark, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  preview: { fontSize: 12, color: colors.textMid, marginTop: 2, fontFamily: "Inter_400Regular" },
  tagsRow: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" },
  referenceTag: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  urgentTag: { fontSize: 10, fontWeight: "700", color: "#B91C1C", fontFamily: "Inter_700Bold" },
  highTag: { fontSize: 10, fontWeight: "700", color: "#D97706", fontFamily: "Inter_700Bold" },
  forwardedTag: { fontSize: 10, fontWeight: "700", color: "#4A90D9", fontFamily: "Inter_700Bold" },
  readTag: { fontSize: 10, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold" },
  unreadTag: { fontSize: 10, fontWeight: "700", color: "#B8860B", fontFamily: "Inter_700Bold" },
  unreadDot: { position: "absolute", top: 14, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentGreen },
  deleteDraftText: { fontSize: 11, fontWeight: "700", color: "#B91C1C", fontFamily: "Inter_700Bold", marginLeft: "auto" },
});