import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TextInput, Alert, Platform } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import PassagePicker from "@/components/scripture/PassagePicker";
import { bibleRoute, getTranslations, type NewRef } from "@/lib/bibleReaderApi";
import { playSavedCollection } from "@/lib/listen/playlistSession";
import {
  activityLine, addToCollection, copyCollection, deleteCollection, getCollection, leaveCollection, originChanges, removeFromCollection,
  renameCollection, reorderCollection, setSharedNote, updateCollectionLook, PERMISSION_LABEL,
  type CollectionDetail, type CollectionItem,
} from "@/lib/scriptureCollectionsApi";
import { favouriteCollection, listFavourites, removeFavourite } from "@/lib/scriptureLibraryApi";
import { estimateMinutes } from "@/lib/libraryRules";
import CoverArt from "@/components/library/CoverArt";
import CoverPicker from "@/components/library/CoverPicker";

// One Scripture collection or playlist. What the reader can do comes from the
// server's answer (access.permission): View and Listen · Save a Copy ·
// Collaborative Editing; the owner manages sharing, links and shared notes.
// A copy is the reader's own and never changes when the original does — a
// note offers "See what's new" so they can choose what to add.
// Scripture Listening Library: a cover and tags, Play all / Shuffle through
// the one shared player (a collection is never a queue until I press Play),
// favourite, and an estimated listening time ("about N min" — never exact).

export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<CollectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; text: string } | null>(null);
  const [whatsNew, setWhatsNew] = useState<CollectionItem[] | null>(null);
  const [languages, setLanguages] = useState<Record<string, string>>({});
  const [favId, setFavId] = useState<string | null>(null);
  const [lookOpen, setLookOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try { setD(await getCollection(id)); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load this collection."); }
    listFavourites().then((f) => setFavId([...f.playlists, ...f.collections].find((x) => x.collectionId === id)?.id ?? null)).catch(() => {});
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { getTranslations().then((r) => setLanguages(Object.fromEntries(r.translations.map((t) => [t.code, t.language])))).catch(() => {}); }, []);

  /** Run a change; on any refusal (e.g. someone else just edited) show why and refresh. */
  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key); setNotice(null);
    try { await fn(); if (done) setNotice(done); }
    catch (e: any) { setNotice(e?.message ?? "That didn't work."); }
    finally { setBusy(null); await load(); }
  }
  const confirm = (title: string, message: string, onYes: () => void) => {
    if (Platform.OS === "web") { if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes(); return; }
    Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: title, style: "destructive", onPress: onYes }]);
  };

  if (!d) {
    return (
      <View style={[s.screen, s.center]}>
        <Stack.Screen options={{ title: "Collection" }} />
        {error ? <Text style={s.muted}>{error}</Text> : <ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" />}
      </View>
    );
  }

  const owner = d.access.role === "owner";
  const canEdit = d.access.permission === "collaborate";
  const canCopy = owner || d.access.permission === "copy" || d.access.permission === "collaborate";
  const canShare = owner || d.access.canReshare;
  const language = languages[d.items[0]?.translationCode ?? ""] ?? "en";
  const kindWord = d.kind === "playlist" ? "playlist" : "collection";
  const status = d.status === "original" ? (d.shares.length ? `Your ${kindWord} · shared with ${d.shares.length}` : `Your ${kindWord} · private`)
    : d.status === "copy" ? `Your personal copy of ${d.origin?.ownerName ?? "someone"}'s ${kindWord}`
      : `Shared with you by ${d.sharedByName ?? d.owner.name} · ${PERMISSION_LABEL[d.access.permission]}`;

  const move = (index: number, by: -1 | 1) => {
    const ids = d.items.map((i) => i.id);
    const [x] = ids.splice(index, 1);
    ids.splice(index + by, 0, x);
    act(`move:${x}`, () => reorderCollection(d.id, ids, d.revision));
  };
  const listen = (from?: string, shuffle = false) => act(shuffle ? "shuffle" : from ? `listen:${from}` : "listen", () => playSavedCollection(d.id, { startKey: from ?? null, shuffle }));
  const minutes = estimateMinutes(d.items);
  void language;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: d.kind === "playlist" ? "Playlist" : "Collection" }} />

      {/* Header */}
      <View style={s.hero}>
        <CoverArt cover={d.cover} kind={d.kind} size={132} />
        <View style={{ flex: 1, minWidth: 180, gap: 4 }}>
      <View style={s.badgeRow}>
        <View style={[s.badge, d.status === "shared" && { backgroundColor: `${c.amber}22` }]}>
          <Ionicons name={d.status === "original" ? "star-outline" : d.status === "copy" ? "copy-outline" : "people-outline"} size={13} color={d.status === "shared" ? c.amber : c.accentGreen} />
          <Text style={[s.badgeText, d.status === "shared" && { color: c.amber }]}>{d.status === "original" ? "Original" : d.status === "copy" ? "Personal copy" : "Shared with you"}</Text>
        </View>
        <Text style={s.kind}>{d.kind === "playlist" ? "Playlist" : "Collection"}</Text>
      </View>
      {renaming !== null ? (
        <View style={{ gap: 8 }}>
          <TextInput style={s.input} value={renaming} onChangeText={setRenaming} maxLength={120} autoFocus accessibilityLabel="Name" />
          <View style={s.row}>
            <AppButton label="Save" size="sm" disabled={!renaming.trim()} loading={busy === "rename"} onPress={() => { const t = renaming; setRenaming(null); act("rename", () => renameCollection(d.id, t, d.revision)); }} />
            <AppButton label="Cancel" size="sm" variant="tertiary" onPress={() => setRenaming(null)} />
          </View>
        </View>
      ) : <Text style={s.title} accessibilityRole="header">{d.title}</Text>}
      <Text style={s.status}>{status}</Text>
      <Text style={s.muted}>{d.items.length} {d.items.length === 1 ? "passage" : "passages"}{minutes ? ` · about ${minutes} min` : ""}{d.tags?.length ? ` · ${d.tags.join(", ")}` : ""}</Text>
      {d.status === "shared" ? <Text style={s.muted}>Owner: {d.owner.name}</Text> : null}
        </View>
      </View>
      {d.description ? <Text style={s.desc}>{d.description}</Text> : null}

      {d.origin?.changed && d.origin.available ? (
        <View style={s.banner}>
          <Ionicons name="sparkles-outline" size={16} color={c.accentGreen} />
          <Text style={[s.muted, { flex: 1 }]}>{d.origin.ownerName} has updated the original. Your copy hasn't changed.</Text>
          <AppButton label="See what's new" size="sm" variant="tertiary" onPress={() => act("new", async () => setWhatsNew((await originChanges(d.id)).newItems))} />
        </View>
      ) : null}
      {whatsNew ? (
        <View style={s.panel}>
          <Text style={s.section}>New in the original</Text>
          {!whatsNew.length ? <Text style={s.muted}>Nothing new to add — your copy already has every passage.</Text> : null}
          {whatsNew.map((i) => (
            <View key={i.id} style={s.newRow}>
              <Text style={[s.ref, { flex: 1 }]}>{i.reference}</Text>
              <AppButton label="Add" size="sm" variant="secondary" onPress={() => act(`add:${i.id}`, async () => { await addToCollection(d.id, [{ translationCode: i.translationCode, bookCode: i.bookCode, chapter: i.chapter, startVerse: i.startVerse, endVerse: i.endVerse }]); setWhatsNew((w) => w?.filter((x) => x.id !== i.id) ?? null); }, "Added to your copy.")} />
            </View>
          ))}
          <AppButton label="Done" size="sm" variant="tertiary" onPress={() => setWhatsNew(null)} />
        </View>
      ) : null}

      {/* Actions */}
      <View style={s.actions}>
        <AppButton label="Play all" icon="play" onPress={() => listen()} disabled={!d.items.length} loading={busy === "listen"} />
        <AppButton label="Shuffle" icon="shuffle" variant="secondary" onPress={() => listen(undefined, true)} disabled={d.items.length < 2} loading={busy === "shuffle"} />
        <IconButton icon={favId ? "heart" : "heart-outline"} color={favId ? c.accentGreen : undefined} accessibilityLabel={favId ? "Remove from favourites" : "Add to favourites"} selected={!!favId}
          onPress={() => act("fav", async () => { if (favId) { await removeFavourite(favId); setFavId(null); } else setFavId((await favouriteCollection(d.id)).id); })} />
        {canEdit ? <AppButton label="Add Scripture" icon="search-outline" variant="tertiary" onPress={() => router.push({ pathname: "/library/add", params: { to: d.id } } as any)} /> : null}
        {owner ? <AppButton label="Cover & tags" icon="color-palette-outline" variant="tertiary" onPress={() => setLookOpen(true)} /> : null}
        {canShare ? <AppButton label="Share" icon="share-social-outline" variant="secondary" onPress={() => router.push({ pathname: "/scripture-collections/share", params: { id: d.id } } as any)} /> : null}
        {!owner && canCopy ? <AppButton label="Save a copy" icon="copy-outline" variant="secondary" loading={busy === "copy"}
          onPress={() => act("copy", async () => { const r = await copyCollection(d.id); router.push({ pathname: "/scripture-collections/[id]", params: { id: r.id } } as any); })} /> : null}
        {canCopy && d.kind === "collection" && d.items.length ? <AppButton label="Make a playlist" icon="musical-notes-outline" variant="tertiary" loading={busy === "playlist"}
          onPress={() => act("playlist", async () => { const r = await copyCollection(d.id, { kind: "playlist", title: `${d.title} — playlist` }); router.push({ pathname: "/scripture-collections/[id]", params: { id: r.id } } as any); })} /> : null}
      </View>
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}

      {/* Passages */}
      <View style={s.sectionRow}>
        <Text style={s.section}>{d.items.length} {d.items.length === 1 ? "passage" : "passages"}</Text>
        {canEdit ? <AppButton label="Add passages" icon="add" size="sm" variant="tertiary" onPress={() => setPicking(true)} /> : null}
      </View>
      {!d.items.length ? <Text style={s.muted}>{canEdit ? "Add passages from your saved passages, or use “Add to collection” when you select verses in the Bible reader." : "No passages yet."}</Text> : null}
      {d.items.map((i, index) => (
        <View key={i.id} style={s.item}>
          <Text style={s.pos} accessibilityElementsHidden>{index + 1}</Text>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.ref}>{i.reference} <Text style={s.trans}>{i.translationCode}</Text></Text>
            {i.sharedNote ? <Text style={s.note}>“{i.sharedNote}”{d.status !== "original" ? ` — ${d.owner.name}` : ""}</Text> : null}
            {i.addedByName ? <Text style={s.muted}>Added by {i.addedByName}</Text> : null}
            {noteFor?.id === i.id ? (
              <View style={{ gap: 6, marginTop: 4 }}>
                <Text style={s.muted}>A note for the people you share with. Your private notes are never shared.</Text>
                <TextInput style={[s.input, { minHeight: 64 }]} multiline value={noteFor.text} onChangeText={(t) => setNoteFor({ id: i.id, text: t })} maxLength={1000} accessibilityLabel="Note for sharing" />
                <View style={s.row}>
                  <AppButton label="Save note" size="sm" onPress={() => { const n = noteFor; setNoteFor(null); act(`note:${i.id}`, () => setSharedNote(d.id, i.id, n.text.trim() || null)); }} />
                  <AppButton label="Cancel" size="sm" variant="tertiary" onPress={() => setNoteFor(null)} />
                </View>
              </View>
            ) : null}
            <View style={s.itemActions}>
              <AppButton label="Read" size="sm" variant="tertiary" icon="book-outline"
                onPress={() => router.push(bibleRoute({ book: i.bookCode, chapter: i.chapter, v: i.startVerse, ve: i.endVerse, translation: i.translationCode }) as any)} accessibilityLabel={`Read ${i.reference}`} />
              <AppButton label="Play from here" size="sm" variant="tertiary" icon="play-outline" loading={busy === `listen:${i.id}`} onPress={() => listen(i.id)} accessibilityLabel={`Play from ${i.reference}`} />
              {owner && noteFor?.id !== i.id ? <AppButton label={i.sharedNote ? "Edit note" : "Add note"} size="sm" variant="tertiary" icon="create-outline" onPress={() => setNoteFor({ id: i.id, text: i.sharedNote ?? "" })} /> : null}
            </View>
          </View>
          {canEdit ? (
            <View style={s.reorder}>
              <IconButton icon="chevron-up" accessibilityLabel={`Move ${i.reference} up`} onPress={() => move(index, -1)} disabled={index === 0 || !!busy} />
              <IconButton icon="chevron-down" accessibilityLabel={`Move ${i.reference} down`} onPress={() => move(index, 1)} disabled={index === d.items.length - 1 || !!busy} />
              <IconButton icon="trash-outline" accessibilityLabel={`Remove ${i.reference}`} color={c.textMuted}
                onPress={() => confirm("Remove", `Remove ${i.reference} from this ${kindWord}?`, () => act(`rm:${i.id}`, () => removeFromCollection(d.id, i.id, d.revision)))} />
            </View>
          ) : null}
        </View>
      ))}

      {/* History (owner and collaborators) */}
      {d.activity.length ? (
        <View style={s.panel}>
          <Text style={s.section}>Activity</Text>
          {d.activity.slice(0, 20).map((a, n) => (
            <Text key={n} style={s.muted}>{activityLine(a)} · {new Date(a.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Text>
          ))}
        </View>
      ) : null}

      {/* Manage */}
      <View style={[s.row, { marginTop: 18 }]}>
        {owner ? <AppButton label="Rename" size="sm" variant="tertiary" icon="pencil-outline" onPress={() => setRenaming(d.title)} /> : null}
        {owner ? <AppButton label="Duplicate" size="sm" variant="tertiary" icon="copy-outline" loading={busy === "dup"}
          onPress={() => act("dup", async () => { const r = await copyCollection(d.id, { title: `${d.title} (copy)` }); router.push({ pathname: "/scripture-collections/[id]", params: { id: r.id } } as any); })} /> : null}
        {owner ? <AppButton label={`Delete ${kindWord}`} size="sm" variant="destructive" icon="trash-outline"
          onPress={() => confirm("Delete", `Delete “${d.title}”? People you shared it with lose access. Copies they saved stay theirs.`, () => act("delete", async () => { await deleteCollection(d.id); router.back(); }))} /> : null}
        {!owner ? <AppButton label="Remove from my list" size="sm" variant="tertiary" icon="exit-outline"
          onPress={() => confirm("Remove", "You'll no longer see this unless it's shared with you again.", () => act("leave", async () => { await leaveCollection(d.id); router.back(); }))} /> : null}
      </View>

      <CoverPicker visible={lookOpen} kind={d.kind} cover={d.cover ?? null} tags={d.tags ?? []} onClose={() => setLookOpen(false)}
        onSave={async (look) => { await updateCollectionLook(d.id, d.revision, look); await load(); }} />
      <PassagePicker visible={picking} onClose={() => setPicking(false)} title={`Add to “${d.title}”`}
        onChoose={(refs: NewRef[]) => { setPicking(false); act("add", () => addToCollection(d.id, refs), `Added ${refs.length} ${refs.length === 1 ? "passage" : "passages"}.`); }} />
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", padding: 24 },
    content: { padding: 16, paddingBottom: 56 },
    hero: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 16, marginBottom: 4 },
    pos: { width: 22, fontSize: 13, color: c.textMuted, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 2 },
    badgeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
    badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: `${c.accentGreen}1A` },
    badgeText: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    kind: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 1, textTransform: "uppercase" },
    title: { fontSize: 24, lineHeight: 30, color: c.textDark, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
    status: { fontSize: 13, lineHeight: 18, color: c.textMid, fontFamily: "Inter_500Medium", marginTop: 4 },
    desc: { fontSize: 14, lineHeight: 20, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 8 },
    muted: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    banner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 14, backgroundColor: c.card, marginTop: 12, flexWrap: "wrap" },
    panel: { padding: 14, borderRadius: 16, backgroundColor: c.card, gap: 6, marginTop: 12 },
    newRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
    notice: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium", marginTop: 10 },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 8 },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    item: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 16, backgroundColor: c.card, marginBottom: 8 },
    ref: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    trans: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    note: { fontSize: 13, lineHeight: 18, color: c.textMid, fontFamily: "Inter_400Regular", fontStyle: "italic" },
    itemActions: { flexDirection: "row", flexWrap: "wrap", gap: 2, marginTop: 2, marginLeft: -8 },
    reorder: { alignItems: "center", justifyContent: "flex-start" },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.lightCream, fontFamily: "Inter_400Regular", fontSize: 15 },
  });
}
