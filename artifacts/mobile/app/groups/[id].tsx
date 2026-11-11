import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Share, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import PeoplePicker from "@/components/messages/PeoplePicker";
import type { MailPerson } from "@/lib/mailApi";
import {
  addGroupMembers, createLink, decideRequest, getGroup, invite, joinRequests, listLinks, removeGroupMember, revokeLink, setGroupAdmin, updateGroup,
  type GroupDetail, type InviteLink,
} from "@/lib/groupsApi";

// Group info: members only (the server answers "not available" to anyone else). Administrators manage
// members, administrators, invitations, invite links, join requests, posting and closing the group;
// members can see who is in it and leave. The group's chat is the ordinary conversation.
const confirm = (title: string, message: string, onYes: () => void) => {
  if (Platform.OS === "web") { if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes(); return; }
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", style: "destructive", onPress: onYes }]);
};

export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [g, setG] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<"add" | "invite" | null>(null);
  const [people, setPeople] = useState<MailPerson[]>([]);
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [requests, setRequests] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await getGroup(String(id));
      setG(d); setError(null);
      if (d.myRole === "admin") {
        const [l, r] = await Promise.all([listLinks(d.id).catch(() => ({ links: [] })), joinRequests(d.id).catch(() => ({ requests: [] }))]);
        setLinks(l.links); setRequests(r.requests);
      }
    } catch (e: any) { setError(e?.message ?? "This group isn't available."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setNotice(null);
    try { await fn(); if (done) setNotice(done); await load(); } catch (e: any) { setNotice(e?.message ?? "That didn't work."); }
  };

  if (error && !g) return (
    <View style={[s.screen, s.center, { paddingTop: insets.top }]}>
      <Ionicons name="lock-closed-outline" size={40} color={c.borderBeige} />
      <Text style={s.muted}>{error}</Text>
      <AppButton label="Back" variant="secondary" onPress={() => router.back()} />
    </View>
  );
  if (!g) return <View style={[s.screen, s.center]}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" /></View>;
  const admin = g.myRole === "admin";
  const me = g.members.find((m) => m.isMe);

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + 40 }}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.headerTitle} numberOfLines={1}>Group info</Text>
      </View>
      <View style={s.hero}>
        <View style={s.heroIcon}><Ionicons name={g.isAnnouncements ? "megaphone-outline" : "people"} size={30} color={c.primaryGreen} /></View>
        <Text style={s.name}>{g.name}</Text>
        {g.description ? <Text style={s.desc}>{g.description}</Text> : null}
        <View style={s.badges}>
          <View style={s.badge}><Ionicons name="lock-closed" size={12} color={c.textMid} /><Text style={s.badgeText}>Private</Text></View>
          {g.posting === "admins" ? <View style={s.badge}><Ionicons name="megaphone-outline" size={12} color={c.textMid} /><Text style={s.badgeText}>Admins post</Text></View> : null}
          {g.archived ? <View style={s.badge}><Ionicons name="archive-outline" size={12} color={c.amber} /><Text style={s.badgeText}>Closed</Text></View> : null}
        </View>
        {g.community ? (
          <TouchableOpacity onPress={() => router.push(`/groups/community/${g.community!.id}` as any)} accessibilityRole="link">
            <Text style={s.link}>Part of {g.community.name}</Text>
          </TouchableOpacity>
        ) : null}
        <AppButton label="Open chat" icon="chatbubbles-outline" onPress={() => router.push(`/messages/${g.id}` as any)} style={{ alignSelf: "stretch" }} />
      </View>
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}

      {admin && !g.archived ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>Add people</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AppButton label="Add now" size="sm" variant={adding === "add" ? "primary" : "secondary"} onPress={() => { setAdding(adding === "add" ? null : "add"); setPeople([]); }} style={{ flex: 1 }} />
            <AppButton label="Invite" size="sm" variant={adding === "invite" ? "primary" : "secondary"} onPress={() => { setAdding(adding === "invite" ? null : "invite"); setPeople([]); }} style={{ flex: 1 }} />
          </View>
          {adding ? (
            <>
              <Text style={s.hint}>{adding === "add" ? "They join straight away and are told." : "They're asked first and can accept or decline."}{g.community ? ` Only members of ${g.community.name}.` : ""}</Text>
              <PeoplePicker value={people} onChange={setPeople} exclude={g.members.map((m) => m.id)} max={100} />
              <AppButton label={adding === "add" ? `Add ${people.length || ""}` : `Invite ${people.length || ""}`} disabled={!people.length}
                onPress={() => act(() => (adding === "add" ? addGroupMembers(g.id, people.map((p) => p.id)) : invite(g.id, people.map((p) => p.id))), adding === "add" ? "Added." : "Invitations sent.").then(() => { setPeople([]); setAdding(null); })} />
            </>
          ) : null}
          <View style={s.divider} />
          <Text style={s.cardTitle}>Invite links</Text>
          <Text style={s.hint}>Links expire after 7 days. Anyone using one must be signed in; a block is never bypassed.</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <AppButton label="New link" size="sm" variant="secondary" icon="link-outline" onPress={() => act(async () => {
              const l = await createLink(g.id, {});
              await Share.share({ message: `Join “${g.name}” on P2P Global: ${Linking.createURL("/groups/join", { queryParams: { t: l.token } })}` }).catch(() => {});
            })} />
            <AppButton label="Single-use" size="sm" variant="secondary" onPress={() => act(async () => {
              const l = await createLink(g.id, { maxUses: 1 });
              await Share.share({ message: `Join “${g.name}” on P2P Global: ${Linking.createURL("/groups/join", { queryParams: { t: l.token } })}` }).catch(() => {});
            })} />
            <AppButton label="Needs approval" size="sm" variant="secondary" onPress={() => act(async () => {
              const l = await createLink(g.id, { requiresApproval: true });
              await Share.share({ message: `Ask to join “${g.name}” on P2P Global: ${Linking.createURL("/groups/join", { queryParams: { t: l.token } })}` }).catch(() => {});
            })} />
          </View>
          {links.filter((l) => !l.revoked).map((l) => (
            <View key={l.id} style={s.linkRow}>
              <Text style={s.linkText}>{l.requiresApproval ? "Approval link" : l.maxUses ? `Link · ${l.uses}/${l.maxUses} used` : `Link · used ${l.uses}×`}{l.expiresAt ? ` · until ${new Date(l.expiresAt).toLocaleDateString()}` : ""}</Text>
              <AppButton label="Revoke" size="sm" variant="tertiary" onPress={() => act(() => revokeLink(g.id, l.id), "Link revoked.")} />
            </View>
          ))}
          {requests.length ? (
            <>
              <View style={s.divider} />
              <Text style={s.cardTitle}>Asking to join</Text>
              {requests.map((r) => (
                <View key={r.id} style={s.linkRow}>
                  <Text style={[s.linkText, { flex: 1 }]}>{r.name}</Text>
                  <AppButton label="Decline" size="sm" variant="tertiary" onPress={() => act(() => decideRequest(g.id, r.id, false))} />
                  <AppButton label="Approve" size="sm" onPress={() => act(() => decideRequest(g.id, r.id, true), "Approved.")} />
                </View>
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.cardTitle}>{g.members.length} {g.members.length === 1 ? "member" : "members"}</Text>
        {g.members.map((m) => (
          <View key={m.id} style={s.member}>
            <Avatar photoUrl={m.photoUrl} name={m.name} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={s.memberName}>{m.isMe ? `${m.name} (you)` : m.name}</Text>
              {m.role === "admin" ? <Text style={s.role}>Administrator</Text> : null}
            </View>
            {admin && !m.isMe ? (
              <>
                <AppButton label={m.role === "admin" ? "Remove admin" : "Make admin"} size="sm" variant="tertiary" onPress={() => act(() => setGroupAdmin(g.id, m.id, m.role !== "admin"))} />
                <IconButton icon="person-remove-outline" accessibilityLabel={`Remove ${m.name}`} color={c.textMid}
                  onPress={() => confirm(`Remove ${m.name}?`, "They will no longer see this group or its new messages.", () => act(() => removeGroupMember(g.id, m.id), "Removed."))} />
              </>
            ) : null}
          </View>
        ))}
      </View>

      {admin ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>Settings</Text>
          <AppButton label={g.posting === "admins" ? "Let everyone post" : "Only administrators post"} variant="secondary" onPress={() => act(() => updateGroup(g.id, { posting: g.posting === "admins" ? "everyone" : "admins" }), "Saved.")} />
          <AppButton label={g.archived ? "Reopen the group" : "Close the group"} variant="secondary"
            onPress={() => confirm(g.archived ? "Reopen the group?" : "Close the group?", g.archived ? "Members can post again." : "Members keep its history, but no one can post or join.", () => act(() => updateGroup(g.id, { archived: !g.archived }), "Saved."))} />
        </View>
      ) : null}
      {me ? (
        <View style={[s.card, { borderColor: "transparent", backgroundColor: "transparent" }]}>
          <AppButton label="Leave group" variant="tertiary" icon="exit-outline"
            onPress={() => confirm("Leave this group?", "You'll stop seeing it and its new messages.", () => act(async () => { await removeGroupMember(g.id, me.id); router.back(); }))} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    headerTitle: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    hero: { alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
    heroIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center" },
    name: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    desc: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
    badges: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center" },
    badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    badgeText: { fontSize: 11.5, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    link: { fontSize: 13.5, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    notice: { marginHorizontal: 20, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    card: { marginHorizontal: 16, marginTop: 14, padding: 14, gap: 10, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    hint: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    divider: { height: 1, backgroundColor: c.borderBeige, marginVertical: 4 },
    linkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    linkText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium", flex: 1 },
    member: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
    memberName: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    role: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}
