import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, useWindowDimensions } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { ActiveFilters, AppButton, Chip, ChipRow, EmptyNote, FilterSheet, IconButton, SectionHeader, SegmentedControl, type FilterGroup, type FilterValue } from "@/components/ui";
import CoverArt from "@/components/library/CoverArt";
import { createCollection, listCollections, PERMISSION_LABEL, type CollectionCard, type CollectionKind } from "@/lib/scriptureCollectionsApi";
import { listFavourites, listHistory, listSaved, recentlyPlayed, type Favourites, type HistoryItem } from "@/lib/scriptureLibraryApi";
import { filterCards, sortCards, type LibraryFilter, type LibrarySort } from "@/lib/libraryRules";
import { playSavedCollection, resumePlaylist } from "@/lib/listen/playlistSession";
import { secondsForVerses, summaryLine } from "@/lib/listen/timing";

// My Scripture Library — playlists, collections, saved Scriptures and favourites in one place.
// UI refinement (owner brief 2026-11-19, "show what matters now, reveal more when needed"):
//   • top: search + create, then compact actions (Find Scripture, Memorise, Reminders, Saved) — none dominates;
//   • the main section is YOUR LIBRARY: All · Playlists · Collections · Favourites, and ONE Filters control
//     (visibility, sorting, ownership) whose choices show as small removable chips, with Reset;
//   • Shared with me appears only when something is shared (a few, then See all), otherwise one quiet line;
//   • Listening history: the last few, compact (reference · translation · status · time), See all for the rest.
// Everything is private to me unless I share it. Starting to listen is always my own tap.

type RecentItem = Awaited<ReturnType<typeof recentlyPlayed>>["items"][number];
interface Data {
  mine: CollectionCard[]; shared: CollectionCard[];
  recent: RecentItem[]; favourites: Favourites | null; history: HistoryItem[]; savedTotal: number | null; memorised: number | null;
  /** Migration 227 not live yet: favourites / history / resume aren't available. */
  libraryOff: boolean;
}
type Tab = "all" | "playlists" | "collections" | "favourites";
const TABS: { value: Tab; label: string }[] = [{ value: "all", label: "All" }, { value: "playlists", label: "Playlists" }, { value: "collections", label: "Collections" }, { value: "favourites", label: "Favourites" }];
const FILTER_GROUPS: FilterGroup[] = [
  { key: "visibility", title: "Visibility", options: [{ value: "any", label: "Any" }, { value: "private", label: "Private" }, { value: "shared", label: "Shared" }] },
  { key: "sort", title: "Sorting", options: [{ value: "updated", label: "Recently updated" }, { value: "played", label: "Recently played" }, { value: "alpha", label: "A–Z" }] },
  { key: "owner", title: "Ownership", multi: true, options: [{ value: "mine", label: "Created by me" }] },
];
const FILTER_DEFAULTS: FilterValue = { visibility: ["any"], sort: ["updated"], owner: [] };
const HISTORY_PREVIEW = 4;
const SHARED_PREVIEW = 3;

/** When something happened, compactly: "08:12" today, "Yesterday", or "12 Nov". */
function when(iso: string): string {
  const d = new Date(iso), now = new Date();
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (day(d) === day(y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
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
  const [tab, setTab] = useState<Tab>("all");
  const [filters, setFilters] = useState<FilterValue>(FILTER_DEFAULTS);
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [naming, setNaming] = useState<CollectionKind | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [allShared, setAllShared] = useState(false);

  const load = useCallback(async () => {
    // Only a short preview of the listening history is loaded here; the full history has its own screen.
    const [cols0, rec, fav, hist, saved, memo] = await Promise.allSettled([listCollections(), recentlyPlayed(), listFavourites(), listHistory(HISTORY_PREVIEW), listSaved({}), listSaved({ memorisation: "memorised" })]);
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
  // The tab, then each chosen filter (they combine), then the sort.
  const visibility = (filters.visibility?.[0] ?? "any") as "any" | LibraryFilter;
  let shown = filterCards(all, tab as LibraryFilter, favIds, query);
  if (visibility !== "any") shown = filterCards(shown, visibility as LibraryFilter, favIds);
  if (filters.owner?.includes("mine")) shown = shown.filter((x) => !x.ownerName);
  shown = sortCards(shown, (filters.sort?.[0] ?? "updated") as LibrarySort, playedAt);
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
  const favCount = data?.favourites ? data.favourites.passages.length + data.favourites.playlists.length + data.favourites.collections.length : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: "My Scripture Library" }} />

      {/* Search + create */}
      <View style={s.searchRow}>
        <View style={s.search}>
          <Ionicons name="search" size={18} color={c.textMuted} />
          <TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Search your library" placeholderTextColor={c.textMuted}
            accessibilityLabel="Search your playlists and collections" returnKeyType="search" />
          {query ? <IconButton icon="close-circle" size="sm" accessibilityLabel="Clear search" onPress={() => setQuery("")} color={c.textMuted} /> : null}
        </View>
        <IconButton icon="add" variant="tinted" accessibilityLabel="Create a playlist or collection" onPress={() => setNaming(naming ? null : "playlist")} />
      </View>

      {/* Compact actions — easy to reach, none dominating the screen. */}
      <ChipRow accessibilityLabel="Library actions">
        <Chip label="Find Scripture" icon="search-outline" onPress={() => router.push("/library/add" as any)} />
        {!data?.libraryOff ? <Chip label={data?.memorised ? `Memorise · ${data.memorised}` : "Memorise"} icon="school-outline" onPress={() => router.push("/library/memorise" as any)} /> : null}
        {!data?.libraryOff ? <Chip label="Reminders" icon="alarm-outline" onPress={() => router.push("/library/reminders" as any)} /> : null}
        <Chip label={data?.savedTotal != null ? `Saved · ${data.savedTotal}` : "Saved"} icon="bookmark-outline" onPress={() => router.push("/library/saved" as any)} />
      </ChipRow>

      {naming ? (
        <View style={s.panel}>
          <SegmentedControl accessibilityLabel="Create" value={naming} onChange={(v) => setNaming(v as CollectionKind)}
            options={[{ value: "playlist", label: "Playlist" }, { value: "collection", label: "Collection" }]} />
          <Text style={s.help}>{naming === "playlist" ? "Plays passage after passage, in your order." : "Keeps passages together, like a folder."}</Text>
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
          {data.libraryOff ? <Text style={s.help}>Favourites, listening history and Continue listening are coming soon.</Text> : null}

          {/* Continue listening */}
          {continueItem ? (
            <Pressable style={s.continue} onPress={() => resume(continueItem.id)} accessibilityRole="button" accessibilityLabel={`Continue listening to ${continueItem.title}`}>
              <CoverArt cover={continueItem.cover} kind={continueItem.kind} size={56} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.eyebrow}>Continue listening</Text>
                <Text style={s.cardTitle} numberOfLines={1}>{continueItem.title}</Text>
                {continueItem.state.shuffle || continueItem.state.repeat !== "off" ? <Text style={s.meta}>{continueItem.state.shuffle ? "Shuffle" : ""}{continueItem.state.shuffle && continueItem.state.repeat !== "off" ? " · " : ""}{continueItem.state.repeat !== "off" ? "Repeat" : ""}</Text> : null}
              </View>
              {busy === `resume:${continueItem.id}` ? <ActivityIndicator color={c.accentGreen} /> : <Ionicons name="play-circle" size={40} color={c.accentGreen} />}
            </Pressable>
          ) : null}

          {/* Recently played (only when there's more than the one above) */}
          {data.recent.length > 1 ? (
            <>
              <SectionHeader title="Recently played" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
                {data.recent.slice(1, 12).map((r) => (
                  <Pressable key={r.id} style={{ width: 104, gap: 6 }} onPress={() => open(r.id)} accessibilityRole="button" accessibilityLabel={`${r.title}, recently played`}>
                    <CoverArt cover={r.cover} kind={r.kind} size={104} />
                    <Text style={s.smallTitle} numberOfLines={2}>{r.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          {/* YOUR LIBRARY — the main section */}
          <View style={s.libraryHead}>
            <Text style={s.section} accessibilityRole="header">Your library</Text>
            <IconButton icon={layout === "grid" ? "list" : "grid"} size="sm" accessibilityLabel={layout === "grid" ? "Show as a list" : "Show as a grid"} onPress={() => setLayout(layout === "grid" ? "list" : "grid")} />
          </View>
          <SegmentedControl accessibilityLabel="Show" value={tab} onChange={(v) => setTab(v as Tab)} options={TABS.map((x) => ({ value: x.value, label: x.label }))} />
          <View style={s.filterRow}>
            <FilterSheet groups={FILTER_GROUPS} value={filters} defaults={FILTER_DEFAULTS} onChange={setFilters} />
            <View style={{ flex: 1 }}><ActiveFilters groups={FILTER_GROUPS} value={filters} defaults={FILTER_DEFAULTS} onChange={setFilters} /></View>
          </View>
          {tab === "favourites" && data.favourites?.passages.length ? (
            <Pressable style={s.linkRow} onPress={() => router.push("/library/favourites" as any)} accessibilityRole="button" accessibilityLabel={`Favourite passages, ${data.favourites.passages.length}`}>
              <Ionicons name="heart" size={16} color={c.accentGreen} />
              <Text style={s.linkText}>Favourite passages · {data.favourites.passages.length}</Text>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </Pressable>
          ) : null}

          {!all.length ? (
            <EmptyNote icon="musical-notes-outline" text="No playlists yet. Gather the passages you love and listen in your own order." actionLabel="New playlist" onAction={() => setNaming("playlist")} />
          ) : !shown.length ? (
            <EmptyNote text={query ? `Nothing matches “${query}”.` : tab === "favourites" && !favCount ? "No favourites yet — tap ♥ on a playlist to add it." : "Nothing matches these filters."}
              actionLabel={JSON.stringify(filters) !== JSON.stringify(FILTER_DEFAULTS) ? "Reset filters" : undefined} onAction={() => setFilters(FILTER_DEFAULTS)} />
          ) : layout === "grid" ? (
            <View style={s.grid}>
              {shown.map((x) => (
                <View key={x.id} style={{ width: tileW, padding: 6 }}>
                  {/* The card and its Play button are siblings (a button inside a button isn't allowed on the web). */}
                  <Pressable onPress={() => open(x.id)} style={({ pressed }) => [{ gap: 4 }, pressed && { opacity: 0.85 }]} accessibilityRole="button"
                    accessibilityLabel={`${x.title}. ${x.kind === "playlist" ? "Playlist" : "Collection"}, ${x.itemCount} passages. ${badge(x)}${favIds.has(x.id) ? ". Favourite" : ""}`}>
                    <View>
                      <CoverArt cover={x.cover} kind={x.kind} size={coverSize} />
                      {favIds.has(x.id) ? <View style={s.favDot}><Ionicons name="heart" size={12} color="#fff" /></View> : null}
                    </View>
                    <Text style={s.smallTitle} numberOfLines={2}>{x.title}</Text>
                    <Text style={s.meta} numberOfLines={1}>{summaryLine(x.itemCount, ["scripture", "scriptures"], secondsForVerses(x.verseCount ?? 0))}{x.ownerName ? " · Shared" : ""}</Text>
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
                  <CoverArt cover={x.cover} kind={x.kind} size={48} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{x.title}{favIds.has(x.id) ? "  ♥" : ""}</Text>
                    <Text style={s.meta} numberOfLines={1}>{x.kind === "playlist" ? "Playlist" : "Collection"} · {summaryLine(x.itemCount, ["scripture", "scriptures"], secondsForVerses(x.verseCount ?? 0))} · {badge(x)}</Text>
                  </View>
                </Pressable>
                {x.itemCount ? <IconButton icon="play-circle-outline" accessibilityLabel={`Play ${x.title}`} onPress={() => play(x.id)} loading={busy === `play:${x.id}`} /> : null}
              </View>
            ))
          )}

          {/* Shared with me — a compact section only when something is shared */}
          {data.shared.length ? (
            <>
              <SectionHeader title="Shared with me" count={data.shared.length} actionLabel={allShared ? "Show less" : "See all"} onAction={data.shared.length > SHARED_PREVIEW ? () => setAllShared((x) => !x) : undefined} />
              {(allShared ? data.shared : data.shared.slice(0, SHARED_PREVIEW)).map((x) => (
                <Pressable key={x.id} style={s.compactRow} onPress={() => open(x.id)} accessibilityRole="button" accessibilityLabel={`${x.title}, shared by ${x.sharedByName ?? x.ownerName}`}>
                  <CoverArt cover={x.cover} kind={x.kind} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{x.title}</Text>
                    <Text style={s.meta} numberOfLines={1}>{x.sharedByName ?? x.ownerName}{x.permission ? ` · ${PERMISSION_LABEL[x.permission]}` : ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
                </Pressable>
              ))}
            </>
          ) : (
            <>
              <SectionHeader title="Shared with me" />
              <EmptyNote icon="people-outline" text="Nothing shared with you yet." />
            </>
          )}

          {/* Listening history — the last few, compact; See all for the full history */}
          {!data.libraryOff ? (
            <>
              <SectionHeader title="Listening history" onAction={data.history.length ? () => router.push("/library/history" as any) : undefined} />
              {!data.history.length ? (
                <EmptyNote icon="headset-outline" text="What you listen to appears here — only you can see it." />
              ) : data.history.slice(0, HISTORY_PREVIEW).map((h) => (
                <View key={h.id} style={s.histRow} accessible accessibilityLabel={`${h.reference}, ${h.translationCode}, ${h.completedAt ? "listened" : "partly listened"}, ${when(h.startedAt)}`}>
                  <Ionicons name={h.completedAt ? "checkmark-circle" : "ellipse-outline"} size={16} color={h.completedAt ? c.accentGreen : c.textMuted} />
                  <Text style={s.histRef} numberOfLines={1}>{h.reference} <Text style={s.meta}>· {h.translationCode}</Text></Text>
                  <Text style={s.meta}>{when(h.startedAt)}</Text>
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

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, paddingBottom: 120, gap: 8 },
    searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.card },
    searchInput: { flex: 1, minHeight: 44, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 15 },
    panel: { padding: 14, borderRadius: 16, backgroundColor: c.card, gap: 10 },
    help: { fontSize: 13, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.lightCream, fontFamily: "Inter_400Regular", fontSize: 15 },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    error: { color: "#C0392B", fontFamily: "Inter_500Medium", fontSize: 13 },
    continue: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 16, backgroundColor: c.card, marginTop: 6, borderWidth: 1, borderColor: `${c.accentGreen}55` },
    eyebrow: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.8, textTransform: "uppercase" },
    libraryHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
    section: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    filterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    linkRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.card },
    linkText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
    smallTitle: { fontSize: 14, lineHeight: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardTitle: { fontSize: 15, lineHeight: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    favDot: { position: "absolute", top: 8, left: 8, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
    playFab: { position: "absolute", width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: c.accentGreen },
    listRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige, minHeight: 60 },
    compactRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige, minHeight: 52 },
    histRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    histRef: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
