import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Modal, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BIBLE_BOOKS, nextChapter, previousChapter } from "@/lib/bibleBooks";
import { type WorshipScripture } from "@/lib/familyApi";
import { BibleApiError, bookByName, bookByCode, getTranslations, bibleRoute, type BibleTranslation } from "@/lib/bibleReaderApi";
import { cachedChapter, checkVerseRange, fullChapterRange, passageLabel, readingTranslation } from "@/lib/gatheringBible";
import { useBibleReadingPrefs, DEFAULT_PREFS, FONT_MIN, FONT_MAX } from "@/lib/bibleReadingPrefs";
import { router } from "expo-router";

// The Gathering's passage comes from the P2P Bible's chapter API — licensed
// translations only, cached on the server per chapter, with honest errors
// (not set up / busy / offline / not in this translation) instead of a blanket
// "not found". Only the REFERENCE is shared with the group; text is fetched.
// Each member may read the shared passage in another licensed translation
// (remembered on their device) — that never changes the group's passage.
type PanelPassage = { verses: { verse: number; text: string }[]; verseCount: number; translationCode: string; translationName: string; copyright: string | null; note: string | null };
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

const DEFAULT_LANGUAGE = "en";
const READ_TRANSLATION_KEY = "p2p.gathering.readTranslation.v1";
const OT_COUNT = 39;

// P2P's own Scripture surface: Book / Chapter / (optional) Verses /
// Translation, with "Whole chapter" as the main way to read — sitting inline
// in the Gathering's Scripture mode in the room's card/typography language.
export default function ScripturePanel({ currentScripture, isGuide, onSelect, largeText = false, selectLabel = "Share with Gathering", showOpenInBible = true }: Props) {
  const sheetWidth = useSheetWidth();
  const sharing = selectLabel !== "Read"; // My Bible reads on its own; the Guide shares
  const [bookPickerOpen, setBookPickerOpen] = useState(false);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [book, setBook] = useState(currentScripture?.book ?? "Psalms");
  const [chapter, setChapter] = useState(currentScripture?.chapter ?? 23);
  const [mode, setMode] = useState<"chapter" | "verses">(currentScripture && currentScripture.startVerse > 1 ? "verses" : "chapter");
  const [startVerse, setStartVerse] = useState(String(currentScripture?.startVerse ?? 1));
  const [endVerse, setEndVerse] = useState(String(currentScripture?.endVerse ?? 1));
  const [translations, setTranslations] = useState<BibleTranslation[]>([]);
  const [translationCode, setTranslationCode] = useState(currentScripture?.translation ?? "");
  const [pickerVerses, setPickerVerses] = useState<number | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [readCode, setReadCode] = useState<string | null>(null); // this member's own reading translation
  const [passage, setPassage] = useState<PanelPassage | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prefs, update: updatePrefs } = useBibleReadingPrefs();

  const bookMeta = useMemo(() => BIBLE_BOOKS.find((b) => b.name === book), [book]);

  useEffect(() => {
    getTranslations().then(({ translations: list }) => {
      // English defaults first, then the rest (all licensed).
      const sorted = [...list].sort((a, b) => Number(b.language === DEFAULT_LANGUAGE) - Number(a.language === DEFAULT_LANGUAGE) || Number(b.isDefault) - Number(a.isDefault));
      setTranslations(sorted);
      if (!translationCode && sorted.length > 0) setTranslationCode(sorted[0].code);
    }).catch(() => {});
    AsyncStorage.getItem(READ_TRANSLATION_KEY).then((v) => { if (v) setReadCode(v); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The picker knows the chapter's real length (same cached request as the passage).
  useEffect(() => {
    if (!isGuide || !bookMeta || !translationCode) return;
    const b = bookByName(book);
    if (!b) return;
    let cancelled = false;
    setPickerVerses(null);
    cachedChapter(b.code, chapter, translationCode).then((ch) => { if (!cancelled) setPickerVerses(ch.verses.length); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isGuide, book, chapter, translationCode, bookMeta]);

  // Shared by Guide and Companions alike — whenever the synced selection
  // changes, everyone (re)fetches the same passage from the same licensed
  // source, in the translation THEY read in. The Guide's own share updates
  // currentScripture via the parent, which lands back here the same way.
  useEffect(() => {
    if (!currentScripture) { setPassage(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const b = bookByName(currentScripture.book) ?? bookByCode(currentScripture.book);
    if (!b) { setLoading(false); setPassage(null); setError(`"${currentScripture.book}" isn't a book of the Bible.`); return; }
    (async () => {
      let t = currentScripture.translation;
      let note: string | null = null;
      try {
        const { translations: list } = await getTranslations();
        // Members (not the Guide, not My Bible's own picker) may read in their own translation.
        const choice = readingTranslation(currentScripture.translation, isGuide ? null : readCode, list, DEFAULT_LANGUAGE);
        if (choice.code) { t = choice.code; note = choice.note; }
      } catch { /* the chapter request below reports the real problem */ }
      const ch = await cachedChapter(b.code, currentScripture.chapter, t);
      const verses = ch.verses.filter((v) => v.verse >= currentScripture.startVerse && v.verse <= currentScripture.endVerse)
        .map((v) => ({ verse: v.verse, text: v.text.replace(/\n/g, " ") }));
      if (!verses.length) throw new BibleApiError(`${b.name} ${currentScripture.chapter} has ${ch.verses.length} verses.`, 404);
      return { verses, verseCount: ch.verses.length, translationCode: ch.translation.code, translationName: ch.translation.name, copyright: ch.copyright, note };
    })()
      .then((p) => { if (!cancelled) setPassage(p); })
      .catch((e) => { if (!cancelled) { setPassage(null); setError(passageErrorMessage(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentScripture?.book, currentScripture?.chapter, currentScripture?.startVerse, currentScripture?.endVerse, currentScripture?.translation, readCode, attempt]);

  function select(start: number, end: number) {
    const translationName = translations.find((t) => t.code === translationCode)?.name;
    onSelect({ translation: translationCode, translationName, book, chapter, startVerse: start, endVerse: end });
  }
  function share() {
    setRangeError(null);
    if (mode === "chapter") {
      const r = fullChapterRange(pickerVerses ?? 176);
      return select(r.start, r.end);
    }
    const r = checkVerseRange(startVerse, endVerse, pickerVerses);
    if (!r.ok) { setRangeError(r.error); return; }
    select(r.start, r.end);
  }

  function goToChapter(direction: "next" | "prev") {
    const result = direction === "next" ? nextChapter(book, chapter) : previousChapter(book, chapter);
    setBook(result.book);
    setChapter(result.chapter);
    setStartVerse("1");
    setEndVerse("1");
    setRangeError(null);
    // Reading on your own: turning the page reads the next chapter straight away.
    if (!sharing) onSelect({ translation: translationCode, translationName: translations.find((t) => t.code === translationCode)?.name, book: result.book, chapter: result.chapter, startVerse: 1, endVerse: 176 });
  }

  function chooseReadTranslation(code: string) {
    const next = code === currentScripture?.translation ? null : code;
    setReadCode(next);
    if (next) AsyncStorage.setItem(READ_TRANSLATION_KEY, next).catch(() => {});
    else AsyncStorage.removeItem(READ_TRANSLATION_KEY).catch(() => {});
  }

  const actionLabel = mode === "chapter" ? (sharing ? "Share full chapter" : "Read full chapter") : (sharing ? "Share verses" : "Read verses");
  const fontDelta = prefs.fontSize - DEFAULT_PREFS.fontSize;
  const passageSize = (largeText ? 20 : 15) + fontDelta;
  const showReadIn = !!currentScripture && !isGuide && translations.length > 1;
  return (
    <View>
      {isGuide && (
        <View style={styles.pickerCard}>
          <View style={styles.pickerRow}>
            <TouchableOpacity style={styles.bookBtn} onPress={() => setBookPickerOpen(true)} accessibilityRole="button" accessibilityLabel={`Book: ${book}. Change book`}>
              <Text style={styles.bookBtnText}>{book}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bookBtn} onPress={() => setChapterPickerOpen(true)} accessibilityRole="button" accessibilityLabel={`Chapter ${chapter}. Change chapter`}>
              <Text style={styles.bookBtnText}>Chapter {chapter}</Text>
            </TouchableOpacity>
            <View style={styles.chapterStepper}>
              <TouchableOpacity onPress={() => setChapter((c) => Math.max(1, c - 1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Previous chapter number">
                <Text style={styles.stepperBtn}>–</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setChapter((c) => Math.min(bookMeta?.chapters ?? 150, c + 1))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Next chapter number">
                <Text style={styles.stepperBtn}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.pickerRow}>
            {(["chapter", "verses"] as const).map((m) => (
              <TouchableOpacity key={m} style={[styles.modeChip, mode === m && styles.modeChipActive]} onPress={() => { setMode(m); setRangeError(null); }}
                accessibilityRole="button" accessibilityState={{ selected: mode === m }} accessibilityLabel={m === "chapter" ? "Whole chapter" : "Choose verses"}>
                <Text style={[styles.modeChipText, mode === m && styles.modeChipTextActive]}>{m === "chapter" ? "Whole chapter" : "Choose verses"}</Text>
              </TouchableOpacity>
            ))}
            {pickerVerses ? <Text style={styles.verseCount}>{pickerVerses} verses</Text> : null}
          </View>

          {mode === "verses" && (
            <View style={styles.pickerRow}>
              <Text style={styles.verseLabel}>Verses</Text>
              <TextInput style={styles.verseInput} value={startVerse} onChangeText={(v) => { setStartVerse(v); setRangeError(null); }} keyboardType="number-pad" accessibilityLabel="First verse" />
              <Text style={styles.verseDash}>–</Text>
              <TextInput style={styles.verseInput} value={endVerse} onChangeText={(v) => { setEndVerse(v); setRangeError(null); }} keyboardType="number-pad" accessibilityLabel="Last verse" />
              {pickerVerses ? <Text style={styles.verseHint}>of {pickerVerses}</Text> : null}
            </View>
          )}
          {rangeError ? <Text style={styles.errorText} accessibilityRole="alert">{rangeError}</Text> : null}

          {translations.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.translationRow}>
              {translations.map((t) => (
                <TouchableOpacity
                  key={t.code}
                  style={[styles.translationChip, translationCode === t.code && styles.translationChipActive]}
                  onPress={() => setTranslationCode(t.code)}
                  accessibilityRole="button" accessibilityLabel={`Translation ${t.name}`} accessibilityState={{ selected: translationCode === t.code }}
                >
                  <Text style={[styles.translationChipText, translationCode === t.code && styles.translationChipTextActive]}>{t.code}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.shareBtn} onPress={share} accessibilityRole="button" accessibilityLabel={sharing ? `${actionLabel} with the Gathering` : actionLabel}>
            <Text style={styles.shareBtnText}>{actionLabel}</Text>
          </TouchableOpacity>

          <View style={styles.navRow}>
            <TouchableOpacity onPress={() => goToChapter("prev")} accessibilityRole="button" accessibilityLabel="Previous chapter"><Text style={styles.navBtnText}>‹ Previous Chapter</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => goToChapter("next")} accessibilityRole="button" accessibilityLabel="Next chapter"><Text style={styles.navBtnText}>Next Chapter ›</Text></TouchableOpacity>
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

      {passage && currentScripture && (
        <View style={styles.passageBox}>
          <View style={styles.passageHead}>
            <Text style={[styles.passageRef, largeText && styles.passageRefLarge, { flex: 1 }]} accessibilityRole="header">
              {passageLabel(currentScripture, passage.verseCount)}
            </Text>
            <TouchableOpacity onPress={() => updatePrefs({ fontSize: Math.max(FONT_MIN, prefs.fontSize - 1) })} style={styles.sizeBtn} accessibilityRole="button" accessibilityLabel="Smaller text">
              <Text style={styles.sizeBtnText}>A−</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => updatePrefs({ fontSize: Math.min(FONT_MAX, prefs.fontSize + 1) })} style={styles.sizeBtn} accessibilityRole="button" accessibilityLabel="Larger text">
              <Text style={[styles.sizeBtnText, { fontSize: 15 }]}>A+</Text>
            </TouchableOpacity>
          </View>
          {passage.verses.map((v) => (
            <Text key={v.verse} style={[styles.passageText, largeText && styles.passageTextLarge, { fontSize: passageSize, lineHeight: Math.round(passageSize * 1.6) }]}>
              <Text style={styles.verseNumber}>{v.verse} </Text>
              {v.text}
            </Text>
          ))}
          {passage.note ? <Text style={styles.passageMeta}>{passage.note}</Text> : null}
          <Text style={styles.passageMeta}>{passage.translationName}{passage.copyright ? ` · ${passage.copyright}` : ""}</Text>
          {showReadIn ? (
            <View style={{ gap: 6, marginTop: 6 }}>
              <Text style={styles.verseLabel}>Read in (only you):</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.translationRow}>
                {translations.map((t) => {
                  const active = passage.translationCode === t.code;
                  return (
                    <TouchableOpacity key={t.code} style={[styles.translationChip, active && styles.translationChipActive]} onPress={() => chooseReadTranslation(t.code)}
                      accessibilityRole="button" accessibilityState={{ selected: active }}
                      accessibilityLabel={`Read in ${t.name}${t.code === currentScripture.translation ? " (the shared translation)" : ""}`}>
                      <Text style={[styles.translationChipText, active && styles.translationChipTextActive]}>{t.code}{t.code === currentScripture.translation ? " · shared" : ""}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          {showOpenInBible && bookByName(currentScripture.book) ? (
            // Opens the P2P Bible ON TOP of the Gathering (the call keeps
            // running; the reader shows the Return bar and the group passage).
            <TouchableOpacity onPress={() => {
                const b = bookByName(currentScripture.book)!;
                router.push(bibleRoute({ book: b.code, chapter: currentScripture.chapter, v: currentScripture.startVerse, ve: currentScripture.endVerse, translation: passage.translationCode }) as any);
              }}
              accessibilityRole="button" accessibilityLabel="Open in the Bible with your notes and highlights">
              <Text style={styles.navBtnText}>Open in the Bible (notes, highlights, compare) ›</Text>
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
              {BIBLE_BOOKS.map((b, i) => (
                <React.Fragment key={b.name}>
                  {i === 0 || i === OT_COUNT ? <Text style={styles.testament}>{i === 0 ? "Old Testament" : "New Testament"}</Text> : null}
                  <TouchableOpacity
                    style={styles.bookRow}
                    onPress={() => { setBook(b.name); setChapter(1); setStartVerse("1"); setEndVerse("1"); setRangeError(null); setBookPickerOpen(false); setChapterPickerOpen(b.chapters > 1); }}
                    accessibilityRole="button" accessibilityLabel={b.name}
                  >
                    <Text style={[styles.bookRowText, b.name === book && { color: "#B8860B" }]}>{b.name}</Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={chapterPickerOpen} transparent animationType="slide" onRequestClose={() => setChapterPickerOpen(false)}>
        <View style={styles.bookModalOverlay}>
          <View style={[styles.bookModalSheet, sheetWidth]}>
            <Text style={styles.bookModalTitle}>{book} — choose a chapter</Text>
            <ScrollView contentContainerStyle={styles.chapterGrid}>
              {Array.from({ length: bookMeta?.chapters ?? 1 }, (_, i) => i + 1).map((n) => (
                <TouchableOpacity key={n} style={[styles.chapterCell, n === chapter && styles.chapterCellActive]}
                  onPress={() => { setChapter(n); setStartVerse("1"); setEndVerse("1"); setRangeError(null); setChapterPickerOpen(false); }}
                  accessibilityRole="button" accessibilityLabel={`Chapter ${n}`} accessibilityState={{ selected: n === chapter }}>
                  <Text style={[styles.chapterCellText, n === chapter && { color: "#fff" }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setChapterPickerOpen(false)} style={{ alignSelf: "center", padding: 12 }} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.navBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  passageMeta: { color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 6 },
  pickerCard: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 12, gap: 10 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  bookBtn: { backgroundColor: "rgba(184,134,11,0.2)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: "center" },
  bookBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  chapterStepper: { flexDirection: "row", alignItems: "center", gap: 14, marginLeft: "auto" },
  stepperBtn: { color: "#B8860B", fontSize: 20, fontWeight: "700", width: 20, textAlign: "center" },
  modeChip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
  modeChipActive: { backgroundColor: "rgba(29,158,117,0.25)", borderColor: "#1D9E75" },
  modeChipText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_500Medium" },
  modeChipTextActive: { color: "#fff", fontFamily: "Inter_700Bold" },
  verseCount: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginLeft: "auto", fontFamily: "Inter_400Regular" },
  verseLabel: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: "Inter_400Regular" },
  verseHint: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Inter_400Regular" },
  verseInput: {
    width: 48, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8,
    color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center",
  },
  verseDash: { color: "rgba(255,255,255,0.5)" },
  shareBtn: { backgroundColor: "#1D9E75", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, alignItems: "center", minHeight: 44, justifyContent: "center" },
  shareBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  translationRow: { gap: 6 },
  translationChip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
  translationChipActive: { backgroundColor: "#B8860B", borderColor: "#B8860B" },
  translationChipText: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontFamily: "Inter_500Medium" },
  translationChipTextActive: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  navRow: { flexDirection: "row", justifyContent: "space-between" },
  navBtnText: { color: "#5B8DEF", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", paddingVertical: 6 },

  errorText: { color: "#F87171", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  emptyText: { color: "rgba(255,255,255,0.4)", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8 },

  passageBox: { marginTop: 12, gap: 4 },
  passageHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  passageRef: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  passageRefLarge: { fontSize: 19 },
  sizeBtn: { minWidth: 40, minHeight: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  sizeBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  passageTextLarge: { fontSize: 20, lineHeight: 32 },
  passageText: { color: "rgba(255,255,255,0.88)", fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24 },
  verseNumber: { color: "#B8860B", fontSize: 11, fontFamily: "Inter_700Bold" },

  bookModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  bookModalSheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "75%", width: "100%", alignSelf: "center" },
  bookModalTitle: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 10 },
  testament: { color: "#B8860B", fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 10, marginBottom: 2 },
  bookRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  bookRowText: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  chapterGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 },
  chapterCell: { width: 48, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)" },
  chapterCellActive: { backgroundColor: "#B8860B" },
  chapterCellText: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
