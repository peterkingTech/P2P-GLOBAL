import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { Avatar } from "@/components/Avatar";
import { AppButton } from "@/components/ui";
import { timeAgo } from "@/lib/timeFormat";
import { deleteDraft, listDrafts, listMail, type MailDraft, type MailFolder, type MailThreadSummary } from "@/lib/mailApi";

// P2P Mail: formal correspondence inside P2P Global — Inbox, Sent, Drafts, Archived and Search. It is a
// separate system from Chats (nothing here is a chat message). `withUser` narrows it to one person
// (opened from a chat's "P2P Mail" button).
type Folder = MailFolder | "drafts";
const FOLDERS: { key: Folder; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "inbox", label: "Inbox", icon: "mail-outline" },
  { key: "sent", label: "Sent", icon: "paper-plane-outline" },
  { key: "drafts", label: "Drafts", icon: "document-outline" },
  { key: "archived", label: "Archived", icon: "archive-outline" },
];

export default function MailHome({ withUser, bottomPad = 90, onUnreadChange }: { withUser?: { id: string; name: string } | null; bottomPad?: number; onUnreadChange?: (n: number) => void }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [q, setQ] = useState("");
  const [threads, setThreads] = useState<MailThreadSummary[] | null>(null);
  const [drafts, setDrafts] = useState<MailDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (folder === "drafts") { setDrafts((await listDrafts()).drafts); return; }
      const r = await listMail(folder, { q, with: withUser?.id });
      setThreads(r.threads);
      if (folder === "inbox" && !q && !withUser) onUnreadChange?.(r.threads.filter((t) => t.unread > 0).length);
    } catch (e: any) { setError(e?.message ?? "P2P Mail didn't load."); }
  }, [folder, q, withUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { const h = setTimeout(load, q ? 250 : 0); return () => clearTimeout(h); }, [load, q]));

  const compose = () => router.push({ pathname: "/mail/compose", params: withUser ? { to: withUser.id, toName: withUser.name } : {} } as any);
  const list = folder === "drafts" ? drafts : threads;
  return (
    <View style={{ flex: 1 }}>
      <View style={s.controls}>
        {withUser ? <Text style={s.withNote}>P2P Mail with {withUser.name} — separate from your chat.</Text> : null}
        <View style={s.folderRow} accessibilityRole="tablist">
          {FOLDERS.map((f) => (
            <TouchableOpacity key={f.key} style={[s.folder, folder === f.key && s.folderOn]} onPress={() => setFolder(f.key)} accessibilityRole="tab" accessibilityState={{ selected: folder === f.key }}>
              <Ionicons name={f.icon} size={14} color={folder === f.key ? "#fff" : c.textMid} />
              <Text style={[s.folderText, folder === f.key && s.folderTextOn]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {folder !== "drafts" ? (
          <View style={s.search}>
            <Ionicons name="search" size={16} color={c.textMuted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search P2P Mail" placeholderTextColor={c.textMuted} style={s.searchInput} accessibilityLabel="Search P2P Mail" autoCorrect={false} />
            {q ? <TouchableOpacity onPress={() => setQ("")} accessibilityLabel="Clear search" accessibilityRole="button"><Ionicons name="close-circle" size={16} color={c.textMuted} /></TouchableOpacity> : null}
          </View>
        ) : null}
        <AppButton label="Write P2P Mail" icon="create-outline" onPress={compose} variant="secondary" />
      </View>

      {error ? (
        <TouchableOpacity style={s.error} onPress={load} accessibilityRole="button"><Ionicons name="warning-outline" size={16} color={c.amber} /><Text style={s.errorText}>{error} Tap to try again.</Text></TouchableOpacity>
      ) : null}
      {!list && !error ? (
        <View style={s.center}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading P2P Mail" /></View>
      ) : folder === "drafts" ? (
        <FlatList data={drafts ?? []} keyExtractor={(d) => d.id} contentContainerStyle={{ paddingBottom: bottomPad }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          ListEmptyComponent={<Empty s={s} c={c} icon="document-outline" title="No drafts" sub="Letters you start and don't send yet are kept here." />}
          renderItem={({ item: d }) => (
            <TouchableOpacity style={s.row} onPress={() => router.push({ pathname: "/mail/compose", params: { draft: d.id } } as any)} onLongPress={() => deleteDraft(d.id).then(load)} accessibilityRole="button"
              accessibilityLabel={`Draft: ${d.subject || "No subject"}${d.to.length ? `, to ${d.to.map((p) => p.name).join(", ")}` : ""}. Long press to delete`}>
              <View style={s.draftIcon}><Ionicons name="document-text-outline" size={20} color={c.textMid} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.subject} numberOfLines={1}>{d.subject || "No subject"}</Text>
                <Text style={s.meta} numberOfLines={1}>{d.to.length ? `To ${d.to.map((p) => p.name).join(", ")}` : "No recipient yet"} · {d.body.replace(/\s+/g, " ").slice(0, 60)}</Text>
              </View>
              <Text style={s.time}>{timeAgo(d.updatedAt, "compact")}</Text>
            </TouchableOpacity>
          )} />
      ) : (
        <FlatList data={threads ?? []} keyExtractor={(t) => t.id} contentContainerStyle={{ paddingBottom: bottomPad }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          ListEmptyComponent={<Empty s={s} c={c} icon={folder === "sent" ? "paper-plane-outline" : folder === "archived" ? "archive-outline" : "mail-open-outline"}
            title={q ? "No mail found" : folder === "inbox" ? "Your inbox is empty" : folder === "sent" ? "Nothing sent yet" : "Nothing archived"}
            sub={q ? `Nothing in ${folder} matches “${q}”.` : folder === "inbox" ? "Formal letters from other participants and official P2P correspondence arrive here." : folder === "sent" ? "Letters you write appear here." : "Archive a letter to keep your inbox tidy."} />}
          renderItem={({ item: t }) => {
            const unread = t.unread > 0;
            const other = t.with[0];
            return (
              <TouchableOpacity style={s.row} onPress={() => router.push(`/mail/${t.id}` as any)} accessibilityRole="button"
                accessibilityLabel={`${t.isOfficial ? "Official. " : ""}${unread ? "Unread. " : ""}${t.subject}, ${folder === "sent" ? `to ${t.with.map((w) => w.name).join(", ")}` : `from ${t.from?.name ?? ""}`}`}>
                {t.isOfficial ? <View style={s.seal}><Ionicons name="shield-checkmark" size={20} color="#fff" /></View> : <Avatar photoUrl={other?.photoUrl ?? null} name={other?.name ?? "?"} size={42} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={s.line}>
                    {unread ? <View style={s.dot} /> : null}
                    <Text style={[s.who, unread && s.bold]} numberOfLines={1}>
                      {folder === "sent" ? `To ${t.with.map((w) => w.name).join(", ")}` : t.from?.name ?? other?.name ?? "P2P participant"}
                    </Text>
                    {t.isOfficial ? <Text style={s.official}>OFFICIAL</Text> : null}
                  </View>
                  <Text style={[s.subject, unread && s.bold]} numberOfLines={1}>{t.subject}</Text>
                  <Text style={s.meta} numberOfLines={1}>{t.snippet}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={s.time}>{timeAgo(t.lastMessageAt, "compact")}</Text>
                  {t.letters > 1 ? <Text style={s.count}>{t.letters}</Text> : null}
                </View>
              </TouchableOpacity>
            );
          }} />
      )}
    </View>
  );
}

function Empty({ s, c, icon, title, sub }: { s: ReturnType<typeof makeStyles>; c: AppColors; icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }) {
  return (
    <View style={s.center}>
      <Ionicons name={icon} size={42} color={c.borderBeige} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptySub}>{sub}</Text>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    controls: { paddingHorizontal: 20, gap: 10, paddingBottom: 8 },
    withNote: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_500Medium" },
    folderRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
    folder: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 34, paddingHorizontal: 11, borderRadius: 17, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    folderOn: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    folderText: { fontSize: 12.5, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    folderTextOn: { color: "#fff" },
    search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 42, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    searchInput: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", paddingVertical: 6 },
    error: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginBottom: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.amber },
    errorText: { flex: 1, fontSize: 12.5, color: c.textDark, fontFamily: "Inter_400Regular" },
    center: { alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40, paddingTop: 48 },
    emptyTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    emptySub: { fontSize: 13, color: c.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 19 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    seal: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.primaryGreen, alignItems: "center", justifyContent: "center" },
    draftIcon: { width: 42, height: 42, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    line: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accentGreen },
    who: { fontSize: 13.5, color: c.textMid, fontFamily: "Inter_500Medium", flexShrink: 1 },
    bold: { color: c.textDark, fontFamily: "Inter_700Bold" },
    official: { fontSize: 9.5, letterSpacing: 0.6, color: c.primaryGreen, fontFamily: "Inter_700Bold", borderWidth: 1, borderColor: c.primaryGreen, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
    subject: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular" },
    time: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    count: { fontSize: 11, color: c.textMid, fontFamily: "Inter_600SemiBold" },
  });
}
