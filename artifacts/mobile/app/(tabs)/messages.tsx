import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, ActivityIndicator, TextInput, Alert,
} from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScrollToTopOnTabReselect, useTabCapsuleTopInset } from "@/components/IPadTabCapsule";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useData, ConversationSummary } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { OfficialBadge } from "@/components/OfficialBadge";
import { Avatar } from "@/components/Avatar";
import { StatusGlyph, TICK_COLORS_ON_LIGHT } from "@/components/MessageTicks";
import { statusAccessibilityLabel } from "@/lib/messageReceipts";
import { useActivityStatus } from "@/lib/presence";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";
import { timeAgo } from "@/lib/timeFormat";
import MailHome from "@/components/messages/MailHome";
import GroupsHome from "@/components/messages/GroupsHome";
import { mailUnread } from "@/lib/mailApi";
import "@/lib/i18n";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";

// Three separate spaces: Chats (one-to-one, informal), P2P Mail (formal letters, never mixed into a chat)
// and Groups (private groups, Family & Church, Peer Groups, Circles and Communities). Each has its own badge.
type Section = "chats" | "mail" | "groups";
const SECTIONS: { key: Section; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "chats", label: "Chats", icon: "chatbubble-ellipses-outline" },
  { key: "mail", label: "P2P Mail", icon: "mail-outline" },
  { key: "groups", label: "Groups", icon: "people-outline" },
];
type TabKey = "all" | "unread" | "favourites";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "favourites", label: "Favourites" },
];


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
    sectionBar: { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, padding: 4, gap: 4, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    sectionBtn: { flex: 1, minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10 },
    sectionBtnActive: { backgroundColor: c.accentGreen },
    sectionText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    sectionTextActive: { color: "#fff", fontFamily: "Inter_700Bold" },
    sectionBadge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", backgroundColor: c.accentGreen },
    sectionBadgeActive: { backgroundColor: "#fff" },
    sectionBadgeText: { fontSize: 10.5, color: "#fff", fontFamily: "Inter_700Bold" },
    sectionBadgeTextActive: { color: c.accentGreen },
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
    loadErrorBanner: {
      flexDirection: "row", alignItems: "center", gap: 8,
      marginHorizontal: 20, marginBottom: 8, padding: 12,
      backgroundColor: "rgba(184,134,11,0.1)", borderWidth: 1, borderColor: "rgba(184,134,11,0.3)",
      borderRadius: 12,
    },
    loadErrorBannerText: { flex: 1, fontSize: 12, color: "#8A6410", fontFamily: "Inter_400Regular" },
    loadErrorBannerRetry: { fontSize: 12, fontWeight: "700", color: "#B8860B", fontFamily: "Inter_700Bold" },
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
    onlineDot: {
      position: "absolute", right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7,
      backgroundColor: c.accentGreen, borderWidth: 2, borderColor: c.lightCream,
    },
    systemPin: { marginLeft: 4 },
    userPin: { marginRight: 4 },
    rowSub: { fontSize: 13, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
    rowSubLine: { flexDirection: "row", alignItems: "center", marginTop: 2 },
    rowSubFlex: { flex: 1, marginTop: 0 },
    rowTicks: { marginRight: 4 },
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

function MessagesTab() {
  const insets = useSafeAreaInsets();
  const capsuleTopInset = useTabCapsuleTopInset(insets.top);
  const tabScrollRef = React.useRef<FlatList>(null);
  useScrollToTopOnTabReselect("messages", tabScrollRef);
  const { contentMaxWidth } = useLayout();
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const {
    conversations, conversationsLoading, conversationsLoadError, loadConversations,
    pendingConnectionRequestCount, addToFavourites, removeFromFavourites,
    pinConversation, unpinConversation,
  } = useData();

  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>("chats");
  React.useEffect(() => {
    if (params.section === "mail" || params.section === "groups" || params.section === "chats") setSection(params.section);
  }, [params.section]);
  const [mailUnreadCount, setMailUnreadCount] = useState(0);
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  // Online dot only here; the fuller "Active today" wording is in the chat
  // header. The server only returns peers the user may see (migration 171).
  const activity = useActivityStatus(
    conversations.filter((c) => c.type !== "group" && !c.otherUserOfficialType).map((c) => c.otherUserId),
  );

  useFocusEffect(React.useCallback(() => {
    loadConversations();
    mailUnread().then((r) => setMailUnreadCount(r.unreadThreads)).catch(() => {});
  }, [loadConversations]));

  // Official P2P conversations (the verified P2P Official account) belong with formal correspondence:
  // they are listed in P2P Mail, not in Chats. Same conversation, same screen — only where it's found.
  const officialChats = useMemo(() => conversations.filter((c) => c.type !== "group" && !!c.otherUserOfficialType), [conversations]);
  const chats = useMemo(() => conversations.filter((c) => c.type !== "group" && !c.otherUserOfficialType), [conversations]);
  const groups = useMemo(() => conversations.filter((c) => c.type === "group"), [conversations]);
  const badge: Record<Section, number> = {
    chats: chats.filter((c) => c.unreadCount > 0).length,
    mail: mailUnreadCount + officialChats.filter((c) => c.unreadCount > 0).length,
    groups: groups.filter((c) => c.unreadCount > 0).length,
  };

  const filtered = useMemo(() => {
    let rows = chats;
    if (tab === "unread") rows = rows.filter((c) => c.unreadCount > 0);
    else if (tab === "favourites") rows = rows.filter((c) => c.isFavourite);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((c) => (c.name ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [chats, tab, search]);

  function handleLongPressRow(item: ConversationSummary) {
    const options: { text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }[] = [];
    options.push({
      text: item.isFavourite ? "Remove from Favourites" : "Add to Favourites",
      onPress: () => (item.isFavourite ? removeFromFavourites(item.id) : addToFavourites(item.id)).then(loadConversations),
    });
    // isPinnedBySystem (p2p_conversations.is_pinned_by_system, admin-only,
    // e.g. a linked help-request thread — see admin.ts's
    // /help-requests/:id/link-conversation) and isPinnedByUser
    // (p2p_conversation_settings, this action) are independent: the system
    // pin keeps a conversation sorted above user-pinned ones regardless,
    // but that's an ordering decision, not a reason to hide the user's own
    // pin/unpin toggle — official-response conversations use the exact
    // same p2p_conversation_settings mechanism as every other chat.
    options.push({
      text: item.isPinnedByUser ? "Unpin" : "Pin",
      onPress: () => (item.isPinnedByUser ? unpinConversation(item.id) : pinConversation(item.id)).then(loadConversations),
    });
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert(item.name ?? "Conversation", undefined, options);
  }

  const emptyMessages: Record<TabKey, { title: string; sub: string }> = {
    all: { title: "No chats yet", sub: "Start a conversation from a peer's profile." },
    unread: { title: "You are all caught up ✓", sub: "No unread messages right now." },
    favourites: { title: "No favourites yet", sub: "Star conversations to find them quickly here." },
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + capsuleTopInset + (Platform.OS === "web" ? 67 : 16) }]}>
      <View style={[{ flex: 1 }, centeredMaxWidth(contentMaxWidth)]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("tabs.messages")}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Call history" style={styles.historyBtn} onPress={() => router.push("/call/history" as any)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="time-outline" size={20} color={colors.accentGreen} />
        </TouchableOpacity>
      </View>

      <View style={styles.sectionBar} accessibilityRole="tablist">
        {SECTIONS.map((sc) => {
          const active = section === sc.key, n = badge[sc.key];
          return (
            <TouchableOpacity key={sc.key} accessibilityRole="tab" accessibilityState={{ selected: active }}
              accessibilityLabel={`${sc.label}${n ? `, ${n} unread` : ""}`}
              style={[styles.sectionBtn, active && styles.sectionBtnActive]} onPress={() => setSection(sc.key)}>
              <Ionicons name={sc.icon} size={16} color={active ? "#fff" : colors.textMid} />
              <Text style={[styles.sectionText, active && styles.sectionTextActive]} numberOfLines={1}>{sc.label}</Text>
              {n > 0 ? (
                <View style={[styles.sectionBadge, active && styles.sectionBadgeActive]}>
                  <Text style={[styles.sectionBadgeText, active && styles.sectionBadgeTextActive]}>{n > 99 ? "99+" : n}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* P2P Mail holds all formal correspondence, so Contact P2P Global (support, help and crisis team)
          lives here too — the same screens as before, just found in one place. */}
      {section === "mail" ? (<>
        <TouchableOpacity accessibilityRole="button" style={styles.contactP2PButton} onPress={() => router.push("/messages/contact-p2p" as any)}>
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
        <TouchableOpacity accessibilityRole="button" style={styles.myContactMessagesRow} onPress={() => router.push("/messages/my-contact-messages" as any)}>
          <Text style={styles.myContactMessagesText}>My Messages to P2P Global</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        {officialChats.map((item) => {
          const unread = item.unreadCount > 0;
          return (
            <TouchableOpacity key={item.id} accessibilityRole="button" style={styles.row} activeOpacity={0.8}
              accessibilityLabel={`${item.name ?? "P2P Official"}, official${unread ? `, ${item.unreadCount} unread` : ""}`}
              onPress={() => router.push(`/messages/${item.id}` as any)} onLongPress={() => handleLongPressRow(item)}>
              <Avatar photoUrl={item.otherUserPhotoUrl} name={item.name} size={46} />
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  {unread && <View style={styles.unreadDot} />}
                  <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={1}>{item.name ?? "P2P Official"}</Text>
                  {item.otherUserOfficialType && <OfficialBadge accountType={item.otherUserOfficialType} size="small" />}
                </View>
                <Text style={[styles.rowSub, unread && styles.rowSubUnread]} numberOfLines={1}>{item.lastMessage ?? "Official messages from P2P Global"}</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.timeText}>{timeAgo(item.lastMessageAt, "compact")}</Text>
                {unread && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
        <View style={styles.contactDivider} />
        <MailHome bottomPad={insets.bottom + 90} onUnreadChange={setMailUnreadCount} />
      </>) : null}
      {section === "groups" ? <GroupsHome conversations={groups} bottomPad={insets.bottom + 90} /> : null}
      {section === "chats" ? (<>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search chats"
          placeholderTextColor={colors.textMuted}
        />
        {search.length > 0 && (
          <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" hitSlop={10} onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((tb) => (
          <TouchableOpacity accessibilityRole="button"
            key={tb.key}
            style={[styles.tabChip, tab === tb.key && styles.tabChipActive]}
            onPress={() => setTab(tb.key)}
          >
            <Text style={[styles.tabChipText, tab === tb.key && styles.tabChipTextActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {pendingConnectionRequestCount > 0 && (
        <TouchableOpacity accessibilityRole="button" style={styles.requestsBanner} onPress={() => router.push("/connections/requests" as any)}>
          <Text style={styles.requestsBannerText}>Message Requests ({pendingConnectionRequestCount})</Text>
          <Ionicons name="chevron-forward" size={16} color="#B8860B" />
        </TouchableOpacity>
      )}

      {/* Message-restoration repair — conversationsLoadError never means the
          list below is empty; DataContext keeps whatever was last loaded
          successfully, this just makes a real failure visible with a retry
          instead of it looking like the conversations are just gone. */}
      {conversationsLoadError && (
        <TouchableOpacity accessibilityRole="button" style={styles.loadErrorBanner} onPress={() => loadConversations()} activeOpacity={0.8}>
          <Ionicons name="warning-outline" size={16} color="#B8860B" />
          <Text style={styles.loadErrorBannerText} numberOfLines={2}>{conversationsLoadError}</Text>
          <Text style={styles.loadErrorBannerRetry}>Retry</Text>
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
          ref={tabScrollRef}
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          renderItem={({ item }) => {
            const unread = item.unreadCount > 0;
            return (
              <TouchableOpacity accessibilityRole="button"
                style={styles.row}
                activeOpacity={0.8}
                onPress={() => router.push(`/messages/${item.id}` as any)}
                onLongPress={() => handleLongPressRow(item)}
              >
                {item.type === "group" ? (
                  <View style={styles.avatarCircle}>
                    <Ionicons name="people" size={20} color={colors.primaryGreen} />
                  </View>
                ) : (
                  <View>
                    <Avatar photoUrl={item.otherUserPhotoUrl} name={item.name} size={46} />
                    {!!item.otherUserId && activity[item.otherUserId] === "online" && (
                      <View style={styles.onlineDot} accessibilityLabel="Active now" />
                    )}
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    {unread && <View style={styles.unreadDot} />}
                    <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={1}>
                      {item.name ?? "Conversation"}
                    </Text>
                    {item.otherUserOfficialType && <OfficialBadge accountType={item.otherUserOfficialType} size="small" />}
                    {item.isPinnedBySystem && !item.otherUserOfficialType && <MaterialIcons name="push-pin" size={13} color="#C0392B" style={styles.systemPin} />}
                  </View>
                  <View style={styles.rowSubLine}>
                    {item.lastMessageStatus && (
                      <View
                        style={styles.rowTicks}
                        accessible
                        accessibilityLabel={`Your last message: ${statusAccessibilityLabel(item.lastMessageStatus)}`}
                      >
                        <StatusGlyph
                          status={item.lastMessageStatus}
                          size={15}
                          palette={{ grey: colors.textMuted, read: TICK_COLORS_ON_LIGHT.read, failed: TICK_COLORS_ON_LIGHT.failed }}
                        />
                      </View>
                    )}
                    <Text style={[styles.rowSub, styles.rowSubFlex, unread && styles.rowSubUnread]} numberOfLines={1}>
                      {item.lastMessage ?? "No messages yet"}
                    </Text>
                  </View>
                </View>
                <View style={styles.rowRight}>
                  {item.isPinnedByUser && (
                    <MaterialIcons name="push-pin" size={13} color={colors.textMuted} style={styles.userPin} />
                  )}
                  <Text style={styles.timeText}>{timeAgo(item.lastMessageAt, "compact")}</Text>
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
      </>) : null}
      </View>
    </View>
  );
}

// One tab's error stays in that tab (components/ScreenErrorBoundary.tsx).
export default withScreenBoundary(MessagesTab, "tabs/messages");
