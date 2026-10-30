import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  BibleApiError, bibleRoute, deleteNote, getLibrary, highlightPalette, removeBookmark, removeHighlight,
  type BibleNote, type Bookmark, type Highlight,
} from "@/lib/bibleReaderApi";
import { AppButton, IconButton } from "@/components/ui";

// The reader's own Bible library: notes, highlights and saved passages.
// Private to the signed-in person (owner-only RLS); never shown to leaders.
type Kind = "notes" | "highlights" | "saved";
type Item = Highlight | BibleNote | Bookmark;
const TABS: { kind: Kind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: "notes", label: "Notes", icon: "create-outline" },
  { kind: "highlights", label: "Highlights", icon: "color-fill-outline" },
  { kind: "saved", label: "Saved", icon: "bookmark-outline" },
];

export default function BibleLibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c, resolvedMode } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const palette = useMemo(() => highlightPalette(resolvedMode), [resolvedMode]);
  const [kind, setKind] = useState<Kind>("notes");
  const [items, setItems] = useState<Item[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (k: Kind, offset: number, mode: "replace" | "append" | "refresh" = "replace") => {
    const id = ++reqId.current;
    if (mode === "refresh") setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const r = await getLibrary(k, offset);
      if (id !== reqId.current) return;
      setAvailable(r.available);
      setHasMore(r.hasMore);
      setItems((prev) => (mode === "append" ? [...prev, ...r.items] : r.items));
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof BibleApiError ? e.message : "Couldn't load your library.");
    } finally {
      if (id === reqId.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => { setItems([]); setConfirmId(null); load(kind, 0); }, [kind, load]);
  // Coming back from the reader may have added or changed items.
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    load(kind, 0, "refresh");
  }, [kind, load]));

  async function remove(item: Item) {
    try {
      if (kind === "notes") await deleteNote(item.id);
      else if (kind === "highlights") await removeHighlight(item.id);
      else await removeBookmark(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setConfirmId(null);
    } catch (e) {
      setError(e instanceof BibleApiError ? e.message : "Couldn't remove it. Please try again.");
    }
  }

  const open = (i: Item) => router.push(bibleRoute({ book: i.bookCode, chapter: i.chapter, v: i.startVerse, ve: i.endVerse, translation: i.translationCode }) as any);

  const renderItem = ({ item }: { item: Item }) => {
    const note = kind === "notes" ? (item as BibleNote) : null;
    const hl = kind === "highlights" ? (item as Highlight) : null;
    const confirming = confirmId === item.id;
    return (
      <View style={styles.row}>
        <TouchableOpacity style={{ flex: 1, gap: 3 }} onPress={() => open(item)} accessibilityRole="button" accessibilityLabel={`Open ${item.reference}`}>
          <View style={styles.refLine}>
            {hl && <View style={[styles.dot, { backgroundColor: palette[hl.color]?.swatch ?? c.amber }]} />}
            <Text style={styles.ref}>{item.reference}</Text>
          </View>
          {note?.title ? <Text style={styles.noteTitle} numberOfLines={1}>{note.title}</Text> : null}
          {note ? <Text style={styles.noteBody} numberOfLines={3}>{note.body}</Text> : null}
        </TouchableOpacity>
        {confirming ? (
          <AppButton label="Remove" onPress={() => remove(item)} variant="destructive" size="sm" accessibilityLabel={`Confirm remove ${item.reference}`} />
        ) : (
          <IconButton icon="trash-outline" accessibilityLabel={`Remove ${item.reference}`} onPress={() => setConfirmId(item.id)} color={c.textMuted} />
        )}
      </View>
    );
  };

  const emptyText = kind === "notes" ? "Tap a verse in the Bible, then Note, to write your first note."
    : kind === "highlights" ? "Tap a verse in the Bible and choose a colour to highlight it."
    : "Tap a verse in the Bible, then Save, to keep a passage here.";

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={styles.title} accessibilityRole="header">My Bible library</Text>
      </View>
      <View style={styles.privacy}>
        <Ionicons name="lock-closed" size={12} color={c.textMuted} />
        <Text style={styles.privacyText}>Only you can see your notes, highlights and saved passages.</Text>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((tb) => (
          <TouchableOpacity key={tb.kind} style={[styles.tab, kind === tb.kind && styles.tabOn]} onPress={() => setKind(tb.kind)}
            accessibilityRole="tab" accessibilityState={{ selected: kind === tb.kind }}>
            <Ionicons name={tb.icon} size={15} color={kind === tb.kind ? "#fff" : c.textMid} />
            <Text style={[styles.tabText, kind === tb.kind && styles.tabTextOn]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {!available ? (
        <View style={styles.center}><Text style={styles.muted}>Notes, highlights and saved passages are coming soon.</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(kind, 0, "refresh")} tintColor={c.accentGreen} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={loading ? <View style={styles.center}><ActivityIndicator color={c.accentGreen} /></View>
            : error ? null : <View style={styles.center}><Text style={styles.muted}>{emptyText}</Text></View>}
          ListFooterComponent={hasMore ? (
            <AppButton label="Load more" onPress={() => load(kind, items.length, "append")} variant="tertiary" size="lg" disabled={loading} loading={loading} accessibilityLabel="Load more" />
          ) : null}
        />
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6 },
    title: { flex: 1, fontSize: 19, color: c.textDark, fontFamily: "Inter_700Bold" },
    privacy: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingTop: 2 },
    privacyText: { flex: 1, fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
    tab: { flex: 1, flexDirection: "row", gap: 6, minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center", backgroundColor: c.card },
    tabOn: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    tabText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    tabTextOn: { color: "#fff" },
    error: { color: "#DC2626", fontSize: 13, fontFamily: "Inter_500Medium", paddingHorizontal: 18, paddingBottom: 6 },
    center: { padding: 32, alignItems: "center" },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
    row: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 18, paddingRight: 8, paddingVertical: 12, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    refLine: { flexDirection: "row", alignItems: "center", gap: 8 },
    dot: { width: 12, height: 12, borderRadius: 6 },
    ref: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    noteTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    noteBody: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    confirm: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: "rgba(220,38,38,0.12)", justifyContent: "center" },
    confirmText: { color: "#DC2626", fontSize: 13, fontFamily: "Inter_700Bold" },
    more: { minHeight: 52, alignItems: "center", justifyContent: "center" },
    moreText: { color: c.accentGreen, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  });
}
