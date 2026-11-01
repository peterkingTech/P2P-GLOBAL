import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Switch, Share, Alert, Platform } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, SegmentedControl } from "@/components/ui";
import {
  collectionLinkUrl, createLink, getCollection, revokeLink, revokeShare, shareCollection, shareTargets,
  PERMISSION_HELP, PERMISSION_LABEL, TARGET_LABEL,
  type CollectionDetail, type Permission, type ShareTargets, type TargetType,
} from "@/lib/scriptureCollectionsApi";

// Share a Scripture collection or playlist: with people you're connected with
// on P2P, your Family Circles, Circles, Groups and Study Together studies
// (churches: their leaders), at one of three levels. The owner sees everyone
// who has access and can remove anyone; links (owner only) open a view-only
// preview on the website and work fully once the person has the app and signs
// in. Every rule is checked again by the server.

const EXPIRY = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "never", label: "No expiry" }];
const LIMIT = [{ value: "any", label: "Anyone with it" }, { value: "1", label: "1 person" }, { value: "10", label: "Up to 10" }];

export default function ShareCollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<CollectionDetail | null>(null);
  const [targets, setTargets] = useState<ShareTargets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, TargetType>>({});
  const [permission, setPermission] = useState<Permission>("view");
  const [reshare, setReshare] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkPerm, setLinkPerm] = useState<"view" | "copy">("view");
  const [expiry, setExpiry] = useState("30");
  const [limit, setLimit] = useState("any");
  const [newLink, setNewLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [detail, t] = await Promise.all([getCollection(id), shareTargets()]);
      setD(detail); setTargets(t); setError(null);
    } catch (e: any) { setError(e?.message ?? "Couldn't load sharing."); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!d || !targets) {
    return <View style={[s.screen, s.center]}><Stack.Screen options={{ title: "Share" }} />{error ? <Text style={s.muted}>{error}</Text> : <ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" />}</View>;
  }
  const owner = d.access.role === "owner";
  // A resharer can give at most their own level, and never editing.
  const levels: Permission[] = owner ? ["view", "copy", "collaborate"] : (["view", "copy"] as Permission[]).filter((p) => p === "view" || d.access.permission !== "view");
  const chosen = Object.entries(picked).map(([tid, type]) => ({ id: tid, type }));
  const toggle = (tid: string, type: TargetType) => setPicked((p) => { const n = { ...p }; if (n[tid]) delete n[tid]; else n[tid] = type; return n; });

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key); setNotice(null);
    try { await fn(); if (done) setNotice(done); }
    catch (e: any) { setNotice(e?.message ?? "That didn't work."); }
    finally { setBusy(null); await load(); }
  }
  const ask = (title: string, message: string, buttons: { text: string; onPress: () => void; destructive?: boolean }[]) => {
    if (Platform.OS === "web") { if (globalThis.confirm?.(`${title}\n\n${message}`)) buttons[0].onPress(); return; }
    Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, ...buttons.map((b) => ({ text: b.text, style: b.destructive ? "destructive" as const : "default" as const, onPress: b.onPress }))]);
  };
  const shareLinkText = (url: string) => `${d.title} — Scripture ${d.kind === "playlist" ? "playlist" : "collection"} on P2P Global:\n${url}`;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: `Share “${d.title}”` }} />
      <Text style={s.muted}>Private until you share it. Only the passages{owner ? " and the notes you wrote for sharing" : ""} are shared — never your private notes, highlights, reflections or prayers.</Text>

      {/* Who */}
      <Text style={s.section}>People</Text>
      {!targets.people.length ? <Text style={s.muted}>People you're connected with on P2P appear here.</Text> : null}
      {targets.people.map((p) => (
        <Pick key={p.id} s={s} c={c} on={!!picked[p.id]} label={p.name} sub={p.relationship === "peer_guide" ? "Your Peer Guide" : p.relationship === "disciple" ? "Your disciple" : "Connection"}
          icon="person-outline" onPress={() => toggle(p.id, "peer")} />
      ))}
      <Text style={s.section}>Groups</Text>
      {!targets.groups.length ? <Text style={s.muted}>Your Family Circles, Circles, Groups and Study Together studies appear here.</Text> : null}
      {targets.groups.map((g) => (
        <Pick key={`${g.type}:${g.id}`} s={s} c={c} on={!!picked[g.id]} label={g.name} sub={TARGET_LABEL[g.type]}
          icon={g.type === "family" ? "home-outline" : g.type === "church" ? "business-outline" : g.type === "study" ? "book-outline" : "people-outline"} onPress={() => toggle(g.id, g.type)} />
      ))}

      {/* What they can do */}
      <Text style={s.section}>What they can do</Text>
      <SegmentedControl accessibilityLabel="Permission" value={permission} onChange={(v) => setPermission(v as Permission)} options={levels.map((p) => ({ value: p, label: PERMISSION_LABEL[p] }))} />
      <Text style={[s.muted, { marginTop: 6 }]}>{PERMISSION_HELP[permission]}</Text>
      {owner ? (
        <View style={s.switchRow}>
          <Text style={[s.label, { flex: 1 }]}>Let them share it with others</Text>
          <Switch value={reshare} onValueChange={setReshare} accessibilityLabel="Let them share it with others" />
        </View>
      ) : null}
      <AppButton label={chosen.length ? `Share with ${chosen.length}` : "Choose who to share with"} icon="send-outline" fullWidth disabled={!chosen.length} loading={busy === "share"} style={{ marginTop: 12 }}
        onPress={() => run("share", async () => { await shareCollection(d.id, chosen, permission, reshare); setPicked({}); }, "Shared. They'll get a notification.")} />
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}

      {/* Who has access */}
      <Text style={s.section}>{owner ? "Who has access" : "People you shared with"}</Text>
      {!d.shares.length ? <Text style={s.muted}>{owner ? "Only you." : "Nobody yet."}</Text> : null}
      {d.shares.map((x) => (
        <View key={x.id} style={s.accessRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{x.name} <Text style={s.muted}>· {TARGET_LABEL[x.targetType]}</Text></Text>
            <Text style={s.muted}>{PERMISSION_LABEL[x.permission]}{x.canReshare ? " · can share" : ""}{x.viaLink ? " · joined by link" : ""}{x.sharedByName && owner && x.sharedByName !== d.owner.name ? ` · shared by ${x.sharedByName}` : ""}</Text>
          </View>
          <AppButton label="Remove" size="sm" variant="tertiary" loading={busy === x.id}
            onPress={() => ask("Remove access", `${x.name} will no longer see this.`, [{ text: "Remove", destructive: true, onPress: () => run(x.id, () => revokeShare(d.id, x.id)) }])} />
        </View>
      ))}

      {/* Links (owner) */}
      {owner ? (
        <>
          <Text style={s.section}>Share a link</Text>
          <Text style={s.muted}>Anyone can open the link to see a preview on the P2P Global website: the title, the passages and the first passage. To listen or save it, they get the app and sign in. Links never allow editing.</Text>
          <Text style={s.small}>They can</Text>
          <SegmentedControl accessibilityLabel="Link permission" value={linkPerm} onChange={(v) => setLinkPerm(v as "view" | "copy")} options={[{ value: "view", label: PERMISSION_LABEL.view }, { value: "copy", label: PERMISSION_LABEL.copy }]} />
          <Text style={s.small}>Expires</Text>
          <SegmentedControl accessibilityLabel="Link expiry" value={expiry} onChange={setExpiry} options={EXPIRY} />
          <Text style={s.small}>Who can join</Text>
          <SegmentedControl accessibilityLabel="How many can join" value={limit} onChange={setLimit} options={LIMIT} />
          <AppButton label="Create link" icon="link-outline" variant="secondary" fullWidth style={{ marginTop: 12 }} loading={busy === "link"}
            onPress={() => run("link", async () => {
              const r = await createLink(d.id, linkPerm, expiry === "never" ? null : Number(expiry), limit === "any" ? null : Number(limit));
              setNewLink(collectionLinkUrl(r.token));
            })} />
          {newLink ? (
            <View style={s.linkBox}>
              <Text style={s.label} selectable numberOfLines={2}>{newLink}</Text>
              <Text style={s.muted}>Copy it now — for your safety it isn't shown again.</Text>
              <View style={s.row}>
                <AppButton label="Copy" size="sm" icon="copy-outline" onPress={async () => { await Clipboard.setStringAsync(newLink); setNotice("Link copied"); }} />
                <AppButton label="Share" size="sm" variant="secondary" icon="share-social-outline" onPress={() => { Share.share({ message: shareLinkText(newLink) }).catch(() => {}); }} />
              </View>
            </View>
          ) : null}
          {d.links.map((l) => (
            <View key={l.id} style={s.accessRow}>
              <Ionicons name="link-outline" size={18} color={l.state === "ok" ? c.accentGreen : c.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{PERMISSION_LABEL[l.permission]} link</Text>
                <Text style={s.muted}>
                  {l.state === "ok" ? "Active" : l.state === "revoked" ? "Turned off" : l.state === "expired" ? "Expired" : "Full"} · {l.uses} joined{l.maxUses ? ` of ${l.maxUses}` : ""}
                  {l.expiresAt && l.state === "ok" ? ` · until ${new Date(l.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
                </Text>
              </View>
              {l.state === "ok" ? <AppButton label="Turn off" size="sm" variant="tertiary" loading={busy === l.id}
                onPress={() => ask("Turn off link", "The link stops working at once. Do you also want to remove the people who joined through it?", [
                  { text: "Turn off and remove them", destructive: true, onPress: () => run(l.id, () => revokeLink(d.id, l.id, true)) },
                  { text: "Just turn off", onPress: () => run(l.id, () => revokeLink(d.id, l.id, false)) },
                ])} /> : null}
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function Pick({ s, c, on, label, sub, icon, onPress }: { s: ReturnType<typeof makeStyles>; c: AppColors; on: boolean; label: string; sub: string; icon: string; onPress: () => void }) {
  return (
    <Pressable style={[s.pick, on && { backgroundColor: `${c.accentGreen}14` }]} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${label}, ${sub}`}>
      <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? c.accentGreen : c.textMuted} />
      <Ionicons name={icon as any} size={18} color={c.textMid} />
      <View style={{ flex: 1 }}>
        <Text style={s.label} numberOfLines={2}>{label}</Text>
        <Text style={s.muted}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", padding: 24 },
    content: { padding: 16, paddingBottom: 56 },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 22, marginBottom: 8 },
    small: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 12, marginBottom: 6 },
    label: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    muted: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    notice: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium", marginTop: 10 },
    pick: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingHorizontal: 10, borderRadius: 12 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, minHeight: 44 },
    accessRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: c.card, marginBottom: 8 },
    linkBox: { padding: 12, borderRadius: 14, backgroundColor: c.card, gap: 8, marginTop: 10 },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  });
}
