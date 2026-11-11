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
import { addCommunityMembers, createLink, getCommunity, removeCommunityMember, setCommunityAdmin, updateCommunity, type CommunityDetail } from "@/lib/groupsApi";

// A Community: a private space holding several groups. Its members see the groups THEY belong to
// (community membership never opens a group); administrators see all of them, create new ones and
// manage the community's members and administrators.
const confirm = (title: string, message: string, onYes: () => void) => {
  if (Platform.OS === "web") { if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes(); return; }
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", style: "destructive", onPress: onYes }]);
};

export default function CommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<CommunityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [people, setPeople] = useState<MailPerson[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { setD(await getCommunity(String(id))); setError(null); } catch (e: any) { setError(e?.message ?? "This community isn't available."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setNotice(null);
    try { await fn(); if (done) setNotice(done); await load(); } catch (e: any) { setNotice(e?.message ?? "That didn't work."); }
  };

  if (error && !d) return (
    <View style={[s.screen, s.center, { paddingTop: insets.top }]}>
      <Ionicons name="lock-closed-outline" size={40} color={c.borderBeige} /><Text style={s.muted}>{error}</Text>
      <AppButton label="Back" variant="secondary" onPress={() => router.back()} />
    </View>
  );
  if (!d) return <View style={[s.screen, s.center]}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" /></View>;
  const admin = d.myRole !== "member";

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + 40 }}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.headerTitle} numberOfLines={1}>Community</Text>
      </View>
      <View style={s.hero}>
        <View style={s.heroIcon}><Ionicons name="albums-outline" size={30} color={c.primaryGreen} /></View>
        <Text style={s.name}>{d.name}</Text>
        {d.description ? <Text style={s.desc}>{d.description}</Text> : null}
        <View style={s.badge}><Ionicons name="lock-closed" size={12} color={c.textMid} /><Text style={s.badgeText}>Private · {d.members.length} {d.members.length === 1 ? "member" : "members"}{d.archived ? " · Closed" : ""}</Text></View>
      </View>
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}

      <View style={s.card}>
        <View style={s.rowHead}>
          <Text style={s.cardTitle}>Groups</Text>
          {admin && !d.archived ? <AppButton label="New group" size="sm" variant="secondary" icon="add" onPress={() => router.push({ pathname: "/groups/create", params: { communityId: d.id, communityName: d.name } } as any)} /> : null}
        </View>
        {!d.groups.length ? <Text style={s.hint}>{admin ? "No groups yet — create the first one." : "You haven't been added to any of its groups yet."}</Text> : null}
        {d.groups.map((g) => (
          <TouchableOpacity key={g.id} style={s.group} onPress={() => (g.member ? router.push(`/messages/${g.id}` as any) : router.push(`/groups/${g.id}` as any))} disabled={!g.member && !admin}
            accessibilityRole="button" accessibilityLabel={`${g.name}${g.isAnnouncements ? ", announcements" : ""}${g.member ? "" : ", you're not a member"}`}>
            <View style={s.groupIcon}><Ionicons name={g.isAnnouncements ? "megaphone-outline" : "people"} size={18} color={c.primaryGreen} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.groupName}>{g.name}</Text>
              <Text style={s.hint}>{g.isAnnouncements ? "Announcements · admins post" : g.member ? (g.myRole === "admin" ? "You're an administrator" : "Member") : "Not a member — visible to administrators"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
        ))}
        <Text style={s.hint}>Belonging to the community doesn't give access to every group — each group has its own members.</Text>
      </View>

      {admin && !d.archived ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>Add people</Text>
          {adding ? (
            <>
              <PeoplePicker value={people} onChange={setPeople} exclude={d.members.map((m) => m.id)} max={100} />
              <AppButton label={`Add ${people.length || ""}`} disabled={!people.length} onPress={() => act(() => addCommunityMembers(d.id, people.map((p) => p.id)), "Added.").then(() => { setPeople([]); setAdding(false); })} />
            </>
          ) : <AppButton label="Add members" variant="secondary" icon="person-add-outline" onPress={() => setAdding(true)} />}
          <AppButton label="Share an invite link" variant="secondary" icon="link-outline" onPress={() => act(async () => {
            const l = await createLink(d.id, {}, "community");
            await Share.share({ message: `Join “${d.name}” on P2P Global: ${Linking.createURL("/groups/join", { queryParams: { t: l.token } })}` }).catch(() => {});
          })} />
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.cardTitle}>Members</Text>
        {d.members.map((m) => (
          <View key={m.id} style={s.member}>
            <Avatar photoUrl={m.photoUrl} name={m.name} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={s.memberName}>{m.name}</Text>
              {m.role !== "member" ? <Text style={s.role}>{m.role === "owner" ? "Owner" : "Administrator"}</Text> : null}
            </View>
            {admin && m.role !== "owner" ? (
              <>
                <AppButton label={m.role === "admin" ? "Remove admin" : "Make admin"} size="sm" variant="tertiary" onPress={() => act(() => setCommunityAdmin(d.id, m.id, m.role !== "admin"))} />
                <IconButton icon="person-remove-outline" accessibilityLabel={`Remove ${m.name}`} color={c.textMid}
                  onPress={() => confirm(`Remove ${m.name}?`, "They also leave the community's groups.", () => act(() => removeCommunityMember(d.id, m.id), "Removed."))} />
              </>
            ) : null}
          </View>
        ))}
      </View>
      <View style={[s.card, { backgroundColor: "transparent", borderColor: "transparent" }]}>
        {admin ? (
          <AppButton label={d.archived ? "Reopen community" : "Close community"} variant="secondary"
            onPress={() => confirm(d.archived ? "Reopen the community?" : "Close the community?", d.archived ? "Its groups open again." : "Its groups close too; history stays.", () => act(() => updateCommunity(d.id, { archived: !d.archived }), "Saved."))} />
        ) : null}
        <AppButton label="Leave community" variant="tertiary" icon="exit-outline"
          onPress={() => confirm("Leave this community?", "You also leave its groups.", () => act(async () => { await removeCommunityMember(d.id, "me"); router.back(); }))} />
      </View>
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
    badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    badgeText: { fontSize: 11.5, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    notice: { marginHorizontal: 20, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    card: { marginHorizontal: 16, marginTop: 14, padding: 14, gap: 10, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    hint: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    group: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 },
    groupIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center" },
    groupName: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    member: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46 },
    memberName: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    role: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}
