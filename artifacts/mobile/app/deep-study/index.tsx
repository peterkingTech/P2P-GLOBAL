import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { Attribution, OriginalText, SectionTitle, StudyState } from "@/components/study/StudyUI";
import { CANON, SCRIPTURE_FONT, bibleRoute, bookByCode, formatRef, getChapter, readerTarget, type BibleChapter } from "@/lib/bibleReaderApi";
import { loadPosition } from "@/lib/bibleReadingPrefs";
import {
  compareCommentaries, crossReferences, interlinear, languageName, peoplePlaces,
  type CompareResult, type CrossRefs, type Interlinear, type InterlinearWord, type PeoplePlaces,
} from "@/lib/deepStudyApi";

// DEEP STUDY — one passage, studied from every side without losing it: the original-language words
// (tap a word → its lexicon entry), commentaries side by side, cross references, and the people, places
// and events in it. Opened from a selection in the Bible reader (?book&chapter&v&ve&t — the reader stays
// exactly where it was underneath), or here by typing a reference. The passage stays at the top;
// moving between tabs never changes it. Data: lib/deepStudyApi (reviewed AO Lab resources only).
type Tab = "original" | "commentaries" | "xref" | "people";

export default function DeepStudyScreen() {
  const p = useLocalSearchParams<{ book?: string; chapter?: string; v?: string; ve?: string; t?: string; tab?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const book = p.book ? bookByCode(String(p.book)) : undefined;
  const chapter = Number(p.chapter) || 0;
  const from = Number(p.v) || null, to = Number(p.ve) || from;
  const [tab, setTab] = useState<Tab>(p.tab === "commentaries" || p.tab === "xref" || p.tab === "people" ? p.tab : "original");
  const [translation, setTranslation] = useState<string | null>(p.t ? String(p.t) : null);
  useEffect(() => { if (!p.t) loadPosition().then((pos) => setTranslation(pos?.translation ?? null)); }, [p.t]);

  // No passage yet: choose one.
  if (!book || !chapter || chapter > book.chapters) return <PassagePicker tab={p.tab} />;

  const label = formatRef(book, chapter, from, to);
  const go = (next: { book: string; chapter: number; v?: number; ve?: number }) =>
    router.push({ pathname: "/deep-study", params: { book: next.book, chapter: String(next.chapter), ...(next.v ? { v: String(next.v), ve: String(next.ve ?? next.v) } : {}), ...(translation ? { t: translation } : {}), tab } } as any);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>{t("deepStudy.title", { defaultValue: "Deep Study" })}</Text>
          <Text style={s.title} numberOfLines={1} accessibilityRole="header">{label}</Text>
        </View>
        <IconButton icon="book-outline" accessibilityLabel={t("deepStudy.openInBible", { defaultValue: "Open in the Bible" })}
          onPress={() => router.push(bibleRoute({ book: book.code, chapter, v: from ?? undefined, ve: to ?? undefined, translation }) as any)} color={c.textDark} />
        <IconButton icon="swap-horizontal" accessibilityLabel={t("deepStudy.changePassage", { defaultValue: "Change passage" })} onPress={() => router.push({ pathname: "/deep-study", params: { tab } } as any)} color={c.textDark} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <PassageText book={book.code} chapter={chapter} from={from} to={to} translation={translation} />
        <ChipRow accessibilityLabel={t("deepStudy.studyBy", { defaultValue: "Study by" })} single>
          {([["original", t("deepStudy.tabOriginal", { defaultValue: "Original language" })], ["commentaries", t("deepStudy.tabCommentaries", { defaultValue: "Commentaries" })],
            ["xref", t("deepStudy.tabCrossRefs", { defaultValue: "Cross references" })], ["people", t("deepStudy.tabPeople", { defaultValue: "People & places" })]] as [Tab, string][]).map(([k, l]) => (
            <FilterChip key={k} label={l} selected={tab === k} selection="single" onPress={() => setTab(k)} />
          ))}
        </ChipRow>
        {tab === "original" ? <OriginalTab book={book.code} chapter={chapter} from={from} to={to} translation={translation} /> : null}
        {tab === "commentaries" ? <CommentariesTab book={book.code} chapter={chapter} from={from} to={to} /> : null}
        {tab === "xref" ? <CrossRefTab book={book.code} chapter={chapter} from={from} to={to} onOpen={go} /> : null}
        {tab === "people" ? <PeopleTab book={book.code} chapter={chapter} from={from} to={to} /> : null}
      </ScrollView>
    </View>
  );
}

// ── The passage itself (in the reader's translation, from the existing licensed Bible service) ──────
function PassageText({ book, chapter, from, to, translation }: { book: string; chapter: number; from: number | null; to: number | null; translation: string | null }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [ch, setCh] = useState<BibleChapter | null>(null);
  const [error, setError] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!translation) return;
    setError(false);
    getChapter(book, chapter, translation).then(setCh, () => setError(true));
  }, [book, chapter, translation]);
  if (!translation || error) return null;   // the study still works without the passage text
  if (!ch) return <View style={s.passage}><StudyState loading /></View>;
  const verses = ch.verses.filter((v) => (from ? v.verse >= from && v.verse <= (to ?? from) : true));
  const shown = all || from ? verses : verses.slice(0, 6);
  return (
    <View style={s.passage}>
      <Text style={[s.passageText, { writingDirection: ch.translation.textDirection ?? "ltr" }]}>
        {shown.map((v) => <Text key={v.verse}><Text style={s.verseNum}>{v.verse} </Text>{v.text} </Text>)}
      </Text>
      {!from && verses.length > shown.length ? <AppButton label={t("deepStudy.showWholeChapter", { defaultValue: "Show the whole chapter" })} variant="tertiary" size="sm" onPress={() => setAll(true)} /> : null}
      <Text style={s.small}>{ch.translation.name}</Text>
    </View>
  );
}

// ── Original language ────────────────────────────────────────────────────────
function OriginalTab({ book, chapter, from, to, translation }: { book: string; chapter: number; from: number | null; to: number | null; translation: string | null }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<Interlinear | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<InterlinearWord | null>(null);
  const load = useCallback(() => { setError(null); setD(null); interlinear(book, chapter, from, to).then(setD, (e) => setError(e?.message ?? "Couldn't load the original language.")); }, [book, chapter, from, to]);
  useEffect(load, [load]);
  if (!d || error) return <StudyState loading={!d && !error} error={error} onRetry={load} />;
  const missing = d.versesWithoutWords?.length ? (
    <View style={s.card}>
      <Text style={s.verseLabel}>{d.versesWithoutWords.map((v) => `${chapter}:${v}`).join(", ")}</Text>
      {d.missingNote ? <Text style={s.small}>{d.missingNote}</Text> : null}
    </View>
  ) : null;
  if (!d.available) return (
    <View style={{ gap: 10 }}>
      <StudyState empty={t("deepStudy.noOriginal", { defaultValue: "The original-language text isn't available for this passage." })} />
      {missing}
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      <StudyState offline={d.offline} />
      {missing}
      {d.verses.map((v) => (
        <View key={v.verse} style={s.card}>
          <Text style={s.verseLabel}>{chapter}:{v.verse} · {languageName(v.words[0]?.language)}</Text>
          <View style={[s.words, { flexDirection: v.direction === "rtl" ? "row-reverse" : "row" }]}>
            {v.words.map((w) => (
              <TouchableOpacity key={w.id} style={[s.word, picked?.id === w.id && s.wordOn]} onPress={() => setPicked(picked?.id === w.id ? null : w)}
                accessibilityRole="button" accessibilityLabel={`${w.transliteration ?? w.text}, ${w.gloss ?? t("deepStudy.noGloss", { defaultValue: "not translated separately" })}${w.strongs ? `, ${w.strongs}` : ""}`}>
                <OriginalText text={w.text} direction={v.direction} size={21} />
                {w.transliteration ? <Text style={s.wTranslit}>{w.transliteration}</Text> : null}
                <Text style={s.wGloss} numberOfLines={2}>{w.gloss ?? "—"}</Text>
                {w.strongs ? <Text style={s.wStrongs}>{w.strongs}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
          {picked && v.words.some((w) => w.id === picked.id) ? (
            <View style={s.detail}>
              <OriginalText text={picked.text} direction={v.direction} size={26} />
              {picked.transliteration ? <Text style={s.wTranslitBig}>{picked.transliteration}</Text> : null}
              <Text style={s.detailRow}><Text style={s.detailKey}>{t("deepStudy.gloss", { defaultValue: "Gloss" })}: </Text>{picked.gloss ?? t("deepStudy.noGlossLong", { defaultValue: "— (not translated as a separate English word)" })}</Text>
              {picked.parsingFull ? <Text style={s.detailRow}><Text style={s.detailKey}>{t("deepStudy.parsing", { defaultValue: "Grammar" })}: </Text>{picked.parsingFull}</Text> : null}
              {picked.strongs ? <Text style={s.detailRow}><Text style={s.detailKey}>Strong's: </Text>{picked.strongs}</Text> : null}
              <Text style={s.small}>{t("deepStudy.glossNote", { defaultValue: "A gloss is a short English rendering, not a full translation of the word." })}</Text>
              {picked.strongs ? (
                <AppButton label={t("deepStudy.openLexicon", { defaultValue: "Lexicon entry" })} icon="book-outline" size="sm"
                  onPress={() => router.push({ pathname: "/study-tools/word/[strongs]", params: { strongs: picked.strongs!, book, chapter: String(chapter), t: translation ?? "" } } as any)} />
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
      {d.alignment ? <Text style={s.small}>{d.alignment}</Text> : null}
      <Attribution credit={d.credit} />
    </View>
  );
}

// ── Commentaries side by side ────────────────────────────────────────────────
function CommentariesTab({ book, chapter, from, to }: { book: string; chapter: number; from: number | null; to: number | null }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<{ commentaries: CompareResult[]; offline?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const load = useCallback(() => { setError(null); setD(null); compareCommentaries(book, chapter, from, to).then((r) => { setD(r); setOpen(r.commentaries.filter((x) => x.status === "ok").slice(0, 2).map((x) => x.id)); }, (e) => setError(e?.message ?? "Couldn't load the commentaries.")); }, [book, chapter, from, to]);
  useEffect(load, [load]);
  if (!d || error) return <StudyState loading={!d && !error} error={error} onRetry={load} />;
  const label = (r: CompareResult) => r.status === "ok" ? null : r.status === "no_entry" ? t("deepStudy.noEntry", { defaultValue: "No note on these verses." })
    : r.status === "not_covered" ? t("deepStudy.notCovered", { defaultValue: "Doesn't cover this book or chapter." }) : (r.error ?? t("deepStudy.unavailable", { defaultValue: "Unavailable right now." }));
  const ordered = [...d.commentaries].sort((a, b) => Number(b.status === "ok") - Number(a.status === "ok"));
  return (
    <View style={{ gap: 10 }}>
      <StudyState offline={d.offline} />
      <Text style={s.small}>{t("deepStudy.commentaryNote", { defaultValue: "Historical commentaries and study notes, shown as published (in English). They are their authors' views, not P2P Global teaching." })}</Text>
      {ordered.map((r) => {
        const isOpen = open.includes(r.id);
        return (
          <View key={r.id} style={[s.card, r.status !== "ok" && { opacity: 0.75 }]}>
            <TouchableOpacity style={s.cHead} disabled={r.status !== "ok"} onPress={() => setOpen((o) => (isOpen ? o.filter((x) => x !== r.id) : [...o, r.id]))}
              accessibilityRole="button" accessibilityState={{ expanded: isOpen, disabled: r.status !== "ok" }}>
              <View style={{ flex: 1 }}>
                <Text style={s.cName}>{r.name}</Text>
                <Text style={s.small}>{r.author} · {r.language}</Text>
                {label(r) ? <Text style={s.cStatus}>{label(r)}</Text> : null}
              </View>
              {r.status === "ok" ? <IconButton icon={isOpen ? "chevron-up" : "chevron-down"} size="sm" accessibilityLabel={isOpen ? "Close" : "Open"} onPress={() => setOpen((o) => (isOpen ? o.filter((x) => x !== r.id) : [...o, r.id]))} color={c.textMid} /> : null}
            </TouchableOpacity>
            {isOpen ? (
              <View style={{ gap: 8, marginTop: 6 }}>
                {r.introduction ? (
                  <View style={{ gap: 4 }}>
                    <SectionTitle>{t("deepStudy.chapterIntro", { defaultValue: "Chapter introduction" })}</SectionTitle>
                    {r.introduction.split(/\n{2,}/).map((para, i) => para.trim() ? <Text key={i} style={[s.cText, { writingDirection: r.direction }]}>{para.trim()}</Text> : null)}
                  </View>
                ) : null}
                {r.sections.map((sec) => (
                  <View key={sec.start} style={{ gap: 4 }}>
                    <SectionTitle>{chapter}:{sec.start}{sec.end && sec.end > sec.start ? `–${sec.end}` : ""}</SectionTitle>
                    {sec.paragraphs.map((para, i) => <Text key={i} style={[s.cText, { writingDirection: r.direction }]}>{para}</Text>)}
                  </View>
                ))}
                <AppButton label={t("deepStudy.openInCommentaries", { defaultValue: "Read the whole chapter in Commentaries" })} variant="tertiary" size="sm"
                  onPress={() => router.push({ pathname: "/commentaries/read", params: { id: r.id, book, chapter: String(chapter) } } as any)} />
                <Attribution credit={r.credit} compact />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ── Cross references ─────────────────────────────────────────────────────────
function CrossRefTab({ book, chapter, from, to, onOpen }: { book: string; chapter: number; from: number | null; to: number | null; onOpen: (r: { book: string; chapter: number; v?: number; ve?: number }) => void }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<CrossRefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); setD(null); crossReferences(book, chapter, from ?? 1, to ?? (from ? from : 200)).then(setD, (e) => setError(e?.message ?? "Couldn't load cross references.")); }, [book, chapter, from, to]);
  useEffect(load, [load]);
  if (!d || error) return <StudyState loading={!d && !error} error={error} onRetry={load} />;
  if (!d.verses.length) return <StudyState empty={t("deepStudy.noCrossRefs", { defaultValue: "No cross references for this passage." })} />;
  return (
    <View style={{ gap: 10 }}>
      <StudyState offline={d.offline} />
      {d.verses.map((v) => (
        <View key={v.verse} style={s.card}>
          <Text style={s.verseLabel}>{chapter}:{v.verse} · {t("deepStudy.crossRefCount", { defaultValue: "{{n}} references", n: v.total })}</Text>
          {v.references.map((r, i) => {
            const b = bookByCode(r.book);
            return (
              <TouchableOpacity key={i} style={s.xref} accessibilityRole="button" onPress={() => onOpen({ book: r.book, chapter: r.chapter, v: r.verse, ve: r.endVerse ?? r.verse })}>
                <Text style={s.xrefText}>{b ? formatRef(b, r.chapter, r.verse, r.endVerse) : `${r.book} ${r.chapter}:${r.verse}`}</Text>
                {r.score != null ? <Text style={s.small}>{t("deepStudy.votes", { defaultValue: "{{n}} votes", n: r.score })}</Text> : null}
              </TouchableOpacity>
            );
          })}
          {v.total > v.references.length ? <Text style={s.small}>{t("deepStudy.topShown", { defaultValue: "The {{n}} most helpful are shown.", n: v.references.length })}</Text> : null}
        </View>
      ))}
      <Attribution credit={d.credit} />
    </View>
  );
}

// ── People, places, events ───────────────────────────────────────────────────
function PeopleTab({ book, chapter, from, to }: { book: string; chapter: number; from: number | null; to: number | null }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<PeoplePlaces | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); setD(null); peoplePlaces(book, chapter, from ?? 1, to ?? (from ? from : 200)).then(setD, (e) => setError(e?.message ?? "Couldn't load people and places.")); }, [book, chapter, from, to]);
  useEffect(load, [load]);
  if (!d || error) return <StudyState loading={!d && !error} error={error} onRetry={load} />;
  if (!d.items.length) return <StudyState empty={t("deepStudy.noPeople", { defaultValue: "No people, places or events are recorded for this passage." })} />;
  const groups: [string, string][] = [["person", t("deepStudy.people", { defaultValue: "People" })], ["place", t("deepStudy.places", { defaultValue: "Places" })], ["event", t("deepStudy.events", { defaultValue: "Events" })]];
  return (
    <View style={{ gap: 10 }}>
      <StudyState offline={d.offline} />
      {groups.map(([k, l]) => {
        const items = d.items.filter((i) => i.kind === k);
        return items.length ? (
          <View key={k} style={s.card}>
            <SectionTitle>{l}</SectionTitle>
            {items.map((i) => (
              <View key={i.id} style={s.xref}>
                <Text style={s.xrefText}>{i.name}{i.detail ? <Text style={s.small}>  · {i.detail}</Text> : null}</Text>
                <Text style={s.small}>{chapter}:{i.verses.join(", ")}</Text>
              </View>
            ))}
          </View>
        ) : null;
      })}
      <Attribution credit={d.credit} />
    </View>
  );
}

// ── Choosing a passage ───────────────────────────────────────────────────────
function PassagePicker({ tab }: { tab?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [q, setQ] = useState("");
  const [bookCode, setBookCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ book: string; chapter: number; translation: string } | null>(null);
  useEffect(() => { loadPosition().then((pos) => pos && setLast(pos)); }, []);
  const open = (r: { book: string; chapter: number; v?: number; ve?: number }) =>
    router.replace({ pathname: "/deep-study", params: { book: r.book, chapter: String(r.chapter), ...(r.v ? { v: String(r.v), ve: String(r.ve ?? r.v) } : {}), ...(last?.translation ? { t: last.translation } : {}), ...(tab ? { tab } : {}) } } as any);
  const submit = () => {
    const r = readerTarget(q);
    if (!r) { setError(t("deepStudy.refNotFound", { defaultValue: "Type a book and chapter, for example John 1 or Genesis 1:1." })); return; }
    setError(null); open(r);
  };
  const b = bookCode ? bookByCode(bookCode) : null;
  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => (b ? setBookCode(null) : router.back())} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{b ? b.name : t("deepStudy.title", { defaultValue: "Deep Study" })}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {!b ? (
          <>
            <Text style={s.lead}>{t("deepStudy.lead", { defaultValue: "Study a passage in its original language, with commentaries, cross references, and the people and places in it." })}</Text>
            <View style={s.searchRow}>
              <TextInput value={q} onChangeText={setQ} onSubmitEditing={submit} returnKeyType="go" placeholder={t("deepStudy.refPlaceholder", { defaultValue: "Book, chapter or verse — e.g. John 1:1" })}
                placeholderTextColor={c.textMuted} style={s.input} autoCorrect={false} accessibilityLabel={t("deepStudy.findPassage", { defaultValue: "Find a passage" })} />
              <AppButton label={t("deepStudy.study", { defaultValue: "Study" })} size="sm" onPress={submit} disabled={!q.trim()} />
            </View>
            {error ? <Text style={s.cStatus} accessibilityLiveRegion="polite">{error}</Text> : null}
            {last ? <AppButton label={`${t("deepStudy.continueWith", { defaultValue: "Continue with" })} ${formatRef(bookByCode(last.book), last.chapter)}`} icon="bookmark-outline" variant="secondary" onPress={() => open({ book: last.book, chapter: last.chapter })} /> : null}
            {(["OT", "NT"] as const).map((tm) => (
              <View key={tm} style={{ gap: 6 }}>
                <SectionTitle>{tm === "OT" ? t("deepStudy.ot", { defaultValue: "Old Testament" }) : t("deepStudy.nt", { defaultValue: "New Testament" })}</SectionTitle>
                <View style={s.grid}>
                  {CANON.filter((x) => x.testament === tm).map((x) => (
                    <TouchableOpacity key={x.code} style={s.bookBtn} onPress={() => setBookCode(x.code)} accessibilityRole="button"><Text style={s.bookText} numberOfLines={1}>{x.name}</Text></TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </>
        ) : (
          <View style={s.grid}>
            {Array.from({ length: b.chapters }, (_, i) => i + 1).map((n) => (
              <TouchableOpacity key={n} style={s.chapterBtn} onPress={() => open({ book: b.code, chapter: n })} accessibilityRole="button" accessibilityLabel={`${b.name} ${n}`}>
                <Text style={s.bookText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 8, paddingBottom: 6 },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.4, textTransform: "uppercase" },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    lead: { fontSize: 14.5, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 21 },
    passage: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    passageText: { fontSize: 16.5, lineHeight: 26, color: c.textDark, fontFamily: SCRIPTURE_FONT },
    verseNum: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    small: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    card: { padding: 12, gap: 8, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    verseLabel: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold" },
    words: { flexWrap: "wrap", gap: 6 },
    word: { minWidth: 64, maxWidth: 150, padding: 8, gap: 2, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center" },
    wordOn: { borderColor: c.accentGreen, backgroundColor: c.lightCream },
    wTranslit: { fontSize: 11.5, color: c.textMid, fontFamily: "Inter_500Medium", fontStyle: "italic", textAlign: "center" },
    wTranslitBig: { fontSize: 14, color: c.textMid, fontFamily: "Inter_500Medium", fontStyle: "italic" },
    wGloss: { fontSize: 12, color: c.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center" },
    wStrongs: { fontSize: 10.5, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    detail: { padding: 12, gap: 5, borderRadius: 12, backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.accentGreen },
    detailRow: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
    detailKey: { fontFamily: "Inter_700Bold" },
    cHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
    cName: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    cStatus: { fontSize: 12.5, color: c.amber, fontFamily: "Inter_500Medium" },
    cText: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 22 },
    xref: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 40, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    xrefText: { flex: 1, fontSize: 14.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    input: { flex: 1, minHeight: 46, fontSize: 15.5, color: c.textDark, fontFamily: "Inter_400Regular", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 12, backgroundColor: c.card },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    bookBtn: { width: "31%", minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    chapterBtn: { width: 56, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    bookText: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
