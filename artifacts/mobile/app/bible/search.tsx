import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { BibleApiError, SCRIPTURE_FONT, bibleRoute, bookByCode, formatRef, searchBible, type SearchResult } from "@/lib/bibleReaderApi";

// Bible search: a reference ("John 3:16", "Ps 23") opens straight to the
// passage; anything else is a word search through API.Bible in the reader's
// current translation. Results are fetched on demand — nothing is stored.
export default function BibleSearchScreen() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [ref, setRef] = useState<{ bookCode: string; chapter: number; startVerse: number | null; endVerse: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState("");
  const reqId = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const translation = t || "KJV";

  async function run(query: string, offset: number) {
    const term = query.trim();
    if (term.length < 2) return;
    const id = ++reqId.current;
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    setLoading(true); setError(null);
    try {
      const r = await searchBible(term, translation, offset, ac.signal);
      if (id !== reqId.current) return;
      setSearched(term);
      setRef(r.kind === "reference" ? r.reference : null);
      setTotal(r.total);
      setResults((prev) => (offset ? [...prev, ...r.results] : r.results));
    } catch (e: any) {
      if (id !== reqId.current || e?.name === "AbortError") return;
      setError(e instanceof BibleApiError ? e.message : "Search didn't work. Please try again.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  // Search as the person pauses typing.
  useEffect(() => {
    if (q.trim().length < 2) { reqId.current++; ctrl.current?.abort(); setResults([]); setRef(null); setTotal(0); setSearched(""); setError(null); setLoading(false); return; }
    const h = setTimeout(() => run(q, 0), 450);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, translation]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const open = (bookCode: string, chapter: number, v?: number | null, ve?: number | null) =>
    router.push(bibleRoute({ book: bookCode, chapter, v: v ?? undefined, ve: ve ?? undefined, translation }) as any);

  const refBook = bookByCode(ref?.bookCode);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={c.textDark} />
        </TouchableOpacity>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={c.textMuted} />
          <TextInput style={styles.input} value={q} onChangeText={setQ} placeholder="Search words or a reference" placeholderTextColor={c.textMuted}
            autoFocus autoCorrect={false} returnKeyType="search" onSubmitEditing={() => run(q, 0)} accessibilityLabel="Search the Bible" maxLength={120} />
          {q ? (
            <TouchableOpacity onPress={() => setQ("")} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={c.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <Text style={styles.scope}>Searching {translation}</Text>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{error}</Text>
          <TouchableOpacity onPress={() => run(q, 0)} style={styles.retry} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
        </View>
      ) : ref && refBook ? (
        <TouchableOpacity style={styles.refCard} onPress={() => open(ref.bookCode, ref.chapter, ref.startVerse, ref.endVerse)} accessibilityRole="button"
          accessibilityLabel={`Open ${formatRef(refBook, ref.chapter, ref.startVerse, ref.endVerse)}`}>
          <Ionicons name="book-outline" size={20} color={c.accentGreen} />
          <Text style={styles.refText}>{formatRef(refBook, ref.chapter, ref.startVerse, ref.endVerse)}</Text>
          <Text style={styles.refGo}>Open</Text>
        </TouchableOpacity>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r, i) => `${r.bookCode}.${r.chapter}.${r.verse}.${i}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={searched && results.length ? <Text style={styles.count}>{total} result{total === 1 ? "" : "s"} for “{searched}”</Text> : null}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => open(item.bookCode, item.chapter, item.verse, item.verse)} accessibilityRole="button"
              accessibilityLabel={`${item.reference}. ${item.text}`}>
              <Text style={styles.rowRef}>{item.reference}</Text>
              <Text style={styles.rowText} numberOfLines={3}>{item.text}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            loading ? <View style={styles.center}><ActivityIndicator color={c.accentGreen} /></View>
              : searched ? <View style={styles.center}><Text style={styles.muted}>Nothing found for “{searched}” in {translation}.</Text></View>
              : <View style={styles.center}><Text style={styles.muted}>Try “love one another”, “shepherd”, or a reference like “Romans 8:28”.</Text></View>
          }
          ListFooterComponent={results.length > 0 && results.length < total ? (
            <TouchableOpacity style={styles.more} onPress={() => run(searched, results.length)} disabled={loading} accessibilityRole="button" accessibilityLabel="Load more results">
              {loading ? <ActivityIndicator color={c.accentGreen} /> : <Text style={styles.moreText}>Load more</Text>}
            </TouchableOpacity>
          ) : null}
        />
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingRight: 14, gap: 4 },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 44, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    input: { flex: 1, color: c.textDark, fontSize: 15, fontFamily: "Inter_400Regular", paddingVertical: 8 },
    clear: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    scope: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium", paddingHorizontal: 20, paddingVertical: 8 },
    center: { padding: 32, alignItems: "center", gap: 10 },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    retry: { minHeight: 44, justifyContent: "center" },
    retryText: { color: c.accentGreen, fontSize: 15, fontFamily: "Inter_600SemiBold" },
    refCard: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, padding: 16, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    refText: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    refGo: { fontSize: 15, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    count: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_600SemiBold", paddingHorizontal: 20, paddingBottom: 4 },
    row: { paddingHorizontal: 20, paddingVertical: 12, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige, gap: 4 },
    rowRef: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    rowText: { fontSize: 16, lineHeight: 24, color: c.textDark, fontFamily: SCRIPTURE_FONT },
    more: { minHeight: 52, alignItems: "center", justifyContent: "center" },
    moreText: { color: c.accentGreen, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  });
}
