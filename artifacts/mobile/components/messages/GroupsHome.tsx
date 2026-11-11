import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import type { ConversationSummary } from "@/contexts/DataContext";
import { AppButton } from "@/components/ui";
import { timeAgo } from "@/lib/timeFormat";
import { myGroups, myInvitations, type MyCommunity, type MyGroup } from "@/lib/groupsApi";

// Groups & Communities — private, member-only spaces. Everything shown here is something the person
// belongs to (the server never lists a group or community to a non-member). Family and Church appear as
// communities built from their own records. Group chat opens the ordinary conversation; unread counts
// come from each group's own conversation (opening one never clears another's).
type Filter = "all" | "private" | "family_church" | "circles" | "peer";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" }, { key: "private", label: "My groups" }, { key: "family_church", label: "Family & Church" },
  { key: "peer", label: "Peer Groups" }, { key: "circles", label: "Circles" },
];
// Church shows a church and Family a family (Ionicons has neither, so those two come from
// MaterialCommunityIcons); everything else keeps its Ionicons glyph.
export function GroupKindIcon({ kind, announcements, size = 20, color }: { kind: string; announcements?: boolean; size?: number; color: string }) {
  if (announcements) return <Ionicons name="megaphone-outline" size={size} color={color} />;
  if (kind === "church") return <MaterialCommunityIcons name="church" size={size + 2} color={color} accessibilityLabel="Church" />;
  if (kind === "family") return <MaterialCommunityIcons name="human-male-female-child" size={size + 2} color={color} accessibilityLabel="Family" />;
  return <Ionicons name={kind === "community" ? "albums-outline" : "people"} size={size} color={color} />;
}

export default function GroupsHome({ conversations, bottomPad = 90 }: { conversations: ConversationSummary[]; bottomPad?: number }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [data, setData] = useState<{ groups: MyGroup[]; communities: MyCommunity[] } | null>(null);
  const [invites, setInvites] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    try {
      const [g, i] = await Promise.all([myGroups(), myInvitations().catch(() => ({ invitations: [] }))]);
      setData(g); setInvites(i.invitations.length); setError(null);
    } catch (e: any) { setError(e?.message ?? "Your groups didn't load."); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Group conversations the app already knows (last message, unread), merged with group details.
  const convById = useMemo(() => new Map(conversations.filter((x) => x.type === "group").map((x) => [x.id, x])), [conversations]);
  const groups = useMemo(() => {
    // Every group chat the person already has is always listed: a conversation /groups didn't return
    // (or every one, if /groups can't be reached) is shown from the conversation list itself.
    const known = new Set((data?.groups ?? []).map((g) => g.id));
    const fromChats: MyGroup[] = [...convById.values()].filter((x) => !known.has(x.id)).map((x) => ({
      id: x.id, name: x.name, description: null, photoUrl: null, kind: x.conversationType ?? "peer_group",
      communityId: null, familyId: null, churchId: null, isAnnouncements: false, posting: "everyone", archived: false, myRole: "member", members: 0,
    }));
    const list = [...(data?.groups ?? []), ...fromChats].filter((g) => !g.archived || g.myRole === "admin");
    const f = list.filter((g) => filter === "all" || (filter === "private" ? g.kind === "private_group" : filter === "family_church" ? g.kind === "family" || g.kind === "church" : filter === "circles" ? g.kind === "circle" : g.kind === "peer_group"));
    return f.sort((a, b) => (convById.get(b.id)?.lastMessageAt ?? "").localeCompare(convById.get(a.id)?.lastMessageAt ?? ""));
  }, [data, filter, convById]);
  const openCommunity = (cm: MyCommunity) => {
    if (cm.kind === "family") router.push(`/family/${cm.id}` as any);
    else if (cm.kind === "church") router.push("/church" as any);
    else router.push(`/groups/community/${cm.id}` as any);
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      {invites ? (
        <TouchableOpacity style={s.invites} onPress={() => router.push("/groups/invitations" as any)} accessibilityRole="button" accessibilityLabel={`${invites} invitations waiting`}>
          <Ionicons name="mail-unread-outline" size={18} color={c.amber} />
          <Text style={s.invitesText}>{invites === 1 ? "1 invitation waiting" : `${invites} invitations waiting`}</Text>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </TouchableOpacity>
      ) : null}
      <View style={s.actions}>
        <AppButton label="New group" icon="people-outline" variant="secondary" size="sm" onPress={() => router.push("/groups/create" as any)} style={{ flex: 1 }} />
        <AppButton label="New community" icon="albums-outline" variant="secondary" size="sm" onPress={() => router.push({ pathname: "/groups/create", params: { kind: "community" } } as any)} style={{ flex: 1 }} />
      </View>
      {data?.communities.length ? (
        <View style={{ gap: 8 }}>
          <Text style={s.section}>Communities</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 20 }}>
            {data.communities.map((cm) => (
              <TouchableOpacity key={`${cm.kind}:${cm.id}`} style={s.community} onPress={() => openCommunity(cm)} accessibilityRole="button"
                accessibilityLabel={`${cm.name}, ${cm.kind === "community" ? "community" : cm.kind}${cm.myRole !== "member" ? ", you are an administrator" : ""}`}>
                <View style={s.communityIcon}><GroupKindIcon kind={cm.kind} color={c.primaryGreen} /></View>
                <Text style={s.communityName} numberOfLines={2}>{cm.name}</Text>
                <Text style={s.communityKind}>{cm.kind === "community" ? `${cm.groupIds.length} ${cm.groupIds.length === 1 ? "group" : "groups"}` : cm.kind === "family" ? "Family" : "Church"}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={s.filters} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <TouchableOpacity key={f.key} style={[s.chip, filter === f.key && s.chipOn]} onPress={() => setFilter(f.key)} accessibilityRole="tab" accessibilityState={{ selected: filter === f.key }}>
            <Text style={[s.chipText, filter === f.key && s.chipTextOn]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  if (!data && !error && !groups.length) return <View style={s.center}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading groups" /></View>;
  return (
    <FlatList
      data={groups}
      keyExtractor={(g) => g.id}
      ListHeaderComponent={<View style={{ paddingHorizontal: 20 }}>
        {error && !data ? (
          <TouchableOpacity style={[s.error, { marginHorizontal: 0, marginBottom: 12 }]} onPress={load} accessibilityRole="button"><Ionicons name="warning-outline" size={16} color={c.amber} /><Text style={s.errorText}>{error} Tap to try again.</Text></TouchableOpacity>
        ) : null}
        {header}
      </View>}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      ListEmptyComponent={
        <View style={s.center}>
          <Ionicons name="people-circle-outline" size={44} color={c.borderBeige} />
          <Text style={s.emptyTitle}>{filter === "private" ? "No groups yet" : "Nothing here yet"}</Text>
          <Text style={s.emptySub}>Groups are private: only the people in them can see them. Create one, or accept an invitation.</Text>
        </View>
      }
      renderItem={({ item: g }) => {
        const conv = convById.get(g.id);
        const unread = (conv?.unreadCount ?? 0) > 0;
        const kindLabel = g.kind === "private_group" ? (g.isAnnouncements ? "Announcements" : "Private group") : g.kind === "family" ? "Family" : g.kind === "church" ? "Church" : g.kind === "circle" ? "Circle" : "Peer group";
        return (
          <TouchableOpacity style={s.row} onPress={() => router.push(`/messages/${g.id}` as any)} onLongPress={() => g.kind === "private_group" && router.push(`/groups/${g.id}` as any)}
            accessibilityRole="button" accessibilityLabel={`${g.name ?? "Group"}, ${kindLabel}${unread ? `, ${conv?.unreadCount} unread` : ""}`} accessibilityHint={g.kind === "private_group" ? "Long press for group info" : undefined}>
            <View style={s.avatar}><GroupKindIcon kind={g.kind} announcements={g.isAnnouncements} color={c.primaryGreen} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={s.line}>
                {unread ? <View style={s.dot} /> : null}
                <Text style={[s.name, unread && s.bold]} numberOfLines={1}>{g.name ?? "Group"}</Text>
                {g.kind === "private_group" ? <Ionicons name="lock-closed" size={12} color={c.textMuted} accessibilityLabel="Private" /> : null}
              </View>
              <Text style={s.sub} numberOfLines={1}>{conv?.lastMessage ?? (g.members ? `${kindLabel} · ${g.members} ${g.members === 1 ? "member" : "members"}` : kindLabel)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              {conv?.lastMessageAt ? <Text style={s.time}>{timeAgo(conv.lastMessageAt, "compact")}</Text> : null}
              {unread ? <View style={s.badge}><Text style={s.badgeText}>{(conv?.unreadCount ?? 0) > 99 ? "99+" : conv?.unreadCount}</Text></View> : null}
              {g.kind === "private_group" ? (
                <TouchableOpacity onPress={() => router.push(`/groups/${g.id}` as any)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${g.name} group info`}>
                  <Ionicons name="information-circle-outline" size={18} color={c.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    invites: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.amber, backgroundColor: c.card },
    invitesText: { flex: 1, fontSize: 13.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    actions: { flexDirection: "row", gap: 10 },
    section: { fontSize: 12, letterSpacing: 0.5, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
    community: { width: 132, padding: 12, gap: 6, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    communityIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center" },
    communityName: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_700Bold" },
    communityKind: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_500Medium" },
    filters: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige },
    chipOn: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    chipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    chipTextOn: { color: "#fff", fontFamily: "Inter_700Bold" },
    center: { alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40, paddingTop: 40 },
    emptyTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    emptySub: { fontSize: 13, color: c.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 19 },
    error: { flexDirection: "row", alignItems: "center", gap: 8, margin: 20, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.amber },
    errorText: { flex: 1, fontSize: 12.5, color: c.textDark, fontFamily: "Inter_400Regular" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center" },
    line: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accentGreen },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
    bold: { fontFamily: "Inter_700Bold" },
    sub: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    time: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
    badgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  });
}
