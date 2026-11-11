import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, useWindowDimensions } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton, SegmentedControl } from "@/components/ui";
import CoverArt from "@/components/library/CoverArt";
import { createCollection, listCollections, PERMISSION_LABEL, type CollectionCard, type CollectionKind } from "@/lib/scriptureCollectionsApi";
import { listFavourites, listHistory, listSaved, recentlyPlayed, type Favourites, type HistoryItem } from "@/lib/scriptureLibraryApi";
import { filterCards, sortCards, LIBRARY_FILTERS, LIBRARY_SORTS, type LibraryFilter, type LibrarySort } from "@/lib/libraryRules";
import { playSavedCollection, resumePlaylist } from "@/lib/listen/playlistSession";
import { secondsForVerses, summaryLine } from "@/lib/listen/timing";

// My Scripture Library — playlists, collections, saved Scriptures and
// favourites in one place, with Continue listening, Recently played, what's
// been shared with me and my listening history. Everything here is private
// to me unless I share a playlist or collection. Starting to listen is always
// my own tap — nothing plays by itself when this opens.

type RecentItem = Awaited<ReturnType<typeof recentlyPlayed>>["items"][number];
interface Data {
  mine: CollectionCard[]; shared: CollectionCard[];
  recent: RecentItem[]; favourites: Favourites | null; history: HistoryItem[]; savedTotal: number | null; memorised: number | null;
  /** Migration 227 not live yet: favourites / history / resume aren't available. */
  libraryOff: boolean;
}

export default function LibraryHome() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { width } = useWindowDimensions();
  const cols = width >= 1000 ? 5 : width >= 760 ? 4 : width >= 520 ? 3 : 2;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("updated");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [naming, setNaming] = useState<CollectionKind | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cols0, rec, fav, hist, saved, memo] = await Promise.allSettled([listCollections(), recentlyPlayed(), listFavourites(), listHistory(100), listSaved({}), listSaved({ memorisation: "memorised" })]);
    if (cols0.status === "rejected") { setError(cols0.reason?.message ?? "Couldn't load your library."); return; }
    setError(null);
    setData({
      mine: cols0.value.mine, shared: cols0.value.shared,
      recent: rec.status === "fulfilled" ? rec.value.items : [],
      favourites: fav.status === "fulfilled" ? fav.value : null,
      history: hist.status === "fulfilled" ? hist.value.items : [],
      savedTotal: saved.status === "fulfilled" ? saved.value.total : null,
      memorised: memo.status === "fulfilled" ? memo.value.total : null,
      libraryOff: [rec, fav, hist].every((r) => r.status === "rejected"),
    });
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const favIds = useMemo(() => new Set([...(data?.favourites?.playlists ?? []), ...(data?.favourites?.collections ?? [])].map((f) => f.collectionId)), [data]);
  const playedAt = useMemo(() => new Map((data?.recent ?? []).map((r) => [r.id, r.state.updatedAt ?? ""])), [data]);
  const all = data ? [...data.mine, ...data.shared] : [];
  const shown = sortCards(filterCards(all, filter, favIds, query), sort, playedAt);
  const open = (id: string) => router.push({ pathname: "/scripture-collections/[id]", params: { id } } as any);

  async function create() {
    if (!naming || !name.trim()) return;
    setBusy("create");
    try { const { id } = await createCollection(naming, name.trim()); setNaming(null); setName(""); open(id); }
    catch (e: any) { setError(e?.message ?? "Couldn't create it."); }
    finally { setBusy(null); }
  }
  async function play(id: string) {
    setBusy(`play:${id}`);
    try { await playSavedCollection(id); } catch (e: any) { setError(e?.message ?? "Couldn't start listening."); } finally { setBusy(null); }
  }
  async function resume(id: string) {
    setBusy(`resume:${id}`);
    try { await resumePlaylist(id); } catch (e: any) { setError(e?.message ?? "Couldn't continue listening."); } finally { setBusy(null); }
  }

  const tileW = `${100 / cols}%` as const;
  // The page is at most 1100 wide (minus padding); each tile has 6 px padding on both sides.
  const coverSize = Math.floor(Math.min(220, (Math.min(width, 1100) - 32 + 12) / cols - 12));
  const continueItem = data?.recent[0];
  const counts = { playlists: data?.mine.filter((x) => x.kind === "playlist").length ?? 0, collections: data?.mine.filter((x) => x.kind === "collection").length ?? 0 };
  const favCount = data?.favourites ? data.favourites.passages.length + data.favourites.playlists.length + data.favourites.collections.length : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: "My Scripture Library" }} />

      {/* Header: search + add */}
      <View style={s.searchRow}>
        <View style={s.search}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Search your library" placeholderTextColor={c.textMuted}
            accessibilityLabel="Search your playlists and collections" returnKeyType="search" />
          {query ? <IconButton icon="close-circle" size="sm" accessibilityLabel="Clear search" onPress={() => setQuery("")} color={c.textMuted} /> : null}
        </View>
        <IconButton icon="add" variant="tinted" accessibilityLabel="Create a playlist or collection" onPress={() => setNaming(naming ? null : "playlist")} />
      </View>
      <AppButton label="Find Scripture to add" icon="search-outline" variant="secondary" fullWidth onPress={() => router.push("/library/add" as any)} style={{ marginBottom: 14 }} />

      {naming ? (
        <View style={s.panel}>
          <SegmentedControl accessibilityLabel="Create" value={naming} onChange={(v) => setNaming(v as CollectionKind)}
            options={[{ value: "playlist", label: "Playlist" }, { value: "collection", label: "Collection" }]} />
          <Text style={s.help}>{naming === "playlist" ? "A playlist plays passage after passage, in your order." : "A collection keeps passages together, like a folder. Make a playlist from it any time."}</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder={naming === "playlist" ? "e.g. Morning with God" : "e.g. Promises of God"} placeholderTextColor={c.textMuted}
            maxLength={120} autoFocus onSubmitEditing={create} accessibilityLabel={`Name of the new ${naming}`} />
          <View style={s.row}>
            <AppButton label="Create" size="sm" onPress={create} disabled={!name.trim()} loading={busy === "create"} />
            <AppButton label="Cancel" size="sm" variant="tertiary" onPress={() => { setNaming(null); setName(""); }} />
          </View>
        </View>
      ) : null}

      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {!data && !error ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 24 }} accessibilityLabel="Loading" /> : null}

      {data ? (
        <>
          {data.libraryOff ? <Text style={s.help}>Favourites, listening history and Continue listening are coming soon. Your playlists and collections are all here.</Text> : null}

          {/* Continue listening */}
          {continueItem ? (
            <Pressable style={s.continue} onPress={() => resume(continueItem.id)} accessibilityRole="button" accessibilityLabel={`Continue listening to ${continueItem.title}`}>
              <CoverArt cover={continueItem.cover} kind={continueItem.kind} size={64} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.eyebrow}>Continue listening</Text>
                <Text style={s.cardTitle} numberOfLines={2}>{continueItem.title}</Text>
                <Text style={s.meta}>{continueItem.state.shuffle ? "Shuffle · " : ""}{continueItem.state.repeat !== "off" ? "Repeat · " : ""}Pick up where you stopped</Text>
              </View>
              {busy === `resume:${continueItem.id}` ? <ActivityIndicator color={c.accentGreen} /> : <Ionicons name="play-circle" size={40} color={c.accentGreen} />}
            </Pressable>
          ) : null}

          {/* Library sections */}
          <View style={s.tiles}>
            <Tile s={s} c={c} icon="musical-notes" label="Playlists" value={counts.playlists} onPress={() => setFilter("playlists")} selected={filter === "playlists"} />
            <Tile s={s} c={c} icon="albums" label="Collections" value={counts.collections} onPress={() => setFilter("collections")} selected={filter === "collections"} />
            <Tile s={s} c={c} icon="bookmark" label="Saved Scriptures" value={data.savedTotal} onPress={() => router.push("/library/saved" as any)} />
            <Tile s={s} c={c} icon="heart" label="Favourites" value={favCount} onPress={() => router.push("/library/favourites" as any)} />
          </View>

          {/* Growing in the Word — encouragement, never a score */}
          {!data.libraryOff ? (
            <View style={s.growRow}>
              <Text style={[s.meta, { width: "100%" }]}>
                {(() => { const heard = data.history.filter((h) => h.completedAt).length; return heard || data.memorised ? `${heard ? `${heard} ${heard === 1 ? "passage" : "passages"} listened recently` : ""}${heard && data.memorised ? " · " : ""}${data.memorised ? `${data.memorised} by heart` : ""}` : "Your listening and memorisation, just for you."; })()}
              </Text>
              <AppButton label="Memorise" icon="school-outline" size="sm" variant="tertiary" onPress={() => router.push("/library/memorise" as any)} />
              <AppButton label="Reminders" icon="alarm-outline" size="sm" variant="tertiary" onPress={() => router.push("/library/reminders" as any)} />
            </View>
          ) : null}

          {/* Recently played */}
          {data.recent.length > 1 ? (
            <>
              <Text style={s.section} accessibilityRole="header">Recently played</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
                {data.recent.map((r) => (
                  <Pressable key={r.id} style={{ width: 120, gap: 6 }} onPress={() => open(r.id)} accessibilityRole="button" accessibilityLabel={`${r.title}, recently played`}>
                    <CoverArt cover={r.cover} kind={r.kind} size={120} />
                    <Text style={s.smallTitle} numberOfLines={2}>{r.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          {/* My library */}
          <View style={s.sectionRow}>
            <Text style={s.section} accessibilityRole="header">Your library</Text>
            <IconButton icon={layout === "grid" ? "list" : "grid"} size="sm" accessibilityLabel={layout === "grid" ? "Show as a list" : "Show as a grid"} onPress={() => setLayout(layout === "grid" ? "list" : "grid")} />
          </View>
          <ChipRow accessibilityLabel="Show" single>
            {LIBRARY_FILTERS.map((f) => <FilterChip key={f.value} label={f.label} selected={filter === f.value} selection="single" onPress={() => setFilter(f.value)} />)}
          </ChipRow>
          <ChipRow accessibilityLabel="Sort by" single>
            {LIBRARY_SORTS.map((o) => <FilterChip key={o.value} label={o.label} icon={sort === o.value ? "swap-vertical" : undefined} selected={sort === o.value} selection="single" onPress={() => setSort(o.value)} />)}
          </ChipRow>

          {!all.length ? (
            <Empty s={s} c={c} icon="musical-notes-outline" title="Create your first Scripture playlist"
              text="Gather the passages you love and listen to them in your own order — or organise them into collections."
              action={<AppButton label="New playlist" icon="add" onPress={() => setNaming("playlist")} />} />
          ) : !shown.length ? (
            <Text style={[s.help, { marginTop: 10 }]}>{query ? `Nothing in your library matches “${query}”.` : "Nothing here yet."}</Text>
          ) : layout === "grid" ? (
            <View style={s.grid}>
              {shown.map((x) => (
                <View key={x.id} style={{ width: tileW, padding: 6 }}>
                  {/* The card and its Play button are siblings (a button inside a button isn't allowed on the web). */}
                  <Pressable onPress={() => open(x.id)} style={({ pressed }) => [{ gap: 6 }, pressed && { opacity: 0.85 }]} accessibilityRole="button"
                    accessibilityLabel={`${x.title}. ${x.kind === "playlist" ? "Playlist" : "Collection"}, ${x.itemCount} passages. ${badge(x)}${favIds.has(x.id) ? ". Favourite" : ""}`}>
                    <View>
                      <CoverArt cover={x.cover} kind={x.kind} size={coverSize} />
                      {favIds.has(x.id) ? <View style={s.favDot}><Ionicons name="heart" size={12} color="#fff" /></View> : null}
                    </View>
                    <Text style={s.smallTitle} numberOfLines={2}>{x.title}</Text>
                    <Text style={s.meta} numberOfLines={1}>{x.kind === "playlist" ? "Playlist" : "Collection"} · {summaryLine(x.itemCount, ["scripture", "scriptures"], secondsForVerses(x.verseCount ?? 0))}</Text>
                  </Pressable>
                  {x.itemCount ? (
                    <Pressable style={[s.playFab, { top: 6 + coverSize - 48, right: 14 }]} onPress={() => play(x.id)} accessibilityRole="button" accessibilityLabel={`Play ${x.title}`} hitSlop={8}>
                      {busy === `play:${x.id}` ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="play" size={18} color="#fff" />}
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            shown.map((x) => (
              <View key={x.id} style={s.listRow}>
                <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }} onPress={() => open(x.id)} accessibilityRole="button" accessibilityLabel={`${x.title}. ${x.itemCount} passages. ${badge(x)}`}>
                  <CoverArt cover={x.cover} kind={x.kind} size={52} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{x.title}{favIds.has(x.id) ? "  ♥" : ""}</Text>
                    {x.description ? <Text style={s.meta} numberOfLines={1}>{x.description}</Text> : null}
                    <Text style={s.meta} numberOfLines={1}>{x.kind === "playlist" ? "Playlist" : "Collection"} · {summaryLine(x.itemCount, ["scripture", "scriptures"], secondsForVerses(x.verseCount ?? 0))} · {badge(x)}</Text>
                  </View>
                </Pressable>
                {x.itemCount ? <IconButton icon="play-circle-outline" accessibilityLabel={`Play ${x.title}`} onPress={() => play(x.id)} loading={busy === `play:${x.id}`} /> : null}
              </View>
            ))
          )}

          {/* Shared with me */}
          <Text style={s.section} accessibilityRole="header">Shared with me</Text>
          {!data.shared.length ? (
            <Text style={s.help}>When someone in your Family, Church, a group or a study shares a playlist or collection, it appears here.</Text>
          ) : data.shared.map((x) => (
            <Pressable key={x.id} style={s.listRow} onPress={() => open(x.id)} accessibilityRole="button" accessibilityLabel={`${x.title}, shared by ${x.sharedByName ?? x.ownerName}`}>
              <CoverArt cover={x.cover} kind={x.kind} size={48} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{x.title}</Text>
                <Text style={s.meta} numberOfLines={2}>{badge(x)} · updated {new Date(x.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
            </Pressable>
          ))}

          {/* Listening history */}
          {!data.libraryOff ? (
            <>
              <View style={s.sectionRow}>
                <Text style={s.section} accessibilityRole="header">Listening history</Text>
                {data.history.length ? <AppButton label="See all" size="sm" variant="tertiary" onPress={() => router.push("/library/history" as any)} /> : null}
              </View>
              {!data.history.length ? (
                <Empty s={s} c={c} icon="headset-outline" title="Start listening to Scripture" text="Play a playlist or a passage, and what you've listened to appears here — only you can see it." />
              ) : data.history.slice(0, 6).map((h) => (
                <View key={h.id} style={s.histRow}>
                  <Ionicons name={h.completedAt ? "checkmark-circle" : "time-outline"} size={18} color={h.completedAt ? c.accentGreen : c.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{h.reference} <Text style={s.meta}>{h.translationCode}</Text></Text>
                    <Text style={s.meta} numberOfLines={1}>{h.collection ? `${h.collection.title} · ` : ""}{new Date(h.startedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function badge(x: CollectionCard): string {
  if (x.ownerName) return `Shared by ${x.sharedByName ?? x.ownerName}${x.permission ? ` · ${PERMISSION_LABEL[x.permission]}` : ""}`;
  if (x.isCopy) return `Your copy of ${x.originOwnerName ?? "someone"}'s`;
  return x.shareCount ? `Shared with ${x.shareCount}` : "Private";
}

function Tile({ s, c, icon, label, value, onPress, selected }: { s: Styles; c: AppColors; icon: string; label: string; value: number | null; onPress: () => void; selected?: boolean }) {
  return (
    <Pressable style={[s.tile, selected && { borderColor: c.accentGreen }]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }}
      accessibilityLabel={`${label}${value != null ? `, ${value}` : ""}`}>
      <Ionicons name={icon as any} size={20} color={c.accentGreen} />
      <Text style={s.tileLabel} numberOfLines={2}>{label}</Text>
      {value != null ? <Text style={s.tileValue}>{value}</Text> : null}
    </Pressable>
  );
}
function Empty({ s, c, icon, title, text, action }: { s: Styles; c: AppColors; icon: string; title: string; text: string; action?: React.ReactNode }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon as any} size={28} color={c.accentGreen} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
      {action}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;
function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, paddingBottom: 120 },
    searchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
    search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.card },
    searchInput: { flex: 1, minHeight: 44, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 15 },
    panel: { padding: 14, borderRadius: 16, backgroundColor: c.card, gap: 10, marginBottom: 14 },
    help: { fontSize: 13, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular", marginBottom: 8 },
    input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.lightCream, fontFamily: "Inter_400Regular", fontSize: 15 },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    error: { color: "#C0392B", fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 10 },
    continue: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 18, backgroundColor: c.card, marginBottom: 14, borderWidth: 1, borderColor: `${c.accentGreen}55` },
    eyebrow: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.8, textTransform: "uppercase" },
    tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 6 },
    growRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 6 },
    tile: { flexGrow: 1, flexBasis: "45%", minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: "transparent" },
    tileLabel: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    tileValue: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_700Bold" },
    section: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 20, marginBottom: 10 },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6, marginTop: 6 },
    smallTitle: { fontSize: 14, lineHeight: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardTitle: { fontSize: 15, lineHeight: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    favDot: { position: "absolute", top: 8, left: 8, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
    playFab: { position: "absolute", width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: c.accentGreen },
    listRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 16, backgroundColor: c.card, marginBottom: 8, minHeight: 64 },
    histRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    empty: { alignItems: "center", gap: 8, padding: 22, borderRadius: 18, backgroundColor: c.card, marginTop: 6 },
    emptyTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    emptyText: { fontSize: 13.5, lineHeight: 19, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 4 },
  });
}
