import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Modal, ScrollView, Pressable, ActivityIndicator, TextInput, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton, SegmentedControl } from "@/components/ui";
import CoverArt from "@/components/library/CoverArt";
import { saveBookmark, type NewRef } from "@/lib/bibleReaderApi";
import { addToCollection, createCollection, listCollections, type CollectionCard, type CollectionKind } from "@/lib/scriptureCollectionsApi";
import { saveScripture } from "@/lib/scriptureLibraryApi";
import { filterCards } from "@/lib/libraryRules";

// Save Scripture: one or more passages into several places in one go —
// My Saved Scriptures (on by default), Favourites, any of my playlists and
// collections (and ones shared with me for collaborative editing), or a new
// one. Only the reference is saved; the same passage is never stored twice
// (a playlist that already has it says so). Notes and highlights stay private.
export interface SaveTarget { ref: NewRef; reference: string }

export default function SaveScriptureSheet({ visible, targets, onClose, onDone, initialCollectionIds = [] }: {
  visible: boolean; targets: SaveTarget[]; onClose: () => void; onDone: (message: string) => void; initialCollectionIds?: string[];
}) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<CollectionCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [favourite, setFavourite] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState<CollectionKind | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setList(null); setError(null); setSaved(true); setFavourite(false); setChosen(new Set(initialCollectionIds)); setQuery(""); setNaming(null); setName("");
    listCollections()
      // Recently used first: the ones I changed most recently.
      .then((r) => setList([...r.mine, ...r.shared.filter((x) => x.permission === "collaborate")].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))))
      .catch((e: any) => { setError(e?.message ?? "Couldn't load your playlists."); setList([]); });
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setChosen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function create() {
    if (!naming || !name.trim()) return;
    setBusy("create");
    try {
      const { id } = await createCollection(naming, name.trim());
      const card: CollectionCard = { id, kind: naming, title: name.trim(), description: null, itemCount: 0, updatedAt: new Date().toISOString(), isCopy: false, originOwnerName: null };
      setList((l) => [card, ...(l ?? [])]); setChosen((cur) => new Set(cur).add(id)); setNaming(null); setName("");
    } catch (e: any) { setError(e?.message ?? "Couldn't create it."); }
    finally { setBusy(null); }
  }

  async function save() {
    setBusy("save"); setError(null);
    const ids = Array.from(chosen);
    const added: string[] = [], already: string[] = [], failed: string[] = [];
    const titleOf = (id: string) => list?.find((x) => x.id === id)?.title ?? "a playlist";
    try {
      for (const t of targets) {
        try {
          const r = await saveScripture(t.ref, { saved, favourite, collectionIds: ids });
          for (const x of r.collections) (x.status === "added" ? added : x.status === "already" ? already : failed).push(titleOf(x.id));
        } catch (e: any) {
          // Before the Library is switched on (migration 227): the existing save and add still work.
          if (e?.status !== 503 || favourite) throw e;
          if (saved) await saveBookmark(t.ref);
          for (const id of ids) { const r = await addToCollection(id, [t.ref]); (r.added === 0 ? already : added).push(titleOf(id)); }
        }
      }
      const what = targets.length === 1 ? targets[0].reference : `${targets.length} passages`;
      const uniq = (a: string[]) => Array.from(new Set(a));
      const parts = [
        saved ? "saved" : null, favourite ? "added to Favourites" : null,
        added.length ? `added to ${uniq(added).join(", ")}` : null,
        already.length ? `already in ${uniq(already).join(", ")}` : null,
        failed.length ? `couldn't be added to ${uniq(failed).join(", ")}` : null,
      ].filter(Boolean);
      onDone(`${what}: ${parts.join(" · ") || "nothing chosen"}.`);
    } catch (e: any) { setError(e?.message ?? "Couldn't save it."); }
    finally { setBusy(null); }
  }

  const shown = list ? filterCards(list, "all", new Set(), query) : [];
  const nothing = !saved && !favourite && !chosen.size;
  const label = targets.length === 1 ? targets[0].reference : `${targets.length} passages`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
          <View style={s.head}>
            <Text style={s.title} numberOfLines={2} accessibilityRole="header">Save {label}</Text>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
          </View>
          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
            <View style={s.switchRow}>
              <Ionicons name="bookmark" size={20} color={c.accentGreen} />
              <Text style={s.name}>My Saved Scriptures</Text>
              <Switch value={saved} onValueChange={setSaved} accessibilityLabel="Save in My Saved Scriptures" trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
            </View>
            <View style={s.switchRow}>
              <Ionicons name="heart" size={20} color={c.accentGreen} />
              <Text style={s.name}>Favourites</Text>
              <Switch value={favourite} onValueChange={setFavourite} accessibilityLabel="Add to Favourites" trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
            </View>

            <Text style={s.section}>Playlists and collections</Text>
            <TextInput style={s.input} value={query} onChangeText={setQuery} placeholder="Search your playlists" placeholderTextColor={c.textMuted} accessibilityLabel="Search your playlists and collections" />
            {!list ? <ActivityIndicator color={c.accentGreen} style={{ margin: 16 }} accessibilityLabel="Loading" /> : null}
            {shown.map((x) => {
              const on = chosen.has(x.id);
              return (
                <Pressable key={x.id} style={s.row} onPress={() => toggle(x.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  accessibilityLabel={`${x.title}, ${x.kind}, ${x.itemCount} passages`}>
                  <CoverArt cover={x.cover} kind={x.kind} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{x.title}</Text>
                    <Text style={s.muted}>{x.kind === "playlist" ? "Playlist" : "Collection"} · {x.itemCount} {x.itemCount === 1 ? "passage" : "passages"}{x.ownerName ? ` · ${x.ownerName}'s` : ""}</Text>
                  </View>
                  <Ionicons name={on ? "checkbox" : "square-outline"} size={24} color={on ? c.accentGreen : c.textMuted} />
                </Pressable>
              );
            })}
            {list && !list.length ? <Text style={s.muted}>No playlists or collections yet — create one below.</Text> : null}
            {naming ? (
              <View style={{ gap: 8, marginTop: 10 }}>
                <SegmentedControl accessibilityLabel="Create" value={naming} onChange={(v) => setNaming(v as CollectionKind)} options={[{ value: "playlist", label: "Playlist" }, { value: "collection", label: "Collection" }]} />
                <TextInput style={s.input} value={name} onChangeText={setName} autoFocus maxLength={120} placeholder={`Name your new ${naming}`} placeholderTextColor={c.textMuted}
                  onSubmitEditing={create} accessibilityLabel={`Name of the new ${naming}`} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <AppButton label="Create" size="sm" onPress={create} disabled={!name.trim()} loading={busy === "create"} />
                  <AppButton label="Cancel" size="sm" variant="tertiary" onPress={() => setNaming(null)} />
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <AppButton label="New playlist" icon="add" size="sm" variant="tertiary" onPress={() => setNaming("playlist")} />
                <AppButton label="New collection" icon="add" size="sm" variant="tertiary" onPress={() => setNaming("collection")} />
              </View>
            )}
          </ScrollView>
          {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
          <AppButton label={chosen.size ? `Save to ${chosen.size + (saved ? 1 : 0) + (favourite ? 1 : 0)} places` : "Save"} icon="checkmark" fullWidth onPress={save} disabled={nothing} loading={busy === "save"} style={{ marginTop: 10 }} />
          <Text style={[s.muted, { marginTop: 8 }]}>Only the reference is saved. Your notes and highlights stay private.</Text>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, maxWidth: 640, width: "100%", alignSelf: "center" },
    head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    section: { fontSize: 13, color: c.textMid, fontFamily: "Inter_700Bold", marginTop: 14, marginBottom: 8 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52 },
    muted: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    error: { fontSize: 13, color: "#C0392B", fontFamily: "Inter_500Medium", marginTop: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 6, borderRadius: 12 },
    name: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.card, fontFamily: "Inter_400Regular", fontSize: 15, marginBottom: 6 },
  });
}
