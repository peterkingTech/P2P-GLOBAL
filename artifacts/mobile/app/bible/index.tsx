import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Share, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  getMyChapter, getTranslations, highlightPalette, removeBookmark, removeHighlight, saveBookmark, updateNote,
  type BibleChapter, type BibleNote, type BibleTranslation, type Bookmark, type Highlight, type HighlightColor, type NewRef,
} from "@/lib/bibleReaderApi";
import { LINE_HEIGHT, loadPosition, savePosition, useBibleReadingPrefs } from "@/lib/bibleReadingPrefs";

// The P2P Bible reader. Scripture comes from the server (licensed API.Bible
// translations only, never stored in our database); highlights, notes and
// saved passages are the reader's own and private. Colours always come from
// the P2P theme. Opening this from a Gathering pushes it ON TOP of the call
// screen, so the call keeps running; the Return bar goes back to it.

type Params = { book?: string; chapter?: string; v?: string; ve?: string; t?: string };
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

  const [translations, setTranslations] = useState<BibleTranslation[] | null>(null);
  const [trError, setTrError] = useState<string | null>(null);
  const [trAttempt, setTrAttempt] = useState(0);
  const [loc, setLoc] = useState<{ t: string; book: string; chapter: number; v?: number; ve?: number } | null>(null);
  const [data, setData] = useState<BibleChapter | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [my, setMy] = useState<MyData>(EMPTY_MY);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
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
    setLoading(true); setError(null); setSel(null);
    blockY.current.clear();
    getChapter(loc.book, loc.chapter, loc.t, ac.signal)
      .then((ch) => {
        if (id !== reqId.current) return;
        setData(ch);
        savePosition({ translation: loc.t, book: loc.book, chapter: loc.chapter });
        if (loc.v) setSel({ start: loc.v, end: loc.ve ?? loc.v });
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
  const tapVerse = (v: number) => {
    setSel((s) => {
      if (!s) return { start: v, end: v };
      if (s.start === v && s.end === v) return null;
      if (v >= s.start && v <= s.end) return { start: v, end: v };
      return { start: Math.min(s.start, v), end: Math.max(s.end, v) };
    });
  };
  const selRef: NewRef | null = loc && sel ? { translationCode: loc.t, bookCode: loc.book, chapter: loc.chapter, startVerse: sel.start, endVerse: sel.end } : null;
  const selLabel = sel && book ? `${formatRef(book, loc!.chapter, sel.start, sel.end)} (${loc!.t})` : "";
  const selHighlight = sel ? (() => {
    const h = hlByVerse.get(sel.start);
    return h && h.startVerse === sel.start && h.endVerse === sel.end ? h : null;
  })() : null;
  const selBookmark = sel ? my.bookmarks.find((b) => b.startVerse === sel.start && b.endVerse === sel.end) ?? null : null;
  const selNote = sel ? my.notes.find((n) => n.startVerse === sel.start && n.endVerse === sel.end) ?? null : null;

  const studyUnavailable = () => flash("Highlights, notes and saved passages are coming soon.");
  const failed = (e: unknown) => flash(e instanceof BibleApiError ? e.message : "That didn't save. Please try again.");

  async function onHighlight(color: HighlightColor) {
    if (!selRef) return;
    if (!my.available) return studyUnavailable();
    setBusy(true);
    try {
      if (selHighlight && selHighlight.color === color) { await removeHighlight(selHighlight.id); flash("Highlight removed"); }
      else { await addHighlight(selRef, color); }
      await loadMine();
      setSel(null);
    } catch (e) { failed(e); } finally { setBusy(false); }
  }
  async function onRemoveHighlightsInSelection() {
    if (!sel) return;
    const ids = new Set<string>();
    for (let v = sel.start; v <= sel.end; v++) { const h = hlByVerse.get(v); if (h) ids.add(h.id); }
    setBusy(true);
    try { for (const id of ids) await removeHighlight(id); await loadMine(); setSel(null); flash("Highlight removed"); }
    catch (e) { failed(e); } finally { setBusy(false); }
  }
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
    if (!data || !sel) return "";
    return data.verses.filter((v) => v.verse >= sel.start && v.verse <= sel.end).map((v) => v.text.replace(/\n/g, " ")).join(" ").trim();
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
      setNoteEdit(null); setSel(null);
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
                return (
                  <Text key={v.verse} onPress={() => tapVerse(v.verse)} suppressHighlighting
                    style={[h && { backgroundColor: palette[h.color].wash }, selected && styles.selected]}
                    accessibilityRole="button" accessibilityState={{ selected }}
                    accessibilityLabel={`Verse ${v.verse}${h ? `, highlighted ${palette[h.color].label}` : ""}${notedVerses.has(v.verse) ? ", has a note" : ""}`}>
                    {prefs.verseNumbers && <Text style={[styles.verseNum, { fontSize: Math.round(fontSize * 0.62) }]}>{v.verse}{" "}</Text>}
                    {v.text}
                    {notedVerses.has(v.verse) && <Text style={[styles.noteMark, { fontSize: Math.round(fontSize * 0.7) }]}>{" "}✎</Text>}
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
          <Text style={styles.groupChipText} numberOfLines={1}>Group passage: {groupPassage.label}</Text>
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
            <TouchableOpacity onPress={() => setSel(null)} style={styles.iconBtnSm} accessibilityRole="button" accessibilityLabel="Clear selection">
              <Ionicons name="close" size={20} color={c.textMid} />
            </TouchableOpacity>
          </View>
          <View style={styles.swatches}>
            {HIGHLIGHT_COLORS.map((col) => {
              const active = selHighlight?.color === col;
              return (
                <TouchableOpacity key={col} onPress={() => onHighlight(col)} disabled={busy} style={[styles.swatchHit]}
                  accessibilityRole="button" accessibilityState={{ selected: active }}
                  accessibilityLabel={active ? `Remove ${palette[col].label} highlight` : `Highlight ${palette[col].label}`}>
                  <View style={[styles.swatch, { backgroundColor: palette[col].swatch }, active && styles.swatchActive]}>
                    {active && <Ionicons name="close" size={14} color="#fff" />}
                  </View>
                </TouchableOpacity>
              );
            })}
            {!selHighlight && sel && Array.from({ length: sel.end - sel.start + 1 }, (_, i) => sel.start + i).some((v) => hlByVerse.has(v)) && (
              <TouchableOpacity onPress={onRemoveHighlightsInSelection} disabled={busy} style={styles.swatchHit} accessibilityRole="button" accessibilityLabel="Remove highlight">
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
            <MenuItem styles={styles} c={c} icon="expand-outline" label="Focus mode" onPress={() => { setSheet(null); setSel(null); setFocus(true); }} />
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
    soon: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
    toast: { position: "absolute", alignSelf: "center", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: c.textDark },
    toastText: { color: c.lightCream, fontSize: 14, fontFamily: "Inter_600SemiBold" },
    menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.2)" },
    menu: { position: "absolute", right: 10, minWidth: 240, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, paddingVertical: 6, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 14, elevation: 12 },
    menuItem: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 16 },
    menuText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
  });
}
