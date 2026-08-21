import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator, TextInput, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useData, ConversationSummary } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { OfficialBadge } from "@/components/OfficialBadge";
import "@/lib/i18n";

type TabKey = "all" | "unread" | "favourites" | "peer_groups" | "circles";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "favourites", label: "Favourites" },
  { key: "peer_groups", label: "Peer Groups" },
  { key: "circles", label: "Circles" },
];

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 20, paddingBottom: 12,
    },
    headerTitle: { fontSize: 22, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    historyBtn: {
      width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(29,158,117,0.1)",
      alignItems: "center", justifyContent: "center",
    },
    searchRow: {
      flexDirection: "row", alignItems: "center", gap: 8,
      marginHorizontal: 20, marginBottom: 12,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    },
    searchInput: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    tabsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 6, marginBottom: 8 },
    tabChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
    tabChipActive: { backgroundColor: c.accentGreen },
    tabChipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    tabChipTextActive: { color: "#fff", fontWeight: "700" },
    requestsBanner: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      marginHorizontal: 20, marginBottom: 8, padding: 12,
      backgroundColor: "rgba(184,134,11,0.1)", borderWidth: 1, borderColor: "rgba(184,134,11,0.3)",
      borderRadius: 12,
    },
    requestsBannerText: { fontSize: 13, fontWeight: "600", color: "#B8860B", fontFamily: "Inter_600SemiBold" },
    contactP2PButton: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      marginHorizontal: 20, marginBottom: 4, padding: 14,
      backgroundColor: "rgba(29,158,117,0.08)", borderWidth: 1, borderColor: "rgba(29,158,117,0.25)",
      borderRadius: 14,
    },
    contactP2PLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
    contactP2PIcon: {
      width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(29,158,117,0.15)",
      alignItems: "center", justifyContent: "center",
    },
    contactP2PTitle: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    contactP2PSubtitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    myContactMessagesRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      marginHorizontal: 20, marginBottom: 12, paddingVertical: 8,
    },
    myContactMessagesText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    contactDivider: { height: 1, backgroundColor: c.borderBeige, marginBottom: 8 },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
    emptyText: { fontSize: 15, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    emptySub: { fontSize: 13, color: c.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
    row: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 20, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    avatarCircle: {
      width: 46, height: 46, borderRadius: 23,
      backgroundColor: "rgba(29,158,117,0.12)",
      alignItems: "center", justifyContent: "center",
    },
    rowTop: { flexDirection: "row", alignItems: "center" },
    rowTitle: { fontSize: 15, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
    rowTitleUnread: { fontWeight: "700" },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accentGreen, marginRight: 6 },
    systemPin: { marginLeft: 4 },
    rowSub: { fontSize: 13, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    rowSubUnread: { color: c.textDark, fontFamily: "Inter_500Medium" },
    rowRight: { alignItems: "flex-end", gap: 4 },
    timeText: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    unreadBadge: {
      minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.accentGreen,
      alignItems: "center", justifyContent: "center", paddingHorizontal: 5,
    },
    unreadBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}

export default function MessagesTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const {
    conversations, conversationsLoading, loadConversations,
    pendingConnectionRequestCount, addToFavourites, removeFromFavourites,
    pinConversation, unpinConversation,
  } = useData();

  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");

  useFocusEffect(React.useCallback(() => { loadConversations(); }, [loadConversations]));

  const filtered = useMemo(() => {
    let rows = conversations;
    if (tab === "unread") rows = rows.filter((c) => c.unreadCount > 0);
    else if (tab === "favourites") rows = rows.filter((c) => c.isFavourite);
    else if (tab === "peer_groups") rows = rows.filter((c) => c.conversationType === "peer_group");
    else if (tab === "circles") rows = rows.filter((c) => c.conversationType === "circle");

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((c) => (c.name ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [conversations, tab, search]);

  function handleLongPressRow(item: ConversationSummary) {
    const options: { text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }[] = [];
    options.push({
      text: item.isFavourite ? "Remove from Favourites" : "Add to Favourites",
      onPress: () => (item.isFavourite ? removeFromFavourites(item.id) : addToFavourites(item.id)).then(loadConversations),
    });
    if (!item.isPinnedBySystem) {
      options.push({
        text: item.isPinnedByUser ? "Unpin" : "Pin to top",
        onPress: () => (item.isPinnedByUser ? unpinConversation(item.id) : pinConversation(item.id)).then(loadConversations),
      });
    }
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert(item.name ?? "Conversation", undefined, options);
  }

  const emptyMessages: Record<TabKey, { title: string; sub: string }> = {
    all: { title: "No conversations yet", sub: "Start a conversation from a peer's profile or a study group." },
    unread: { title: "You are all caught up ✓", sub: "No unread messages right now." },
    favourites: { title: "No favourites yet", sub: "Star conversations to find them quickly here." },
    peer_groups: { title: "No peer groups yet", sub: "Create one from the Connect tab." },
    circles: { title: "Not in any circles yet", sub: "Find one in Discover." },
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("tabs.messages")}</Text>
        <TouchableOpacity style={styles.historyBtn} onPress={() => router.push("/call/history" as any)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="time-outline" size={20} color={colors.accentGreen} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search conversations"
          placeholderTextColor={colors.textMuted}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((tb) => (
          <TouchableOpacity
            key={tb.key}
            style={[styles.tabChip, tab === tb.key && styles.tabChipActive]}
            onPress={() => setTab(tb.key)}
          >
            <Text style={[styles.tabChipText, tab === tb.key && styles.tabChipTextActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.contactP2PButton} onPress={() => router.push("/messages/contact-p2p" as any)}>
        <View style={styles.contactP2PLeft}>
          <View style={styles.contactP2PIcon}>
            <Text style={{ fontSize: 18 }}>✉️</Text>
          </View>
          <View>
            <Text style={styles.contactP2PTitle}>Contact P2P Global</Text>
            <Text style={styles.contactP2PSubtitle}>Message our support, help, or crisis team</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.myContactMessagesRow} onPress={() => router.push("/messages/my-contact-messages" as any)}>
        <Text style={styles.myContactMessagesText}>My Messages to P2P Global</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </TouchableOpacity>
      <View style={styles.contactDivider} />

      {pendingConnectionRequestCount > 0 && (
        <TouchableOpacity style={styles.requestsBanner} onPress={() => router.push("/connections/requests" as any)}>
          <Text style={styles.requestsBannerText}>Message Requests ({pendingConnectionRequestCount})</Text>
          <Ionicons name="chevron-forward" size={16} color="#B8860B" />
        </TouchableOpacity>
      )}

      {conversationsLoading && conversations.length === 0 ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accentGreen} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centerFill}>
          <Ionicons name="chatbubbles-outline" size={44} color={colors.borderBeige} />
          <Text style={styles.emptyText}>{emptyMessages[tab].title}</Text>
          <Text style={styles.emptySub}>{emptyMessages[tab].sub}</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          renderItem={({ item }) => {
            const unread = item.unreadCount > 0;
            return (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.8}
                onPress={() => router.push(`/messages/${item.id}` as any)}
                onLongPress={() => handleLongPressRow(item)}
              >
                <View style={styles.avatarCircle}>
                  <Ionicons
                    name={item.type === "group" ? "people" : "person"}
                    size={20}
                    color={colors.primaryGreen}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    {unread && <View style={styles.unreadDot} />}
                    <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={1}>
                      {item.name ?? "Conversation"}
                    </Text>
                    {item.otherUserOfficialType && <OfficialBadge accountType={item.otherUserOfficialType} size="small" />}
                    {item.isPinnedBySystem && !item.otherUserOfficialType && <Ionicons name="pin" size={13} color="#C0392B" style={styles.systemPin} />}
                  </View>
                  <Text style={[styles.rowSub, unread && styles.rowSubUnread]} numberOfLines={1}>
                    {item.lastMessage ?? "No messages yet"}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.timeText}>{timeAgo(item.lastMessageAt)}</Text>
                  {unread && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}