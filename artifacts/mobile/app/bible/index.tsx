import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Share, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import GatheringReturnBar from "@/components/family/GatheringReturnBar";
import BookChapterPicker from "@/components/bible/BookChapterPicker";
import TranslationPicker from "@/components/bible/TranslationPicker";
import BibleNoteSheet from "@/components/bible/BibleNoteSheet";
import ReadingPrefsSheet from "@/components/bible/ReadingPrefsSheet";
import RelatedLessonsSheet from "@/components/bible/RelatedLessonsSheet";
import { useActiveGathering } from "@/lib/activeGathering";
import {
  BibleApiError, HIGHLIGHT_COLORS, SCRIPTURE_FONT, addHighlight, addNote, bookByCode, bookByName, deleteNote, formatRef, getChapter,
  getMyChapter, getTranslations, highlightPalette, removeBookmark, saveBookmark, updateNote, eraseHighlight, restoreHighlights,
  type BibleChapter, type BibleNote, type BibleTranslation, type Bookmark, type Highlight, type HighlightColor, type NewRef, type Offsets,
} from "@/lib/bibleReaderApi";
import {
  nudgeRange, phraseRange, rangeText, rangeToStored, sentenceRange, storedToRange, tokenize, verseRuns, wordRange,
  type TextRange, type Token,
} from "@/lib/bibleRanges";
import { withAlpha } from "@/lib/colorUtils";
import { LINE_HEIGHT, loadPosition, savePosition, useBibleReadingPrefs } from "@/lib/bibleReadingPrefs";
import { useStudyTimeTracker } from "@/lib/studyTime";
import { useAuth } from "@/contexts/AuthContext";

// The P2P Bible reader. Scripture comes from the server (licensed API.Bible
// translations only, never stored in our database); highlights, notes and
// saved passages are the reader's own and private. Colours always come from
// the P2P theme. Opening this from a Gathering pushes it ON TOP of the call
// screen, so the call keeps running; the Return bar goes back to it.

type Params = { book?: string; chapter?: string; v?: string; ve?: string; t?: string };
// How a tap selects text. Verse (default) and Passage select whole verses;
// Word, Phrase and Sentence select exact words — never silently widened.
type SelectMode = "verse" | "word" | "phrase" | "sentence" | "passage";
const MODES: { key: SelectMode; label: string; hint: string }[] = [
  { key: "verse", label: "Verse", hint: "Tap a verse; tap another to extend" },
  { key: "word", label: "Word", hint: "Tap a word" },
  { key: "phrase", label: "Phrase", hint: "Tap the first word, then the last word" },
  { key: "sentence", label: "Sentence", hint: "Tap any word in the sentence" },
  { key: "passage", label: "Passage", hint: "Tap the first verse, then the last verse" },
];
const INLINE_BUTTON_ROLE = Platform.OS === "web" ? undefined : ("button" as const);
type UndoSpec = { remove: string[]; add: (NewRef & Offsets & { color: HighlightColor })[]; label: string };
type MyData = { available: boolean; highlights: Highlight[]; notes: BibleNote[]; bookmarks: Bookmark[] };
const EMPTY_MY: MyData = { available: true, highlights: [], notes: [], bookmarks: [] };

export default function BibleReaderScreen() {
  const params = useLocalSearchParams<Params>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c, resolvedMode } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const palette = useMemo(() => highlightPalette(resolvedMode), [resolvedMode]);
  const { prefs, update: updatePrefs } = useBibleReadingPrefs();
  const gathering = useActiveGathering();
  // Daily study goal: count time while this screen is focused and on screen.
  const { profile } = useAuth();
  const [screenFocused, setScreenFocused] = useState(false);
  useFocusEffect(useCallback(() => { setScreenFocused(true); return () => setScreenFocused(false); }, []));
  useStudyTimeTracker(profile?.id, screenFocused);

  const [translations, setTranslations] = useState<BibleTranslation[] | null>(null);
  const [trError, setTrError] = useState<string | null>(null);
  const [trAttempt, setTrAttempt] = useState(0);
  const [loc, setLoc] = useState<{ t: string; book: string; chapter: number; v?: number; ve?: number } | null>(null);
  const [data, setData] = useState<BibleChapter | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [my, setMy] = useState<MyData>(EMPTY_MY);
  const [mode, setSelectMode] = useState<SelectMode>("verse");
  const [range, setRange] = useState<TextRange | null>(null);
  const anchorRef = useRef<{ verse: number; t: Token } | number | null>(null);
  const [undo, setUndo] = useState<UndoSpec | null>(null);
  const [modeSheet, setModeSheet] = useState(false);
  // Whole verses covered by the selection (notes and saved passages are per verse).
  const sel = range ? { start: range.start.verse, end: range.end.verse } : null;
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [sheet, setSheet] = useState<null | "books" | "translations" | "prefs" | "related" | "menu">(null);
  const [noteEdit, setNoteEdit] = useState<{ ref: NewRef; label: string; note: BibleNote | null } | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const blockY = useRef(new Map<number, number>());   // first verse of a block → y
  const reqId = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ── Translations (only licensed ones are ever listed) ────────────────────
  useEffect(() => {
    let cancelled = false;
    setTrError(null);
    getTranslations()
      .then((r) => { if (!cancelled) setTranslations(r.translations); })
      .catch((e) => { if (!cancelled) setTrError(e instanceof BibleApiError ? e.message : "Couldn't load translations."); });
    return () => { cancelled = true; };
  }, [trAttempt]);

  // ── Where to open: params → last position → John 1 in the default translation
  useEffect(() => {
    if (!translations?.length) return;
    let cancelled = false;
    (async () => {
      const codes = new Set(translations.map((t) => t.code));
      const fallbackT = translations.find((t) => t.isDefault && t.language === "en")?.code ?? translations.find((t) => t.isDefault)?.code ?? translations[0].code;
      const pBook = bookByCode(params.book);
      const pCh = Number(params.chapter);
      if (pBook && Number.isInteger(pCh) && pCh >= 1 && pCh <= pBook.chapters) {
        const saved = await loadPosition();
        const t = params.t && codes.has(params.t) ? params.t : saved && codes.has(saved.translation) ? saved.translation : fallbackT;
        const v = Number(params.v) || undefined;
        if (!cancelled) setLoc({ t, book: pBook.code, chapter: pCh, v, ve: v ? Math.max(v, Number(params.ve) || v) : undefined });
        return;
      }
      const saved = await loadPosition();
      if (cancelled) return;
      const sb = bookByCode(saved?.book);
      if (saved && sb && saved.chapter >= 1 && saved.chapter <= sb.chapters) {
        setLoc({ t: codes.has(saved.translation) ? saved.translation : fallbackT, book: sb.code, chapter: saved.chapter });
      } else {
        setLoc({ t: fallbackT, book: "JHN", chapter: 1 });
      }
    })();
    return () => { cancelled = true; };
  }, [translations, params.book, params.chapter, params.v, params.ve, params.t]);

  // ── Chapter text — newest request wins; stale responses are dropped ──────
  useEffect(() => {
    if (!loc) return;
    const id = ++reqId.current;
    const ac = new AbortController();
    setLoading(true); setError(null); setRange(null); anchorRef.current = null;
    blockY.current.clear();
    getChapter(loc.book, loc.chapter, loc.t, ac.signal)
      .then((ch) => {
        if (id !== reqId.current) return;
        setData(ch);
        savePosition({ translation: loc.t, book: loc.book, chapter: loc.chapter });
        if (loc.v) {
          const ve = loc.ve ?? loc.v;
          const endLen = ch.verses.find((x) => x.verse === ve)?.text.length ?? 0;
          setRange({ start: { verse: loc.v, offset: 0 }, end: { verse: ve, offset: endLen } });
        }
        else scrollRef.current?.scrollTo({ y: 0, animated: false });
      })
      .catch((e) => {
        if (id !== reqId.current || e?.name === "AbortError") return;
        setError({ message: e instanceof BibleApiError ? e.message : "Couldn't open this chapter.", status: e?.status ?? 0 });
      })
      .finally(() => { if (id === reqId.current) setLoading(false); });
    return () => ac.abort();
  }, [loc, attempt]);

  // ── My highlights / notes / saved for this chapter (non-fatal) ────────────
  const locKey = loc ? `${loc.t}:${loc.book}.${loc.chapter}` : "";
  const locKeyRef = useRef(locKey);
  locKeyRef.current = locKey;
  const loadMine = useCallback(async () => {
    if (!loc) return;
    const key = `${loc.t}:${loc.book}.${loc.chapter}`;
    try {
      const r = await getMyChapter(loc.t, loc.book, loc.chapter);
      if (key === locKeyRef.current) setMy(r);
    } catch { if (key === locKeyRef.current) setMy(EMPTY_MY); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locKey]);
  useEffect(() => { setMy(EMPTY_MY); loadMine(); }, [loadMine]);

  const book = bookByCode(loc?.book);
  const translation = translations?.find((t) => t.code === loc?.t);

  const go = useCallback((bookCode: string, chapter: number, extra?: { v?: number; ve?: number; t?: string }) => {
    setSheet(null);
    setLoc((prev) => ({ t: extra?.t ?? prev?.t ?? "", book: bookCode, chapter, v: extra?.v, ve: extra?.ve }));
  }, []);

  // ── Verse-level maps ──────────────────────────────────────────────────────
  const hlByVerse = useMemo(() => {
    const m = new Map<number, Highlight>();
    for (const h of my.highlights) for (let v = h.startVerse; v <= h.endVerse; v++) m.set(v, h);
    return m;
  }, [my.highlights]);
  const notedVerses = useMemo(() => new Set(my.notes.map((n) => n.endVerse)), [my.notes]);

  const blocks = useMemo(() => {
    if (!data) return [];
    const headingAt = new Map<number, string[]>();
    for (const h of data.headings) headingAt.set(h.beforeVerse, [...(headingAt.get(h.beforeVerse) ?? []), h.text]);
    const out: { key: number; headings: string[]; poetry: boolean; verses: BibleChapter["verses"] }[] = [];
    data.verses.forEach((v, i) => {
      const last = out[out.length - 1];
      const heads = headingAt.get(v.verse) ?? [];
      const newBlock = !last || heads.length > 0 || prefs.layout === "verses" || data.verses[i - 1]?.paragraph !== v.paragraph;
      if (newBlock) out.push({ key: v.verse, headings: heads, poetry: v.poetry, verses: [v] });
      else last.verses.push(v);
    });
    return out;
  }, [data, prefs.layout]);

  // Scroll to the requested verse once its block has been laid out.
  // Blocks remount per navigation so onLayout fires even for a cached chapter.
  const pendingScroll = useRef<number | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  useEffect(() => { pendingScroll.current = loc?.v ?? null; setRenderKey((n) => n + 1); }, [loc]);
  const onBlockLayout = (first: number, last: number, y: number) => {
    blockY.current.set(first, y);
    const want = pendingScroll.current;
    if (want && want >= first && want <= last) {
      pendingScroll.current = null;
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true }), 50);
    }
  };

  // ── Selection ─────────────────────────────────────────────────────────────
  const verseList = useMemo(() => (data?.verses ?? []).map((v) => ({ verse: v.verse, text: v.text })), [data]);
  const textOf = useMemo(() => new Map(verseList.map((v) => [v.verse, v.text])), [verseList]);
  const lengthOf = useCallback((v: number) => textOf.get(v)?.length ?? 0, [textOf]);
  const tokensOf = useMemo(() => new Map(verseList.map((v) => [v.verse, tokenize(v.text)])), [verseList]);
  const fullVerses = (a: number, b: number): TextRange => ({ start: { verse: Math.min(a, b), offset: 0 }, end: { verse: Math.max(a, b), offset: lengthOf(Math.max(a, b)) } });
  const textMode = mode === "word" || mode === "phrase" || mode === "sentence";

  const tapVerse = (v: number) => {
    if (mode === "passage") {
      const a = anchorRef.current;
      if (typeof a === "number" && range) { setRange(fullVerses(a, v)); anchorRef.current = null; }
      else { anchorRef.current = v; setRange(fullVerses(v, v)); }
      return;
    }
    setRange((r) => {
      if (!r) return fullVerses(v, v);
      const s0 = r.start.verse, e0 = r.end.verse;
      if (s0 === v && e0 === v) return null;
      if (v >= s0 && v <= e0) return fullVerses(v, v);
      return fullVerses(Math.min(s0, v), Math.max(e0, v));
    });
  };
  const tapWord = (verse: number, t: Token) => {
    if (!t.word) return;
    if (mode === "word") { setRange(wordRange(verse, t)); return; }
    if (mode === "sentence") { setRange(sentenceRange(verseList, { verse, offset: t.start })); return; }
    const a = anchorRef.current;
    if (a && typeof a === "object" && range) { setRange(phraseRange(a, { verse, t })); anchorRef.current = null; }
    else { anchorRef.current = { verse, t }; setRange(wordRange(verse, t)); }
  };
  const chooseMode = (m: SelectMode) => {
    setSelectMode(m); setModeSheet(false); anchorRef.current = null;
    flash(MODES.find((x) => x.key === m)!.hint);
  };

  const selRef: NewRef | null = loc && sel ? { translationCode: loc.t, bookCode: loc.book, chapter: loc.chapter, startVerse: sel.start, endVerse: sel.end } : null;
  const stored = range ? rangeToStored(range, lengthOf) : null;
  const offsets: Offsets | undefined = stored ? { startOffset: stored.startOffset, endOffset: stored.endOffset } : undefined;
  const partial = !!stored && (stored.startOffset != null || stored.endOffset != null);
  const selLabel = sel && book ? `${formatRef(book, loc!.chapter, sel.start, sel.end)} (${loc!.t})${partial ? " · selected words" : ""}` : "";
  const selHighlight = stored ? my.highlights.find((h) => h.startVerse === stored.startVerse && h.endVerse === stored.endVerse
    && (h.startOffset ?? null) === stored.startOffset && (h.endOffset ?? null) === stored.endOffset) ?? null : null;
  const anyHighlightInSel = !!range && my.highlights.some((h) => {
    const r = storedToRange(h, lengthOf);
    const before = (a: { verse: number; offset: number }, b: { verse: number; offset: number }) => a.verse < b.verse || (a.verse === b.verse && a.offset < b.offset);
    return before(r.start, range.end) && before(range.start, r.end);
  });
  const selBookmark = sel ? my.bookmarks.find((b) => b.startVerse === sel.start && b.endVerse === sel.end) ?? null : null;
  const selNote = sel ? my.notes.find((n) => n.startVerse === sel.start && n.endVerse === sel.end) ?? null : null;
  const toSpec = (h: Highlight) => ({ translationCode: h.translationCode, bookCode: h.bookCode, chapter: h.chapter, startVerse: h.startVerse, endVerse: h.endVerse, startOffset: h.startOffset ?? null, endOffset: h.endOffset ?? null, color: h.color });

  const studyUnavailable = () => flash("Highlights, notes and saved passages are coming soon.");
  const failed = (e: unknown) => flash(e instanceof BibleApiError ? e.message : "That didn't save. Please try again.");

  // Highlights EXACTLY the selection; the same colour again removes it.
  // Every change can be undone once (the server returns what it replaced).
  async function onHighlight(color: HighlightColor) {
    if (!selRef) return;
    if (!my.available) return studyUnavailable();
    setBusy(true);
    try {
      if (selHighlight && selHighlight.color === color) {
        const r = await eraseHighlight(selRef, offsets);
        setUndo({ remove: r.pieces.map((p) => p.id), add: r.replaced.map(toSpec), label: "Highlight removed" });
      } else {
        const r = await addHighlight(selRef, color, offsets);
        setUndo({ remove: [r.id, ...r.pieces.map((p) => p.id)], add: r.replaced.map(toSpec), label: color === "underline" ? "Underlined" : "Highlighted" });
      }
      await loadMine();
      setRange(null); anchorRef.current = null;
    } catch (e) { failed(e); } finally { setBusy(false); }
  }
  async function onErase() {
    if (!selRef) return;
    setBusy(true);
    try {
      const r = await eraseHighlight(selRef, offsets);
      setUndo({ remove: r.pieces.map((p) => p.id), add: r.replaced.map(toSpec), label: "Highlight removed" });
      await loadMine(); setRange(null);
    } catch (e) { failed(e); } finally { setBusy(false); }
  }
  async function onUndo() {
    if (!undo) return;
    setBusy(true);
    try { await restoreHighlights(undo.remove, undo.add); setUndo(null); await loadMine(); flash("Undone"); }
    catch (e) { failed(e); } finally { setBusy(false); }
  }
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 8000); return () => clearTimeout(t); }, [undo]);
  async function onSave() {
    if (!selRef) return;
    if (!my.available) return studyUnavailable();
    setBusy(true);
    try {
      if (selBookmark) { await removeBookmark(selBookmark.id); flash("Removed from saved passages"); }
      else { await saveBookmark(selRef); flash("Saved to your library"); }
      await loadMine();
    } catch (e) { failed(e); } finally { setBusy(false); }
  }
  function selectedText() {
    if (!data || !range) return "";
    return rangeText(verseList, range);
  }
  // Verse text leaves the app only for translations whose licence allows it
  // (public domain); otherwise only the reference is copied/shared.
  const shareable = () => (data?.translation.textCopyAllowed ? `“${selectedText()}” — ${selLabel}` : selLabel);
  async function onCopy() {
    if (!sel) return;
    await Clipboard.setStringAsync(shareable());
    flash(data?.translation.textCopyAllowed ? "Copied" : "Reference copied");
  }
  async function onShare() {
    if (!sel) return;
    try { await Share.share({ message: shareable() }); } catch { /* dismissed */ }
  }
  function openNote(existing: BibleNote | null) {
    const ref = existing
      ? { translationCode: existing.translationCode, bookCode: existing.bookCode, chapter: existing.chapter, startVerse: existing.startVerse, endVerse: existing.endVerse }
      : selRef;
    if (!ref) return;
    if (!my.available) return studyUnavailable();
    setNoteError(null);
    setNoteEdit({ ref, label: existing ? existing.reference : selLabel, note: existing });
  }
  async function saveNote(title: string | null, body: string) {
    if (!noteEdit) return;
    setNoteSaving(true); setNoteError(null);
    try {
      if (noteEdit.note) await updateNote(noteEdit.note.id, title, body);
      else await addNote(noteEdit.ref, title, body);
      setNoteEdit(null); setRange(null);
      flash("Note saved");
      await loadMine();
    } catch (e) { setNoteError(e instanceof BibleApiError ? e.message : "Your note didn't save. Please try again."); }
    finally { setNoteSaving(false); }
  }
  async function removeNote() {
    if (!noteEdit?.note) return;
    setNoteSaving(true);
    try { await deleteNote(noteEdit.note.id); setNoteEdit(null); flash("Note deleted"); await loadMine(); }
    catch (e) { setNoteError(e instanceof BibleApiError ? e.message : "Couldn't delete the note."); }
    finally { setNoteSaving(false); }
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as any));

  // The group's passage in a live Gathering (Family or Church).
  const groupPassage = useMemo(() => {
    const p = gathering?.sharedPassage;
    if (!p) return null;
    const b = bookByName(p.book) ?? bookByCode(p.book);
    if (!b) return null;
    const label = formatRef(b, p.chapter, p.startVerse, p.endVerse);
    const here = loc?.book === b.code && loc?.chapter === p.chapter;
    const tAllowed = translations?.some((t) => t.code === p.translation);
    return { b, p, label, here, t: tAllowed ? p.translation : undefined };
  }, [gathering?.sharedPassage, loc?.book, loc?.chapter, translations]);

  // A run's look: highlight wash or underline, plus the selection wash.
  // Inline Text styles only — nothing that can change line layout.
  const selectionWash = withAlpha(c.accentGreen, resolvedMode === "dark" ? 0.32 : 0.2);
  const runStyle = (run: { color: string | null; selected: boolean }) => {
    const p = run.color ? (palette as Record<string, { wash: string; swatch: string }>)[run.color] ?? palette.gold : null;
    return [
      p && run.color !== "underline" ? { backgroundColor: p.wash } : null,
      run.color === "underline" ? { textDecorationLine: "underline" as const, textDecorationColor: p?.swatch } : null,
      run.selected ? { backgroundColor: selectionWash, textDecorationLine: "underline" as const, textDecorationStyle: "dotted" as const, textDecorationColor: c.accentGreen } : null,
    ];
  };

  const fontSize = prefs.fontSize;
  const lineHeight = Math.round(fontSize * LINE_HEIGHT[prefs.lineSpacing]);

  // ── Render ───────────────────────────────────────────────────────────────
  const header = !focus && (
    <View style={[styles.header, { paddingTop: gathering ? 4 : insets.top + 4 }]}>
      <TouchableOpacity onPress={goBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={c.textDark} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.titleBtn} onPress={() => setSheet("books")} disabled={!loc} accessibilityRole="button"
        accessibilityLabel={book ? `${book.name} chapter ${loc?.chapter}. Choose book and chapter` : "Choose book and chapter"}>
        <Text style={styles.titleText} numberOfLines={1}>{book ? `${book.name} ${loc?.chapter}` : "Bible"}</Text>
        <Ionicons name="chevron-down" size={16} color={c.textMid} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.trPill} onPress={() => setSheet("translations")} accessibilityRole="button"
        accessibilityLabel={`Translation ${translation?.name ?? loc?.t ?? ""}. Change translation`}>
        <Text style={styles.trPillText}>{loc?.t ?? "—"}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={() => router.push({ pathname: "/bible/search", params: { t: loc?.t ?? "" } } as any)}
        accessibilityRole="button" accessibilityLabel="Search the Bible">
        <Ionicons name="search" size={21} color={c.textDark} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={() => setSheet("menu")} accessibilityRole="button" accessibilityLabel="More options">
        <Ionicons name="ellipsis-horizontal" size={22} color={c.textDark} />
      </TouchableOpacity>
    </View>
  );

  let body: React.ReactNode;
  if (trError) {
    body = <StateMessage styles={styles} icon="cloud-offline-outline" title="The Bible couldn't load" message={trError} action="Try again" onAction={() => setTrAttempt((n) => n + 1)} c={c} />;
  } else if (translations && translations.length === 0) {
    body = <StateMessage styles={styles} icon="book-outline" title="No translations available" message="No Bible translation is licensed for P2P Global yet." c={c} />;
  } else if (error && !data) {
    body = <StateMessage styles={styles} icon={error.status === 0 ? "cloud-offline-outline" : "alert-circle-outline"} title="This chapter didn't load" message={error.message} action="Try again" onAction={() => setAttempt((n) => n + 1)} c={c} />;
  } else if (!data) {
    body = <View style={styles.center}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" /></View>;
  } else {
    body = (
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingTop: focus ? insets.top + 56 : 8, paddingBottom: (sel ? 200 : 40) + insets.bottom }]}>
        {error && <Text style={styles.inlineError}>{error.message}</Text>}
        <Text style={styles.chapterTitle} accessibilityRole="header">{data.book.name} {data.chapter}</Text>
        {blocks.map((blk) => (
          <View key={`${renderKey}-${blk.key}-${prefs.layout}`} onLayout={(e) => onBlockLayout(blk.verses[0].verse, blk.verses[blk.verses.length - 1].verse, e.nativeEvent.layout.y)}>
            {blk.headings.map((h, i) => <Text key={i} style={styles.heading} accessibilityRole="header">{h}</Text>)}
            <Text style={[styles.para, { fontSize, lineHeight }, blk.poetry && styles.poetry]}>
              {blk.verses.map((v) => {
                const h = hlByVerse.get(v.verse);
                const selected = !!sel && v.verse >= sel.start && v.verse <= sel.end;
                const runs = verseRuns(v.verse, v.text, my.highlights, range, lengthOf);
                const toks = textMode ? tokensOf.get(v.verse) ?? [] : [];
                return (
                  <Text key={v.verse} onPress={textMode ? undefined : () => tapVerse(v.verse)}
                    onLongPress={textMode ? undefined : () => chooseMode("word")} suppressHighlighting
                    // On the web a "button" role renders an inline-BLOCK element, which
                    // would put every verse on its own line; spans keep the text flowing
                    // as it does on phones (where nested Text is always inline).
                    accessibilityRole={textMode ? "text" : INLINE_BUTTON_ROLE} accessibilityState={{ selected }}
                    accessibilityLabel={textMode ? undefined : `Verse ${v.verse}${h ? `, highlighted ${(palette[h.color] ?? palette.gold).label}` : ""}${notedVerses.has(v.verse) ? ", has a note" : ""}`}>
                    {prefs.verseNumbers && <Text style={[styles.verseNum, { fontSize: Math.round(fontSize * 0.62) }]}>{v.verse}{"\u00A0"}</Text>}
                    {runs.map((run) => !textMode
                      ? <Text key={run.start} style={runStyle(run)}>{run.text}</Text>
                      : toks.filter((t) => t.end > run.start && t.start < run.end).map((t) => (
                        <Text key={`${run.start}-${t.start}`} style={runStyle(run)} suppressHighlighting
                          onPress={t.word ? () => tapWord(v.verse, t) : undefined}
                          accessibilityRole={t.word ? INLINE_BUTTON_ROLE : undefined} accessibilityLabel={t.word ? t.text : undefined}>
                          {v.text.slice(Math.max(t.start, run.start), Math.min(t.end, run.end))}
                        </Text>
                      )))}
                    {notedVerses.has(v.verse) && <Text style={[styles.noteMark, { fontSize: Math.round(fontSize * 0.7) }]}>{"\u00A0"}✎</Text>}
                    {" "}
                  </Text>
                );
              })}
            </Text>
          </View>
        ))}

        {my.notes.length > 0 && !focus && (
          <View style={styles.notesBox}>
            <Text style={styles.notesTitle}><Ionicons name="lock-closed" size={12} color={c.textMuted} /> Your notes in this chapter</Text>
            {my.notes.map((n) => (
              <TouchableOpacity key={n.id} style={styles.noteRow} onPress={() => openNote(n)} accessibilityRole="button" accessibilityLabel={`Note on ${n.reference}. Edit`}>
                <Text style={styles.noteRef}>{n.reference}</Text>
                {n.title ? <Text style={styles.noteTitle} numberOfLines={1}>{n.title}</Text> : null}
                <Text style={styles.noteBody} numberOfLines={3}>{n.body}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!focus && (
          <View style={styles.footer}>
            <View style={styles.navRow}>
              <TouchableOpacity style={[styles.navBtn, !data.previous && styles.navBtnOff]} disabled={!data.previous}
                onPress={() => data.previous && go(data.previous.bookCode, data.previous.chapter)} accessibilityRole="button"
                accessibilityLabel={data.previous ? `Previous chapter, ${formatRef(bookByCode(data.previous.bookCode), data.previous.chapter)}` : "No previous chapter"}>
                <Ionicons name="chevron-back" size={18} color={c.textDark} />
                <Text style={styles.navText} numberOfLines={1}>{data.previous ? formatRef(bookByCode(data.previous.bookCode), data.previous.chapter) : "Start"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.navBtn, styles.navBtnRight, !data.next && styles.navBtnOff]} disabled={!data.next}
                onPress={() => data.next && go(data.next.bookCode, data.next.chapter)} accessibilityRole="button"
                accessibilityLabel={data.next ? `Next chapter, ${formatRef(bookByCode(data.next.bookCode), data.next.chapter)}` : "No next chapter"}>
                <Text style={styles.navText} numberOfLines={1}>{data.next ? formatRef(bookByCode(data.next.bookCode), data.next.chapter) : "End"}</Text>
                <Ionicons name="chevron-forward" size={18} color={c.textDark} />
              </TouchableOpacity>
            </View>
            <Text style={styles.copyright}>{data.translation.name}{data.copyright ? `\n${data.copyright}` : ""}</Text>
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      {gathering && !focus ? <GatheringReturnBar topInset={insets.top} /> : null}
      {header}
      {!focus && groupPassage && !groupPassage.here && (
        <TouchableOpacity style={styles.groupChip} onPress={() => go(groupPassage.b.code, groupPassage.p.chapter, { v: groupPassage.p.startVerse, ve: groupPassage.p.endVerse, t: groupPassage.t })}
          accessibilityRole="button" accessibilityLabel={`Go to the group's passage, ${groupPassage.label}`}>
          <Ionicons name="people" size={15} color={c.accentGreen} />
          <Text style={styles.groupChipText} numberOfLines={1}>{gathering?.kind === "prayer" ? "Prayer passage" : "Group passage"}: {groupPassage.label}</Text>
          <Text style={styles.groupChipGo}>Go</Text>
        </TouchableOpacity>
      )}
      {loading && data ? <View style={styles.loadingBar}><ActivityIndicator size="small" color={c.accentGreen} /></View> : null}
      <View style={{ flex: 1 }}>{body}</View>

      {focus && (
        <TouchableOpacity style={[styles.exitFocus, { top: insets.top + 8 }]} onPress={() => setFocus(false)} accessibilityRole="button" accessibilityLabel="Exit focus mode">
          <Ionicons name="contract-outline" size={16} color={c.textDark} />
          <Text style={styles.exitFocusText}>{book ? `${book.name} ${loc?.chapter}` : "Exit focus"}</Text>
        </TouchableOpacity>
      )}

      {sel && data && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 10 }]} accessibilityRole="toolbar">
          <View style={styles.actionHead}>
            <Text style={styles.actionRef} numberOfLines={1}>{selLabel}</Text>
            {busy ? <ActivityIndicator size="small" color={c.accentGreen} /> : null}
            <TouchableOpacity onPress={() => { setRange(null); anchorRef.current = null; }} style={styles.iconBtnSm} accessibilityRole="button" accessibilityLabel="Clear selection">
              <Ionicons name="close" size={20} color={c.textMid} />
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeRow} accessibilityRole="radiogroup">
            {MODES.map((m) => (
              <TouchableOpacity key={m.key} style={[styles.modeChip, mode === m.key && styles.modeChipOn]} onPress={() => chooseMode(m.key)}
                accessibilityRole="radio" accessibilityState={{ selected: mode === m.key }} accessibilityLabel={`Select by ${m.label}`}>
                <Text style={[styles.modeText, mode === m.key && styles.modeTextOn]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {textMode && range ? (
            <View style={styles.nudgeRow}>
              <Text style={styles.nudgeLabel}>Start</Text>
              <TouchableOpacity style={styles.nudge} onPress={() => setRange(nudgeRange(verseList, range, "start", -1))} accessibilityRole="button" accessibilityLabel="Start one word earlier"><Ionicons name="chevron-back" size={16} color={c.textDark} /></TouchableOpacity>
              <TouchableOpacity style={styles.nudge} onPress={() => setRange(nudgeRange(verseList, range, "start", 1))} accessibilityRole="button" accessibilityLabel="Start one word later"><Ionicons name="chevron-forward" size={16} color={c.textDark} /></TouchableOpacity>
              <Text style={[styles.nudgeLabel, { marginLeft: 12 }]}>End</Text>
              <TouchableOpacity style={styles.nudge} onPress={() => setRange(nudgeRange(verseList, range, "end", -1))} accessibilityRole="button" accessibilityLabel="End one word earlier"><Ionicons name="chevron-back" size={16} color={c.textDark} /></TouchableOpacity>
              <TouchableOpacity style={styles.nudge} onPress={() => setRange(nudgeRange(verseList, range, "end", 1))} accessibilityRole="button" accessibilityLabel="End one word later"><Ionicons name="chevron-forward" size={16} color={c.textDark} /></TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.swatches}>
            {HIGHLIGHT_COLORS.map((col) => {
              const active = selHighlight?.color === col;
              return (
                <TouchableOpacity key={col} onPress={() => onHighlight(col)} disabled={busy} style={[styles.swatchHit]}
                  accessibilityRole="button" accessibilityState={{ selected: active }}
                  accessibilityLabel={active ? `Remove ${palette[col].label} highlight` : `Highlight ${palette[col].label}`}>
                  {col === "underline" ? (
                    <View style={[styles.swatch, styles.swatchClear, active && styles.swatchActive]}>
                      <Text style={[styles.underlineGlyph, { color: palette.underline.swatch }]}>U</Text>
                    </View>
                  ) : (
                    <View style={[styles.swatch, { backgroundColor: palette[col].swatch }, active && styles.swatchActive]}>
                      {active && <Ionicons name="close" size={14} color="#fff" />}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
            {!selHighlight && anyHighlightInSel && (
              <TouchableOpacity onPress={onErase} disabled={busy} style={styles.swatchHit} accessibilityRole="button" accessibilityLabel="Remove highlighting from the selected text">
                <View style={[styles.swatch, styles.swatchClear]}><Ionicons name="remove" size={16} color={c.textMid} /></View>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.actions}>
            <Action styles={styles} c={c} icon={selNote ? "create" : "create-outline"} label={selNote ? "Edit note" : "Note"} onPress={() => openNote(selNote)} />
            <Action styles={styles} c={c} icon={selBookmark ? "bookmark" : "bookmark-outline"} label={selBookmark ? "Saved" : "Save"} onPress={onSave} disabled={busy} />
            <Action styles={styles} c={c} icon="copy-outline" label="Copy" onPress={onCopy} />
            <Action styles={styles} c={c} icon={Platform.OS === "ios" ? "share-outline" : "share-social-outline"} label="Share" onPress={onShare} />
            <Action styles={styles} c={c} icon="school-outline" label="Lessons" onPress={() => setSheet("related")} />
          </View>
          {!my.available && <Text style={styles.soon}>Highlights, notes and saving are coming soon.</Text>}
        </View>
      )}

      {undo && !sel ? (
        <View style={[styles.undoBar, { bottom: 24 + insets.bottom }]} accessibilityLiveRegion="polite">
          <Text style={styles.undoText}>{undo.label}</Text>
          <TouchableOpacity onPress={onUndo} disabled={busy} accessibilityRole="button" accessibilityLabel="Undo"><Text style={styles.undoBtn}>Undo</Text></TouchableOpacity>
        </View>
      ) : null}
      {data && !sel && !undo && !focus && mode !== "verse" ? (
        <TouchableOpacity style={[styles.modePill, { bottom: 24 + insets.bottom }]} onPress={() => setModeSheet(true)} accessibilityRole="button" accessibilityLabel={`Selecting by ${MODES.find((m) => m.key === mode)!.label}. Change`}>
          <Ionicons name="text-outline" size={14} color={c.textDark} />
          <Text style={styles.modePillText}>{MODES.find((m) => m.key === mode)!.label}: {MODES.find((m) => m.key === mode)!.hint.toLowerCase()}</Text>
        </TouchableOpacity>
      ) : null}
      <Modal visible={modeSheet} transparent animationType="fade" onRequestClose={() => setModeSheet(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setModeSheet(false)} accessibilityLabel="Close">
          <View style={[styles.menu, { top: insets.top + 52 }]} accessibilityRole="radiogroup">
            {MODES.map((m) => (
              <TouchableOpacity key={m.key} style={styles.menuItem} onPress={() => chooseMode(m.key)} accessibilityRole="radio" accessibilityState={{ selected: mode === m.key }}>
                <Ionicons name={mode === m.key ? "radio-button-on" : "radio-button-off"} size={18} color={c.accentGreen} />
                <View style={{ flex: 1 }}><Text style={styles.menuText}>{m.label}</Text><Text style={styles.modeHint}>{m.hint}</Text></View>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {toast && (
        <View style={[styles.toast, { bottom: (sel ? 190 : 24) + insets.bottom }]} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Overflow menu */}
      <Modal visible={sheet === "menu"} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setSheet(null)} accessibilityLabel="Close menu">
          <View style={[styles.menu, { top: insets.top + 52 }]}>
            <MenuItem styles={styles} c={c} icon="library-outline" label="My notes & highlights" onPress={() => { setSheet(null); router.push("/bible/library" as any); }} />
            <MenuItem styles={styles} c={c} icon="school-outline" label="Lessons on this chapter" onPress={() => setSheet("related")} />
            <MenuItem styles={styles} c={c} icon="text-outline" label="Reading settings" onPress={() => setSheet("prefs")} />
            <MenuItem styles={styles} c={c} icon="color-wand-outline" label={`Select by: ${MODES.find((m) => m.key === mode)!.label}`} onPress={() => { setSheet(null); setModeSheet(true); }} />
            <MenuItem styles={styles} c={c} icon="expand-outline" label="Focus mode" onPress={() => { setSheet(null); setRange(null); setFocus(true); }} />
          </View>
        </TouchableOpacity>
      </Modal>

      <BookChapterPicker visible={sheet === "books"} onClose={() => setSheet(null)} currentBook={loc?.book ?? "JHN"} currentChapter={loc?.chapter ?? 1}
        onSelect={(b, ch) => go(b, ch)} />
      <TranslationPicker visible={sheet === "translations"} onClose={() => setSheet(null)} translations={translations ?? []} current={loc?.t ?? ""}
        error={trError} onRetry={() => setTrAttempt((n) => n + 1)}
        onSelect={(t) => { setSheet(null); if (loc && t !== loc.t) setLoc({ ...loc, t, v: sel?.start, ve: sel?.end }); }} />
      <ReadingPrefsSheet visible={sheet === "prefs"} prefs={prefs} onChange={updatePrefs} onClose={() => setSheet(null)} />
      {book && loc && (
        <RelatedLessonsSheet visible={sheet === "related"} book={book.code} bookName={book.name} chapter={loc.chapter} onClose={() => setSheet(null)}
          onOpenLesson={(id) => { setSheet(null); router.push({ pathname: "/lesson/[id]", params: { id } } as any); }} />
      )}
      <BibleNoteSheet visible={!!noteEdit} reference={noteEdit?.label ?? ""} initial={noteEdit?.note ? { title: noteEdit.note.title, body: noteEdit.note.body } : null}
        saving={noteSaving} error={noteError} onClose={() => setNoteEdit(null)} onSave={saveNote} onDelete={noteEdit?.note ? removeNote : undefined} />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Action({ styles, c, icon, label, onPress, disabled }: { styles: Styles; c: AppColors; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={21} color={c.textDark} />
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function MenuItem({ styles, c, icon, label, onPress }: { styles: Styles; c: AppColors; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} accessibilityRole="menuitem" accessibilityLabel={label}>
      <Ionicons name={icon} size={19} color={c.textMid} />
      <Text style={styles.menuText}>{label}</Text>
    </TouchableOpacity>
  );
}

function StateMessage({ styles, c, icon, title, message, action, onAction }: { styles: Styles; c: AppColors; icon: keyof typeof Ionicons.glyphMap; title: string; message: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={40} color={c.textMuted} />
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMsg}>{message}</Text>
      {action && onAction && (
        <TouchableOpacity style={styles.stateBtn} onPress={onAction} accessibilityRole="button"><Text style={styles.stateBtnText}>{action}</Text></TouchableOpacity>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingBottom: 6, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    iconBtnSm: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    titleBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: 6 },
    titleText: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold", flexShrink: 1 },
    trPill: { minHeight: 32, minWidth: 44, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, alignItems: "center", justifyContent: "center", marginHorizontal: 2 },
    trPillText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_700Bold" },
    groupChip: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 8, paddingHorizontal: 12, minHeight: 44, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    groupChipText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium" },
    groupChipGo: { fontSize: 14, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    loadingBar: { position: "absolute", alignSelf: "center", top: 120, zIndex: 2 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
    stateTitle: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    stateMsg: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    stateBtn: { marginTop: 6, minHeight: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    stateBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    inlineError: { color: "#DC2626", fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 8 },
    scroll: { paddingHorizontal: 22, maxWidth: 720, width: "100%", alignSelf: "center" },
    chapterTitle: { fontSize: 28, color: c.textDark, fontFamily: SCRIPTURE_FONT, marginTop: 12, marginBottom: 14 },
    heading: { fontSize: 14, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 14, marginBottom: 6, letterSpacing: 0.2 },
    para: { color: c.textDark, fontFamily: SCRIPTURE_FONT, marginBottom: 12 },
    poetry: { paddingLeft: 14 },
    verseNum: { color: c.accentGreen, fontFamily: "Inter_700Bold" },
    noteMark: { color: c.amber },
    selected: { textDecorationLine: "underline", textDecorationStyle: "dotted", textDecorationColor: c.accentGreen },
    notesBox: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, gap: 10 },
    notesTitle: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    noteRow: { minHeight: 44, gap: 2 },
    noteRef: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    noteTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    noteBody: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    footer: { marginTop: 24, gap: 16 },
    navRow: { flexDirection: "row", gap: 10 },
    navBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    navBtnRight: { justifyContent: "flex-end" },
    navBtnOff: { opacity: 0.4 },
    navText: { flexShrink: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    copyright: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16 },
    exitFocus: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    exitFocusText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    actionBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: c.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: 1, borderColor: c.borderBeige, paddingHorizontal: 14, paddingTop: 8, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 10 },
    actionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    actionRef: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    swatches: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
    swatchHit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    swatch: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
    swatchActive: { borderWidth: 2, borderColor: c.textDark },
    swatchClear: { borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.lightCream },
    actions: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
    action: { flex: 1, alignItems: "center", gap: 3, minHeight: 52, justifyContent: "center" },
    actionText: { fontSize: 11, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    modeRow: { gap: 6, paddingVertical: 4 },
    modeChip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, justifyContent: "center" },
    modeChipOn: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    modeText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    modeTextOn: { color: "#fff" },
    modeHint: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    nudgeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
    nudgeLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    nudge: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    underlineGlyph: { fontSize: 15, fontFamily: "Inter_700Bold", textDecorationLine: "underline" },
    undoBar: { position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 48, borderRadius: 24, backgroundColor: c.textDark },
    undoText: { flex: 1, color: c.lightCream, fontSize: 14, fontFamily: "Inter_600SemiBold" },
    undoBtn: { color: c.accentGreen, fontSize: 15, fontFamily: "Inter_700Bold", paddingVertical: 10 },
    modePill: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    modePillText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    soon: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
    toast: { position: "absolute", alignSelf: "center", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: c.textDark },
    toastText: { color: c.lightCream, fontSize: 14, fontFamily: "Inter_600SemiBold" },
    menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.2)" },
    menu: { position: "absolute", right: 10, minWidth: 240, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, paddingVertical: 6, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 14, elevation: 12 },
    menuItem: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 16 },
    menuText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
  });
}
