import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BibleApiError, formatRef, bookByCode, getChapter, getTranslations, readerTarget, SCRIPTURE_FONT, type BibleTranslation } from "@/lib/bibleReaderApi";
import { loadPosition } from "@/lib/bibleReadingPrefs";
import type { useStudySession } from "@/hooks/useStudySession";
import ReadableText from "@/components/ReadableText";
import ReadInBibleLink from "@/components/bible/ReadInBibleLink";

// Scripture supports the learning (spec: "a supporting tool inside Study
// Together"), lesson content stays primary. Text comes from the P2P Bible
// reader (licensed translations only, lib/bibleReaderApi), in the translation
// this person reads in the Bible; "Share with Group" broadcasts it so both
// participants see the same passage.
export function StudyScriptureTab({ session }: { session: ReturnType<typeof useStudySession> }) {
  const [ref, setRef] = useState("");
  const [result, setResult] = useState<{ reference: string; text: string; translation: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [t, setT] = useState<string | null>(null);

  // Licensed translations; start in the one last read in the Bible, else the default.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await getTranslations()).translations;
        const saved = await loadPosition();
        if (cancelled || !list.length) return;
        setTranslations(list);
        setT(list.some((x) => x.code === saved?.translation) ? saved!.translation
          : list.find((x) => x.isDefault && x.language === "en")?.code ?? list.find((x) => x.isDefault)?.code ?? list[0].code);
      } catch { /* the lookup reports it */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleLookup() {
    const target = readerTarget(ref);
    if (!ref.trim()) return;
    setError(""); setResult(null);
    if (!target) { setError("Type a reference like \"John 3:16\" or \"Psalm 23\"."); return; }
    if (!t) { setError("The Bible couldn't be loaded. Check your connection and try again."); return; }
    setLoading(true);
    try {
      const chapter = await getChapter(target.book, target.chapter, t);
      const verses = target.v ? chapter.verses.filter((v) => v.verse >= target.v! && v.verse <= (target.ve ?? target.v!)) : chapter.verses;
      if (!verses.length) setError("Those verses aren't in this chapter.");
      else setResult({
        reference: formatRef(bookByCode(target.book), target.chapter, target.v, target.ve),
        text: verses.map((v) => v.text.trim()).join(" "),
        translation: chapter.translation.code,
      });
    } catch (e) {
      setError(e instanceof BibleApiError ? e.message : "Scripture couldn't be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={ref}
          onChangeText={setRef}
          placeholder="e.g. John 3:16"
          placeholderTextColor="rgba(255,255,255,0.4)"
          autoCapitalize="words"
          onSubmitEditing={handleLookup}
        />
        <TouchableOpacity accessibilityRole="button" style={styles.searchBtn} onPress={handleLookup} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      {translations.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {translations.map((x) => (
            <TouchableOpacity
              key={x.code}
              accessibilityRole="button"
              accessibilityLabel={`Translation ${x.name}`}
              accessibilityState={{ selected: x.code === t }}
              style={[styles.trChip, x.code === t && styles.trChipOn]}
              onPress={() => { setT(x.code); setResult(null); }}
            >
              <Text style={[styles.trChipText, x.code === t && styles.trChipTextOn]}>{x.code}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {result && (
        <View style={styles.resultCard}>
          <Text style={styles.resultText}>"{result.text}"</Text>
          <ReadableText style={styles.resultRef}>— {result.reference} ({result.translation})</ReadableText>
          <ReadInBibleLink reference={result.reference} translation={result.translation} label="Read in context" />
          <TouchableOpacity accessibilityRole="button" style={styles.shareBtn} onPress={() => session.shareScripture(`${result.reference} (${result.translation})`, result.text)}>
            <Ionicons name="people" size={14} color="#fff" />
            <Text style={styles.shareBtnText}>Share with Group</Text>
          </TouchableOpacity>
        </View>
      )}

      {!result && session.sharedScripture && (
        <View style={styles.resultCard}>
          <Text style={styles.sharedLabel}>Shared with the group</Text>
          <Text style={styles.resultText}>"{session.sharedScripture.verse}"</Text>
          <ReadableText style={styles.resultRef}>— {session.sharedScripture.reference}</ReadableText>
          <ReadInBibleLink reference={session.sharedScripture.reference} translation={session.sharedScripture.reference.match(/\((\w+)\)$/)?.[1]} label="Read in context" />
        </View>
      )}

      {session.scripturesDiscussed.length > 0 && (
        <View>
          <Text style={styles.historyTitle}>Scriptures Discussed</Text>
          {session.scripturesDiscussed.map((s, i) => (
            <ReadableText key={i} style={styles.historyItem}>{s.reference}</ReadableText>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1, backgroundColor: "#1A241E", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular",
  },
  searchBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
  errorText: { color: "#DC2626", fontSize: 12, fontFamily: "Inter_400Regular" },
  resultCard: { backgroundColor: "#1A241E", borderRadius: 14, padding: 16, gap: 10 },
  sharedLabel: { color: "rgba(255,255,255,0.5)", fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  trChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#1A241E" },
  trChipOn: { backgroundColor: "#1D9E75" },
  trChipText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_700Bold" },
  trChipTextOn: { color: "#fff" },
  resultText: { color: "#fff", fontSize: 16, fontFamily: SCRIPTURE_FONT, lineHeight: 24 },
  resultRef: { color: "#1D9E75", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#1D9E75", borderRadius: 10, paddingVertical: 10, alignSelf: "flex-start", paddingHorizontal: 14,
  },
  shareBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  historyTitle: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  historyItem: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 4 },
});