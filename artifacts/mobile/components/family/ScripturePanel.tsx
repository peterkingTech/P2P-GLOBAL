import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Modal, ActivityIndicator } from "react-native";
import { BIBLE_BOOKS, nextChapter, previousChapter } from "@/lib/bibleBooks";
import { formatScriptureReference, type WorshipScripture } from "@/lib/familyApi";
import { BibleApiError, bookByName, bookByCode, getChapter, getTranslations, bibleRoute } from "@/lib/bibleReaderApi";
import { router } from "expo-router";

// The Gathering's passage comes from the P2P Bible's chapter API — licensed
// translations only, cached on the server per chapter, with honest errors
// (not set up / busy / offline / not in this translation) instead of a blanket
// "not found". Only the REFERENCE is shared with the group; text is fetched.
type PanelTranslation = { translation_code: string; translation_name: string };
type PanelPassage = { verses: { verse: number; text: string }[]; translationCode: string; translationName: string; copyright: string | null; note: string | null };
export function passageErrorMessage(e: unknown): string {
  if (e instanceof BibleApiError) {
    if (e.status === 0) return "You're offline — the passage will load when you're connected.";
    if (e.status === 503) return "The Bible isn't available on the server right now. Please try again later.";
    if (e.status === 429) return "The Bible is busy right now — please try again in a moment.";
    if (e.status === 404) return "That passage isn't available in this translation.";
    if (e.status === 401) return "Please sign in again to read Scripture.";
    return e.message;
  }
  return "Couldn't load that passage. Please try again.";
}

import { useSheetWidth } from "@/hooks/useLayout";
interface Props {
  currentScripture: WorshipScripture | null;
  isGuide: boolean;
  onSelect: (scripture: WorshipScripture) => void;
  // Expanded (focus) view: larger, more comfortable reading text.
  largeText?: boolean;
  // The picker button's label. Default: sharing with the Gathering (Guide).
  // "My Bible" uses the same picker to read on your own, without sharing.
  selectLabel?: string;
  /** "Read the full chapter" link (off inside a Modal such as My Bible, which has its own). */
  showOpenInBible?: boolean;
}

const DEFAULT_LANGUAGE = "en"; // Scope limit for this pass — see ScripturePanel's report note.
const MAX_VERSE_SPAN = 29;

// P2P's own Scripture surface: a compact Book/Chapter/Verse/Translation
// picker (not a paginated Bible-app reader) sitting inline in the
// Gathering's Scripture mode, sharing the room's existing card/typography
// language rather than a separate reading-app aesthetic.
export default function ScripturePanel({ currentScripture, isGuide, onSelect, largeText = false, selectLabel = "Share with Gathering", showOpenInBible = true }: Props) {
  const sheetWidth = useSheetWidth();
  const [bookPickerOpen, setBookPickerOpen] = useState(false);
  const [book, setBook] = useState(currentScripture?.book ?? "Psalms");
  const [chapter, setChapter] = useState(currentScripture?.chapter ?? 23);
  const [startVerse, setStartVerse] = useState(String(currentScripture?.startVerse ?? 1));
  const [endVerse, setEndVerse] = useState(String(currentScripture?.endVerse ?? 1));
  const [translations, setTranslations] = useState<PanelTranslation[]>([]);
  const [translationCode, setTranslationCode] = useState(currentScripture?.translation ?? "");
  const [passage, setPassage] = useState<PanelPassage | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bookMeta = useMemo(() => BIBLE_BOOKS.find((b) => b.name === book), [book]);

  useEffect(() => {
    getTranslations().then(({ translations: list }) => {
      const mapped = list.map((t) => ({ translation_code: t.code, translation_name: t.name, isDefault: t.isDefault, language: t.language }));
      // English defaults first, then the rest (all licensed).
      mapped.sort((a, b) => Number(b.language === DEFAULT_LANGUAGE) - Number(a.language === DEFAULT_LANGUAGE) || Number(b.isDefault) - Number(a.isDefault));
      setTranslations(mapped);
      if (!translationCode && mapped.length > 0) setTranslationCode(mapped[0].translation_code);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared by Guide and Companions alike — whenever the synced selection
  // changes, everyone (re)fetches the same passage from the same licensed
  // source. The Guide's own "Share with Gathering" tap updates
  // currentScripture via the parent, which lands back here the same way.
  useEffect(() => {
    if (!currentScripture) { setPassage(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const b = bookByName(currentScripture.book) ?? bookByCode(currentScripture.book);
    if (!b) { setLoading(false); setPassage(null); setError(`"${currentScripture.book}" isn't a book of the Bible.`); return; }
    (async () => {
      // The shared translation may not be licensed for this app (older
      // sessions): read it in the default licensed one and say so.
      let t = currentScripture.translation;
      let note: string | null = null;
      try {
        const { translations: list } = await getTranslations();
        if (!list.some((x) => x.code === t)) {
          const fallback = list.find((x) => x.isDefault && x.language === DEFAULT_LANGUAGE) ?? list[0];
          if (fallback) { note = `${t || "That translation"} isn't available — shown in ${fallback.code}.`; t = fallback.code; }
        }
      } catch { /* the chapter request below reports the real problem */ }
      const ch = await getChapter(b.code, currentScripture.chapter, t);
      const verses = ch.verses.filter((v) => v.verse >= currentScripture.startVerse && v.verse <= currentScripture.endVerse)
        .map((v) => ({ verse: v.verse, text: v.text.replace(/\n/g, " ") }));
      if (!verses.length) throw new BibleApiError(`${b.name} ${currentScripture.chapter} has ${ch.verses.length} verses.`, 404);
      return { verses, translationCode: ch.translation.code, translationName: ch.translation.name, copyright: ch.copyright, note };
    })()
      .then((p) => { if (!cancelled) setPassage(p); })
      .catch((e) => { if (!cancelled) { setPassage(null); setError(passageErrorMessage(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentScripture?.book, currentScripture?.chapter, currentScripture?.startVerse, currentScripture?.endVerse, currentScripture?.translation, attempt]);

  function share() {
    const start = Math.max(1, parseInt(startVerse, 10) || 1);
    const end = Math.min(start + MAX_VERSE_SPAN, Math.max(start, parseInt(endVerse, 10) || start));
    const translationName = translations.find((t) => t.translation_code === translationCode)?.translation_name;
    onSelect({ translation: translationCode, translationName, book, chapter, startVerse: start, endVerse: end });
  }

  function goToChapter(direction: "next" | "prev") {
    const result = direction === "next" ? nextChapter(book, chapter) : previousChapter(book, chapter);
    setBook(result.book);
    setChapter(result.chapter);
    setStartVerse("1");
    setEndVerse("1");
  }

  return (
    <View>
      {isGuide && (
        <View style={styles.pickerCard}>
          <View style={styles.pickerRow}>
            <TouchableOpacity style={styles.bookBtn} onPress={() => setBookPickerOpen(true)}>
              <Text style={styles.bookBtnText}>{book}</Text>
            </TouchableOpacity>
            <View style={styles.chapterStepper}>
              <TouchableOpacity onPress={() => setChapter((c) => Math.max(1, c - 1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.stepperBtn}>–</Text>
              </TouchableOpacity>
              <Text style={styles.chapterValue}>{chapter}</Text>
              <TouchableOpacity onPress={() => setChapter((c) => Math.min(bookMeta?.chapters ?? 150, c + 1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.stepperBtn}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.pickerRow}>
            <Text style={styles.verseLabel}>Verses</Text>
            <TextInput style={styles.verseInput} value={startVerse} onChangeText={setStartVerse} keyboardType="number-pad" />
            <Text style={styles.verseDash}>–</Text>
            <TextInput style={styles.verseInput} value={endVerse} onChangeText={setEndVerse} keyboardType="number-pad" />
            <TouchableOpacity style={styles.shareBtn} onPress={share} accessibilityRole="button" accessibilityLabel={selectLabel}>
              <Text style={styles.shareBtnText}>{selectLabel}</Text>
            </TouchableOpacity>
          </View>

          {translations.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.translationRow}>
              {translations.map((t) => (
                <TouchableOpacity
                  key={t.translation_code}
                  style={[styles.translationChip, translationCode === t.translation_code && styles.translationChipActive]}
                  onPress={() => setTranslationCode(t.translation_code)}
                >
                  <Text style={[styles.translationChipText, translationCode === t.translation_code && styles.translationChipTextActive]}>{t.translation_code}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <View style={styles.navRow}>
            <TouchableOpacity onPress={() => goToChapter("prev")}><Text style={styles.navBtnText}>‹ Previous Chapter</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => goToChapter("next")}><Text style={styles.navBtnText}>Next Chapter ›</Text></TouchableOpacity>
          </View>
        </View>
      )}

      {loading && <ActivityIndicator color="#B8860B" style={{ marginTop: 12 }} />}
      {error && (
        <View style={{ gap: 6 }}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button" accessibilityLabel="Try loading the passage again">
            <Text style={styles.navBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      {passage && (
        <View style={styles.passageBox}>
          <Text style={[styles.passageRef, largeText && styles.passageRefLarge]}>{currentScripture ? formatScriptureReference(currentScripture) : ""}</Text>
          {passage.verses.map((v) => (
            <Text key={v.verse} style={[styles.passageText, largeText && styles.passageTextLarge]}>
              <Text style={styles.verseNumber}>{v.verse} </Text>
              {v.text}
            </Text>
          ))}
          {passage.note ? <Text style={styles.passageMeta}>{passage.note}</Text> : null}
          <Text style={styles.passageMeta}>{passage.translationName}{passage.copyright ? ` · ${passage.copyright}` : ""}</Text>
          {showOpenInBible && currentScripture && bookByName(currentScripture.book) ? (
            // Opens the P2P Bible ON TOP of the Gathering (the call keeps
            // running; the reader shows the Return bar and the group passage).
            <TouchableOpacity onPress={() => {
                const b = bookByName(currentScripture.book)!;
                router.push(bibleRoute({ book: b.code, chapter: currentScripture.chapter, v: currentScripture.startVerse, ve: currentScripture.endVerse, translation: passage.translationCode }) as any);
              }}
              accessibilityRole="button" accessibilityLabel="Read the full chapter in the Bible">
              <Text style={styles.navBtnText}>Read the full chapter ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {!currentScripture && !loading && <Text style={styles.emptyText}>No passage selected yet.</Text>}

      <Modal visible={bookPickerOpen} transparent animationType="slide" onRequestClose={() => setBookPickerOpen(false)}>
        <View style={styles.bookModalOverlay}>
          <View style={[styles.bookModalSheet, sheetWidth]}>
            <Text style={styles.bookModalTitle}>Select a Book</Text>
            <ScrollView>
              {BIBLE_BOOKS.map((b) => (
                <TouchableOpacity
                  key={b.name}
                  style={styles.bookRow}
                  onPress={() => { setBook(b.name); setChapter(1); setStartVerse("1"); setEndVerse("1"); setBookPickerOpen(false); }}
                >
                  <Text style={styles.bookRowText}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  passageMeta: { color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 6 },
  pickerCard: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 12, gap: 10 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bookBtn: { backgroundColor: "rgba(184,134,11,0.2)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  bookBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  chapterStepper: { flexDirection: "row", alignItems: "center", gap: 10, marginLeft: "auto" },
  stepperBtn: { color: "#B8860B", fontSize: 20, fontWeight: "700", width: 20, textAlign: "center" },
  chapterValue: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", minWidth: 24, textAlign: "center" },
  verseLabel: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: "Inter_400Regular" },
  verseInput: {
    width: 44, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8,
    color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center",
  },
  verseDash: { color: "rgba(255,255,255,0.5)" },
  shareBtn: { marginLeft: "auto", backgroundColor: "#1D9E75", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  shareBtnText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  translationRow: { gap: 6 },
  translationChip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  translationChipActive: { backgroundColor: "#B8860B", borderColor: "#B8860B" },
  translationChipText: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontFamily: "Inter_500Medium" },
  translationChipTextActive: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  navRow: { flexDirection: "row", justifyContent: "space-between" },
  navBtnText: { color: "#5B8DEF", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  errorText: { color: "#DC2626", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 8 },
  emptyText: { color: "rgba(255,255,255,0.4)", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8 },

  passageBox: { marginTop: 12, gap: 4 },
  passageRef: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4 },
  passageRefLarge: { fontSize: 19, marginBottom: 8 },
  passageTextLarge: { fontSize: 20, lineHeight: 32 },
  passageText: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, fontStyle: "italic" },
  verseNumber: { color: "#B8860B", fontSize: 11, fontStyle: "normal", fontFamily: "Inter_700Bold" },

  bookModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  bookModalSheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "70%", width: "100%", alignSelf: "center" },
  bookModalTitle: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 10 },
  bookRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  bookRowText: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
});