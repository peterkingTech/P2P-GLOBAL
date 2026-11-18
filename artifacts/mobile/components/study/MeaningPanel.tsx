// WHAT IT MEANS — the top of a My Plan search (owner 2026-11-18). A definition for each word of the search and
// for the words together, from the sources only (api-server lib/studyMeaning.ts): Easton's Bible Dictionary
// entries exactly as the edition has them, the main Hebrew / Greek words (STEPBible lexicons), and verses that
// contain the words. Nothing here is written by P2P or generated. Each part opens its own source, the
// Concordance and the Dictionary, or studies that word on its own.
import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import { bibleRoute } from "@/lib/bibleReaderApi";
import type { Meaning, MeaningVerse } from "@/lib/studyWorkspaceApi";

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export default function MeaningPanel({ meaning, translation, onStudyWord }: { meaning: Meaning; translation: string | null; onStudyWord: (w: string) => void }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const s = useMemo(() => makeStyles(c), [c]);
  const several = meaning.terms.length >= 2;

  const article = (id: string) => router.push({ pathname: "/dictionary/article/[id]", params: { id } } as any);
  const term = (key: string) => router.push({ pathname: "/dictionary/term/[key]", params: { key } } as any);
  const concordance = (q: string) => router.push({ pathname: "/concordance", params: { q } } as any);
  const verse = (v: MeaningVerse) => router.push(bibleRoute({ book: v.book, chapter: v.chapter, v: v.verse, ve: v.verse, translation }) as any);

  const Verses = ({ list }: { list: MeaningVerse[] }) => (
    <View style={{ gap: 6 }}>
      {list.map((v) => (
        <TouchableOpacity key={v.reference} onPress={() => verse(v)} accessibilityRole="link" style={s.verse}
          accessibilityLabel={t("study.meaning.openVerse", { defaultValue: "Read {{ref}} in the Bible", ref: v.reference })}>
          <Text style={s.verseRef}>{v.reference}</Text>
          <Text style={s.verseText} numberOfLines={3}>{v.text}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={{ gap: 12 }} accessibilityLabel={t("study.meaning.title", { defaultValue: "What it means" })}>
      <Text style={s.head}>{t("study.meaning.title", { defaultValue: "What it means" })}</Text>

      {meaning.terms.map((tm) => (
        <View key={tm.term} style={s.card}>
          <Text style={s.word}>{cap(tm.term)}</Text>
          {tm.article ? (
            <>
              {tm.article.via !== "word" ? (
                <Text style={s.note}>{t("study.meaning.viaOther", { defaultValue: "Easton's Bible Dictionary has no entry for “{{word}}” on its own; this is its entry for “{{title}}”.", word: cap(tm.term), title: tm.article.title })}</Text>
              ) : null}
              <Text style={s.def}>{tm.article.excerpt}</Text>
              <Text style={s.source}>{t("study.sourceLabel", { defaultValue: "Source:" })} {tm.article.source} — “{tm.article.title}”</Text>
            </>
          ) : (
            <Text style={s.note}>{t("study.meaning.noEntry", { defaultValue: "Easton's Bible Dictionary has no entry for this word. Its Hebrew and Greek words and its verses are below." })}</Text>
          )}

          {tm.original.length ? (
            <View style={{ gap: 4 }}>
              <Text style={s.sub}>{t("study.meaning.original", { defaultValue: "In Hebrew and Greek" })}</Text>
              {tm.original.map((o) => (
                <TouchableOpacity key={o.strongs} onPress={() => (tm.dictionaryKey ? term(tm.dictionaryKey) : undefined)} accessibilityRole="link" style={s.orig}>
                  <Text style={s.origText}><Text style={s.lemma}>{o.lemma}</Text>  {o.transliteration} ({o.strongs}) — “{o.gloss}” · {t("study.meaning.uses", { defaultValue: "{{count}} times", count: o.uses })}</Text>
                </TouchableOpacity>
              ))}
              <Text style={s.source}>{t("study.sourceLabel", { defaultValue: "Source:" })} {tm.originalSource}</Text>
            </View>
          ) : null}

          {tm.verses.length ? (
            <View style={{ gap: 6 }}>
              <Text style={s.sub}>{tm.verseTotal != null
                ? t("study.meaning.inVerses", { defaultValue: "A Bible search for “{{word}}” finds {{count}} verses ({{translation}}). The first:", word: tm.searchedAs, count: tm.verseTotal, translation: tm.translation ?? "" })
                : t("study.meaning.verses", { defaultValue: "In Scripture" })}</Text>
              <Verses list={tm.verses} />
            </View>
          ) : null}

          <View style={s.actions}>
            {tm.article ? <AppButton size="sm" variant="secondary" icon="book-outline" label={t("study.meaning.fullEntry", { defaultValue: "Full dictionary entry" })} onPress={() => article(tm.article!.id)} /> : null}
            <AppButton size="sm" variant="secondary" icon="list-outline" label={t("study.concordance", { defaultValue: "Concordance" })} onPress={() => concordance(tm.searchedAs)} />
            {tm.dictionaryKey ? <AppButton size="sm" variant="secondary" icon="language-outline" label={t("study.meaning.dictionary", { defaultValue: "Greek & Hebrew dictionary" })} onPress={() => term(tm.dictionaryKey!)} /> : null}
            {several ? <AppButton size="sm" variant="tertiary" icon="search" label={t("study.meaning.studyWord", { defaultValue: "Study “{{word}}” on its own", word: tm.term })} onPress={() => onStudyWord(tm.term)} /> : null}
          </View>
        </View>
      ))}

      {meaning.together ? (
        <View style={[s.card, s.together]}>
          <Text style={s.word}>{t("study.meaning.together", { defaultValue: "Together: “{{phrase}}”", phrase: meaning.together.phrase })}</Text>
          {meaning.together.article ? (
            <>
              <Text style={s.def}>{meaning.together.article.excerpt}</Text>
              <Text style={s.source}>{t("study.sourceLabel", { defaultValue: "Source:" })} {meaning.together.article.source} — “{meaning.together.article.title}”</Text>
            </>
          ) : null}
          {meaning.together.sentences.length ? (
            <View style={{ gap: 6 }}>
              <Text style={s.sub}>{t("study.meaning.joined", { defaultValue: "Where the dictionary speaks of them together" })}</Text>
              {meaning.together.sentences.map((x) => (
                <TouchableOpacity key={x.text} onPress={() => article(x.articleId)} accessibilityRole="link" style={s.quote}>
                  <Text style={s.def}>{x.text}</Text>
                  <Text style={s.source}>— {x.source}, “{x.article}”</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {meaning.together.verses.length ? (
            <View style={{ gap: 6 }}>
              <Text style={s.sub}>{t("study.meaning.togetherVerses", { defaultValue: "Verses where these words stand together ({{translation}})", translation: meaning.together.translation ?? "" })}</Text>
              <Verses list={meaning.together.verses} />
            </View>
          ) : null}
          {!meaning.together.article && !meaning.together.sentences.length && !meaning.together.verses.length ? (
            <Text style={s.note}>{t("study.meaning.togetherNone", { defaultValue: "No dictionary entry or verse joins these words directly. Read each word's definition above, and the findings below." })}</Text>
          ) : (
            <Text style={s.note}>{t("study.meaning.togetherNote", { defaultValue: "Taken from the sources exactly as they are — no summary is written for you. Read each passage in its chapter." })}</Text>
          )}
          <View style={s.actions}>
            {meaning.together.article ? <AppButton size="sm" variant="secondary" icon="book-outline" label={t("study.meaning.fullEntry", { defaultValue: "Full dictionary entry" })} onPress={() => article(meaning.together!.article!.id)} /> : null}
            <AppButton size="sm" variant="secondary" icon="list-outline" label={t("study.concordance", { defaultValue: "Concordance" })} onPress={() => concordance(meaning.together!.searchedAs)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  head: { color: c.textDark, fontSize: 18, fontWeight: "800", marginTop: 4 },
  card: { backgroundColor: c.card, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: c.borderBeige },
  together: { borderColor: c.accentGreen, borderWidth: 2 },
  word: { color: c.textDark, fontSize: 19, fontWeight: "800" },
  def: { color: c.textDark, fontSize: 15, lineHeight: 23 },
  sub: { color: c.textMid, fontSize: 13, fontWeight: "700" },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  source: { color: c.textMuted, fontSize: 12 },
  orig: { minHeight: 36, justifyContent: "center" },
  origText: { color: c.textMid, fontSize: 14 },
  lemma: { color: c.textDark, fontSize: 17, fontWeight: "700" },
  verse: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.lightCream, gap: 2, minHeight: 44 },
  verseRef: { color: c.accentGreen, fontSize: 13, fontWeight: "700" },
  verseText: { color: c.textMid, fontSize: 14, lineHeight: 20 },
  quote: { borderLeftWidth: 3, borderLeftColor: c.accentGreen, paddingLeft: 10, gap: 2 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
});
