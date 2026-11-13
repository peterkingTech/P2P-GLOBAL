import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { Attribution, OriginalText, PronounceButton, SectionTitle, StudyState } from "@/components/study/StudyUI";
import ListenPlayer from "@/components/listen/ListenPlayer";
import { listen, useListenOwner } from "@/lib/listen";
import { lexiconSections } from "@/lib/listen/studyContent";
import { dictionaryRecord, languageName, lexiconEntry, type DictRecordDetail, type LexiconEntry } from "@/lib/deepStudyApi";
import { bookByCode } from "@/lib/bibleReaderApi";

// One lexicon entry (STEPBible brief lexicons) — the SAME record whether it was opened from a word in
// Deep Study or from Study Tools. Every sense is shown; which one a verse uses is for the reader to weigh.
// Opened from a passage (?book&chapter&t), it also lists where the word occurs in that chapter.
export default function WordScreen() {
  const p = useLocalSearchParams<{ strongs: string; book?: string; chapter?: string; t?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const at = p.book && Number(p.chapter) ? { book: String(p.book), chapter: Number(p.chapter) } : null;
  const [d, setD] = useState<LexiconEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    lexiconEntry(String(p.strongs), at).then(setD, (e) => setError(e?.message ?? "Couldn't load this word."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.strongs, p.book, p.chapter]);
  useEffect(load, [load]);
  // The same record in the Biblical Dictionary: usage across the Bible and its headwords (optional extra —
  // the entry above never depends on it).
  const [across, setAcross] = useState<DictRecordDetail | null>(null);
  useEffect(() => { setAcross(null); dictionaryRecord(String(p.strongs)).then(setAcross, () => setAcross(null)); }, [p.strongs]);
  // P2P Listen (the shared player): the entry read aloud — in English, as the lexicon is English.
  useListenOwner("study-word");
  const listenEntry = () => {
    if (!d) return;
    const sections = lexiconSections({ id: d.entry.id, languageName: languageName(d.entry.language), attribution: d.credit?.attribution, senses: d.entry.senses });
    if (!sections.length) return;
    void listen.play({ key: `lexicon:${d.entry.id}`, owner: "study-word", kind: "study", title: d.entry.id, subtitle: t("deepStudy.readInEnglish", { defaultValue: "Read in English" }),
      language: "en", highlight: "sentence", sections, route: { pathname: "/study-tools/word/[strongs]", params: { strongs: d.entry.id } } }, "start");
  };

  const open = (strongs: string) => router.push({ pathname: "/study-tools/word/[strongs]", params: { strongs, ...(at ? { book: at.book, chapter: String(at.chapter), t: p.t ?? "" } : {}) } } as any);
  const book = at ? bookByCode(at.book) : null;

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} numberOfLines={1}>{t("deepStudy.lexiconEntry", { defaultValue: "Lexicon entry" })} · {String(p.strongs).toUpperCase()}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }}>
        {!d || error ? <StudyState loading={!d && !error} error={error} onRetry={load} /> : (
          <>
            <StudyState offline={d.offline} />
            <View style={s.badges}>
              <Text style={s.badge}>{d.entry.id}</Text>
              <Text style={s.badge}>{languageName(d.entry.language)}</Text>
              <Text style={s.badge}>{d.entry.senses.length} {d.entry.senses.length === 1 ? t("deepStudy.sense", { defaultValue: "sense" }) : t("deepStudy.senses", { defaultValue: "senses" })}</Text>
            </View>
            <AppButton label={t("deepStudy.listenEntry", { defaultValue: "Listen to this entry" })} icon="headset-outline" variant="secondary" size="sm" onPress={listenEntry} />
            {d.entry.senses.map((sense) => (
              <View key={sense.id} style={[s.card, d.requestedSense === sense.id && s.cardOn]}>
                <View style={s.senseHead}>
                  <View style={{ flex: 1 }}>
                    {sense.lemma ? <OriginalText text={sense.lemma} direction={d.entry.direction} size={28} /> : null}
                    {sense.transliteration ? <Text style={s.translit}>{sense.transliteration}</Text> : null}
                  </View>
                  <Text style={s.senseId}>{sense.id}</Text>
                </View>
                {sense.lemma ? <PronounceButton text={sense.lemma} language={sense.language ?? d.entry.language ?? ""} transliteration={sense.transliteration} /> : null}
                {sense.gloss ? <Text style={s.gloss}>“{sense.gloss}”</Text> : null}
                {sense.partOfSpeech ? <Text style={s.meta}>{t("deepStudy.partOfSpeech", { defaultValue: "Part of speech" })}: {sense.partOfSpeech}</Text> : null}
                {sense.definition ? <Text style={s.definition}>{sense.definition.replace(/\n{3,}/g, "\n\n").trim()}</Text> : null}
              </View>
            ))}
            {d.entry.relatedStrongs.length ? (
              <View style={{ gap: 6 }}>
                <SectionTitle>{t("deepStudy.relatedEntries", { defaultValue: "Related entries" })}</SectionTitle>
                <Text style={s.meta}>{t("dictionary.relatedNote", { defaultValue: "Entries this definition refers to (for example a Hebrew or Aramaic counterpart). Being named here does not by itself mean the words share a root." })}</Text>
                <View style={s.badges}>
                  {d.entry.relatedStrongs.map((r) => (
                    <TouchableOpacity key={r} onPress={() => open(r)} accessibilityRole="button" style={s.chip}><Text style={s.chipText}>{r}</Text></TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
            {d.occurrences && book ? (
              <View style={{ gap: 6 }}>
                <SectionTitle>{t("deepStudy.inThisChapter", { defaultValue: "In this chapter" })} · {book.name} {at!.chapter}</SectionTitle>
                {d.occurrences.length ? d.occurrences.map((o) => (
                  <TouchableOpacity key={o.wordId} style={s.occ} accessibilityRole="button"
                    onPress={() => router.push({ pathname: "/deep-study", params: { book: at!.book, chapter: String(at!.chapter), v: String(o.verse), t: p.t ?? "" } } as any)}>
                    <Text style={s.occVerse}>{at!.chapter}:{o.verse}</Text>
                    <OriginalText text={o.text} direction={d.entry.direction} size={18} style={{ flex: 1 }} />
                    <Text style={s.occGloss} numberOfLines={1}>{o.gloss ?? "—"}</Text>
                  </TouchableOpacity>
                )) : <Text style={s.meta}>{t("deepStudy.notInChapter", { defaultValue: "Not used in this chapter." })}</Text>}
              </View>
            ) : null}
            {across ? (
              <View style={{ gap: 6 }}>
                <SectionTitle>{t("dictionary.acrossBible", { defaultValue: "Across the Bible" })}</SectionTitle>
                <Text style={s.meta}>{across.record.words ? t("dictionary.usage", { defaultValue: "{{words}} times in {{verses}} verses (every form, BSB interlinear)", words: across.record.words.toLocaleString(), verses: across.record.verses.toLocaleString() }) : t("dictionary.noOccurrences", { defaultValue: "No occurrences in the BSB interlinear." })}</Text>
                {across.record.words ? <AppButton label={t("dictionary.allOccurrences", { defaultValue: "All occurrences" })} icon="list-outline" variant="secondary" size="sm"
                  onPress={() => router.push({ pathname: "/dictionary/occurrences/[strongs]", params: { strongs: d.entry.id } } as any)} /> : null}
                {across.terms.length ? (
                  <View style={s.badges}>
                    <Text style={s.meta}>{t("dictionary.inDictionary", { defaultValue: "In the dictionary:" })}</Text>
                    {across.terms.map((x) => (
                      <TouchableOpacity key={x.key} onPress={() => router.push({ pathname: "/dictionary/term/[key]", params: { key: x.key } } as any)} accessibilityRole="button" style={s.chip}>
                        <Text style={s.chipText}>{x.display}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text style={s.note}>{d.note}</Text>
            <Attribution credit={d.credit} />
          </>
        )}
      </ScrollView>
      <ListenPlayer owner="study-word" bottomInset={insets.bottom} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    badge: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, overflow: "hidden" },
    card: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    cardOn: { borderColor: c.accentGreen },
    senseHead: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    senseId: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    translit: { fontSize: 14, color: c.textMid, fontFamily: "Inter_500Medium", fontStyle: "italic" },
    gloss: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular" },
    definition: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
    chip: { minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: c.accentGreen },
    chipText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    occ: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    occVerse: { width: 46, fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    occGloss: { maxWidth: 140, fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular" },
    note: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
  });
}
