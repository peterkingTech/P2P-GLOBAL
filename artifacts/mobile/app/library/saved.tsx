import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Platform } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton, SegmentedControl } from "@/components/ui";
import SaveScriptureSheet, { type SaveTarget } from "@/components/library/SaveScriptureSheet";
import { bibleRoute, getLibrary, removeBookmark, type Bookmark } from "@/lib/bibleReaderApi";
import { favouritePassage, listSaved, updateSaved, MEMORISATION_LABEL, type Memorisation, type SavedScripture } from "@/lib/scriptureLibraryApi";
import { playRefs } from "@/lib/listen/playlistSession";

// My Saved Scriptures — every passage I saved, with my own title, tags and
// memorisation status (all private to me). Search, filter, sort; select
// several to add to playlists / collections, favourite, listen, or remove.
// Removing a saved passage never touches the playlists or collections it is
// in — they keep their own reference — and it always asks first.

type Sort = "added" | "updated" | "reference";
const asRef = (x: SavedScripture) => ({ translationCode: x.translationCode, bookCode: x.bookCode, chapter: x.chapter, startVerse: x.startVerse, endVerse: x.endVerse });

export default function SavedScriptures() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<SavedScripture[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [memo, setMemo] = useState<Memorisation | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("added");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; title: string; tags: string; memo: Memorisation | null } | null>(null);
  const [saving, setSaving] = useState<SaveTarget[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listSaved({ q: q || undefined, tag: tag ?? undefined, memorisation: memo ?? undefined, favourites: favOnly, sort });
      setItems(r.items); setTags(r.tags); setLimited(false); setError(null);
    } catch (e: any) {
      if (e?.status !== 503) { setError(e?.message ?? "Couldn't load your saved Scriptures."); setItems((cur) => cur ?? []); return; }
      // Before the Library is switched on: the saved passages themselves, without the new details.
      try {
        const r = await getLibrary("saved", 0);
        setItems((r.items as Bookmark[]).map((b) => ({ ...b, title: null, tags: [], memorisation: null, favourite: false, savedAt: "", updatedAt: "" })));
        setLimited(true); setError(null);
      } catch (e2: any) { setError(e2?.message ?? "Couldn't load your saved Scriptures."); setItems([]); }
    }
  }, [q, tag, memo, favOnly, sort]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = (id: string) => setChosen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selected = (items ?? []).filter((x) => chosen.has(x.id));
  const confirm = (title: string, message: string, onYes: () => void) => {
    if (Platform.OS === "web") { if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes(); return; }
    Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: title, style: "destructive", onPress: onYes }]);
  };
  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key); setNotice(null);
    try { await fn(); if (done) setNotice(done); } catch (e: any) { setNotice(e?.message ?? "That didn't work."); } finally { setBusy(null); await load(); }
  }

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: "Saved Scriptures" }} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 130 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <View style={s.search}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput style={s.input} value={q} onChangeText={setQ} onSubmitEditing={load} placeholder="Search by reference, title or tag" placeholderTextColor={c.textMuted} accessibilityLabel="Search saved Scriptures" returnKeyType="search" />
        </View>
        {!limited ? (
          <>
            <ChipRow accessibilityLabel="Filter" single>
              <FilterChip label="Favourites" icon="heart" selected={favOnly} onPress={() => setFavOnly(!favOnly)} />
              {(Object.keys(MEMORISATION_LABEL) as Memorisation[]).map((m) => <FilterChip key={m} label={MEMORISATION_LABEL[m]} selected={memo === m} selection="single" onPress={() => setMemo(memo === m ? null : m)} />)}
              {tags.map((t) => <FilterChip key={t} label={`#${t}`} selected={tag === t} selection="single" onPress={() => setTag(tag === t ? null : t)} />)}
            </ChipRow>
            <SegmentedControl accessibilityLabel="Sort" value={sort} onChange={(v) => setSort(v as Sort)} options={[{ value: "added", label: "Recently added" }, { value: "updated", label: "Updated" }, { value: "reference", label: "Reference" }]} />
          </>
        ) : <Text style={s.hint}>Titles, tags, memorisation and favourites are coming soon. Your saved passages are all here.</Text>}
        {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        {!items ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 24 }} accessibilityLabel="Loading" /> : null}
        {items && !items.length && !error ? (
          <View style={s.empty}>
            <Ionicons name="bookmark-outline" size={28} color={c.accentGreen} />
            <Text style={s.emptyTitle}>{q || tag || memo || favOnly ? "Nothing matches" : "Save a passage from the Bible reader"}</Text>
            <Text style={s.emptyText}>Select verses in the Bible and tap Save — or find Scripture here.</Text>
            <AppButton label="Find Scripture" icon="search-outline" variant="secondary" onPress={() => router.push("/library/add" as any)} />
          </View>
        ) : null}

        {items?.map((x) => {
          const on = chosen.has(x.id);
          return (
            <View key={x.id} style={[s.card, on && { borderColor: c.accentGreen }]}>
              <Pressable style={{ flexDirection: "row", gap: 10 }} onPress={() => toggle(x.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                accessibilityLabel={`${x.title ? `${x.title}, ` : ""}${x.reference}${x.favourite ? ", favourite" : ""}${x.memorisation ? `, ${MEMORISATION_LABEL[x.memorisation]}` : ""}`}>
                <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? c.accentGreen : c.textMuted} />
                <View style={{ flex: 1, gap: 2 }}>
                  {x.title ? <Text style={s.title} numberOfLines={2}>{x.title}</Text> : null}
                  <Text style={x.title ? s.sub : s.title}>{x.reference} <Text style={s.trans}>{x.translationCode}</Text>{x.favourite ? "  ♥" : ""}</Text>
                  {x.memorisation || x.tags.length ? (
                    <Text style={s.sub} numberOfLines={1}>{x.memorisation ? MEMORISATION_LABEL[x.memorisation] : ""}{x.memorisation && x.tags.length ? " · " : ""}{x.tags.map((t) => `#${t}`).join(" ")}</Text>
                  ) : null}
                </View>
              </Pressable>
              {editing?.id === x.id ? (
                <View style={{ gap: 8 }}>
                  <TextInput style={s.field} value={editing.title} onChangeText={(v) => setEditing({ ...editing, title: v })} placeholder="Your title (optional)" placeholderTextColor={c.textMuted} maxLength={120} accessibilityLabel="Your title" />
                  <TextInput style={s.field} value={editing.tags} onChangeText={(v) => setEditing({ ...editing, tags: v })} placeholder="Tags, separated by commas" placeholderTextColor={c.textMuted} accessibilityLabel="Tags, separated by commas" />
                  <SegmentedControl accessibilityLabel="Memorisation" value={editing.memo ?? "none"} onChange={(v) => setEditing({ ...editing, memo: v === "none" ? null : (v as Memorisation) })}
                    options={[{ value: "none", label: "—" }, ...(Object.keys(MEMORISATION_LABEL) as Memorisation[]).map((m) => ({ value: m, label: MEMORISATION_LABEL[m] }))]} />
                  <View style={s.row}>
                    <AppButton label="Save" size="sm" loading={busy === `edit:${x.id}`} onPress={() => { const e = editing; setEditing(null); act(`edit:${x.id}`, () => updateSaved(x.id, { title: e.title.trim() || null, tags: e.tags.split(",").map((t) => t.trim()).filter(Boolean), memorisation: e.memo })); }} />
                    <AppButton label="Cancel" size="sm" variant="tertiary" onPress={() => setEditing(null)} />
                  </View>
                </View>
              ) : (
                <View style={s.actions}>
                  <AppButton label="Read" icon="book-outline" size="sm" variant="tertiary" onPress={() => router.push(bibleRoute({ book: x.bookCode, chapter: x.chapter, v: x.startVerse, ve: x.endVerse, translation: x.translationCode }) as any)} accessibilityLabel={`Read ${x.reference}`} />
                  <AppButton label="Listen" icon="headset-outline" size="sm" variant="tertiary" onPress={() => playRefs(x.reference, [{ ref: asRef(x), reference: x.reference }], "library")} accessibilityLabel={`Listen to ${x.reference}`} />
                  <AppButton label="Add to…" icon="add" size="sm" variant="tertiary" onPress={() => setSaving([{ ref: asRef(x), reference: x.reference }])} accessibilityLabel={`Add ${x.reference} to a playlist or collection`} />
                  {!limited ? <IconButton icon="create-outline" size="sm" accessibilityLabel={`Edit details of ${x.reference}`} onPress={() => setEditing({ id: x.id, title: x.title ?? "", tags: x.tags.join(", "), memo: x.memorisation })} /> : null}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {selected.length ? (
        <View style={[s.bottom, { paddingBottom: 12 + insets.bottom }]} accessibilityLabel={`${selected.length} selected`}>
          <Text style={s.bottomText}>{selected.length} selected</Text>
          <View style={s.row}>
            <AppButton label="Add to…" icon="add" size="sm" onPress={() => setSaving(selected.map((x) => ({ ref: asRef(x), reference: x.reference })))} />
            <AppButton label="Listen" icon="headset-outline" size="sm" variant="secondary" onPress={() => playRefs(`${selected.length} saved passages`, selected.map((x) => ({ ref: asRef(x), reference: x.reference })), "library")} />
            {!limited ? <AppButton label="Favourite" icon="heart-outline" size="sm" variant="tertiary" loading={busy === "fav"}
              onPress={() => act("fav", async () => { for (const x of selected) await favouritePassage(asRef(x)); setChosen(new Set()); }, "Added to Favourites.")} /> : null}
            <AppButton label="Remove" icon="trash-outline" size="sm" variant="destructive" loading={busy === "rm"}
              onPress={() => confirm("Remove", `Remove ${selected.length === 1 ? selected[0].reference : `${selected.length} passages`} from Saved Scriptures? Playlists and collections that include them aren't changed.`,
                () => act("rm", async () => { for (const x of selected) await removeBookmark(x.id); setChosen(new Set()); }, "Removed from Saved Scriptures."))} />
          </View>
        </View>
      ) : null}

      <SaveScriptureSheet visible={!!saving} targets={saving ?? []} onClose={() => setSaving(null)} onDone={(m) => { setSaving(null); setChosen(new Set()); setNotice(m); load(); }} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 10 },
    search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.card },
    input: { flex: 1, minHeight: 44, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 15 },
    hint: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    notice: { fontSize: 13, lineHeight: 18, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    error: { fontSize: 13, color: "#C0392B", fontFamily: "Inter_500Medium" },
    empty: { alignItems: "center", gap: 8, padding: 22, borderRadius: 18, backgroundColor: c.card, marginTop: 6 },
    emptyTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    emptyText: { fontSize: 13.5, lineHeight: 19, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    card: { padding: 12, borderRadius: 16, backgroundColor: c.card, gap: 6, borderWidth: 1.5, borderColor: "transparent" },
    title: { fontSize: 15, lineHeight: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    sub: { fontSize: 13, lineHeight: 18, color: c.textMid, fontFamily: "Inter_500Medium" },
    trans: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 2, marginLeft: 24 },
    field: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.lightCream, fontFamily: "Inter_400Regular", fontSize: 15 },
    row: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
    bottom: { position: "absolute", left: 0, right: 0, bottom: 0, gap: 8, paddingHorizontal: 16, paddingTop: 12, backgroundColor: c.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    bottomText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
