import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { ChipRow, FilterChip, IconButton } from "@/components/ui";
import { Attribution, OriginalText, StudyState } from "@/components/study/StudyUI";
import { dictLanguageLabel } from "@/lib/dictionaryLabels";
import {
  dictionaryArticles, dictionaryBrowse, dictionaryOverview, dictionarySearch,
  type DictArticleSummary, type DictLanguage, type DictOverview, type DictSearchItem, type DictTermSummary,
} from "@/lib/deepStudyApi";

// BIBLICAL DICTIONARY (A–Z) — inside Deep Study, usable without choosing a passage. One search box for
// English, Hebrew, Aramaic and Greek letters, transliteration and Strong's numbers; an A–Z index of the
// lexicon's own English headwords (real counts per letter). Every row leads to the SAME Strong's-numbered
// records Deep Study and Study Tools use. Where the person was (letter, search, list position) is kept
// for the session, so coming back from an entry returns them to the same place. Reference ARTICLES
// (Easton's 1897) are a separate entry type: their own A–Z, and labelled rows in search.
type Kind = "words" | "articles";
const saved = { letter: "A", q: "", language: null as DictLanguage | null, offset: 0, kind: "words" as Kind };
type Row = DictTermSummary | DictSearchItem | DictArticleSummary;

export default function DictionaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [overview, setOverview] = useState<DictOverview | null>(null);
  const [letter, setLetter] = useState(saved.letter);
  const [q, setQ] = useState(saved.q);
  const [language, setLanguage] = useState<DictLanguage | null>(saved.language);
  const [kind, setKind] = useState<Kind>(saved.kind);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [more, setMore] = useState(false);
  const list = useRef<FlatList>(null);
  const seq = useRef(0);
  const searching = q.trim().length > 0;

  useEffect(() => { dictionaryOverview().then(setOverview, (e) => setError(e?.message ?? "")); }, [retry]);
  useEffect(() => { saved.letter = letter; saved.q = q; saved.language = language; saved.kind = kind; }, [letter, q, language, kind]);
  const hasArticles = !!overview?.articles?.total;
  const browsingArticles = kind === "articles" && hasArticles;

  // Browse a letter, or search (debounced; earlier answers that arrive late are ignored).
  useEffect(() => {
    const n = ++seq.current;
    setError(null);
    const timer = setTimeout(() => {
      const load = searching ? dictionarySearch(q.trim(), language) : browsingArticles ? dictionaryArticles(letter) : dictionaryBrowse(letter);
      load.then((r) => { if (n !== seq.current) return; setRows(r.items); setTotal(r.total); },
        (e) => { if (n === seq.current) setError(e?.message ?? t("dictionary.loadError", { defaultValue: "Couldn't load the dictionary." })); });
    }, searching ? 300 : 0);
    return () => clearTimeout(timer);
  }, [q, letter, language, retry, searching, browsingArticles, t]);

  const loadMore = useCallback(() => {
    if (!rows || more || rows.length >= total) return;
    const n = seq.current; setMore(true);
    (searching ? dictionarySearch(q.trim(), language, rows.length) : browsingArticles ? dictionaryArticles(letter, rows.length) : dictionaryBrowse(letter, rows.length))
      .then((r) => { if (n === seq.current) setRows((prev) => [...(prev ?? []), ...r.items]); }, () => {})
      .finally(() => setMore(false));
  }, [rows, more, total, searching, q, language, letter, browsingArticles]);

  const openTerm = (key: string) => router.push({ pathname: "/dictionary/term/[key]", params: { key } } as any);
  const openRecord = (strongs: string) => router.push({ pathname: "/study-tools/word/[strongs]", params: { strongs } } as any);
  const openArticle = (id: string) => router.push({ pathname: "/dictionary/article/[id]", params: { id } } as any);
  const letters = (browsingArticles ? overview?.articles?.letters : overview?.letters) ?? [];
  const counts = new Map(letters.map((l) => [l.letter, l.count]));
  const articleLabel = t("dictionary.kindArticle", { defaultValue: "Reference article · Easton's Bible Dictionary (1897)" });

  const renderItem = ({ item }: { item: Row }) => item.type === "article" ? (
    <TouchableOpacity style={s.row} onPress={() => openArticle(item.id)} accessibilityRole="button" accessibilityLabel={`${item.title}, ${articleLabel}`}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.word}>{item.title}</Text>
        <Text style={s.articleKind}>{articleLabel}</Text>
        <Text style={s.meta} numberOfLines={2}>{item.preview}</Text>
      </View>
    </TouchableOpacity>
  ) : item.type === "term" ? (
    <TouchableOpacity style={s.row} onPress={() => openTerm(item.key)} accessibilityRole="button"
      accessibilityLabel={t("dictionary.termA11y", { defaultValue: "{{word}}: {{n}} original words", word: item.display, n: item.records })}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.word}>{item.display}</Text>
        <Text style={s.meta}>{item.records === 1 ? t("dictionary.originalWordOne", { defaultValue: "1 original word" }) : t("dictionary.originalWords", { defaultValue: "{{n}} original words", n: item.records })} · {item.languages.map((l) => `${dictLanguageLabel(t, l.language)} ${l.count}`).join(" · ")}</Text>
        <View style={s.previewRow}>
          {item.preview.map((p) => <OriginalText key={p.id} text={p.lemma} direction={p.language === "greek" ? "ltr" : "rtl"} size={16} />)}
        </View>
      </View>
    </TouchableOpacity>
  ) : (
    <TouchableOpacity style={s.row} onPress={() => openRecord(item.strongs)} accessibilityRole="button"
      accessibilityLabel={`${item.strongs}, ${dictLanguageLabel(t, item.language)}, ${item.transliteration}, ${item.gloss}`}>
      <View style={{ flex: 1, gap: 2 }}>
        <OriginalText text={item.lemma} direction={item.language === "greek" ? "ltr" : "rtl"} size={22} />
        <Text style={s.meta}>{item.transliteration} · {item.gloss}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={s.id}>{item.strongs}</Text>
        <Text style={s.meta}>{dictLanguageLabel(t, item.language)}</Text>
      </View>
    </TouchableOpacity>
  );

  const header = (
    <View style={{ gap: 12, paddingBottom: 4 }}>
      <TextInput value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" style={s.input} returnKeyType="search"
        placeholder={t("dictionary.searchPlaceholder", { defaultValue: "Search: love, ἀγάπη, אָהַב, agape, G26" })} placeholderTextColor={c.textMuted}
        accessibilityLabel={t("dictionary.searchA11y", { defaultValue: "Search the dictionary by English word, Hebrew, Aramaic or Greek letters, transliteration or Strong's number" })} />
      {hasArticles && !searching ? (
        <ChipRow accessibilityLabel={t("dictionary.entryType", { defaultValue: "Entry type" })} single>
          <FilterChip label={t("dictionary.kindWords", { defaultValue: "Biblical words" })} selected={kind === "words"} selection="single" onPress={() => { setKind("words"); setRows(null); }} />
          <FilterChip label={t("dictionary.kindArticles", { defaultValue: "Reference articles" })} selected={kind === "articles"} selection="single" onPress={() => { setKind("articles"); setRows(null); }} />
        </ChipRow>
      ) : null}
      {searching || !browsingArticles ? <ChipRow accessibilityLabel={t("deepStudy.language", { defaultValue: "Language" })} single>
        {([[null, t("deepStudy.all", { defaultValue: "All" })], ...(["hebrew", "aramaic", "greek"] as const).map((k) => [k, dictLanguageLabel(t, k)] as const)] as const).map(([k, l]) => (
          <FilterChip key={String(k)} label={String(l)} selected={language === k} selection="single" onPress={() => setLanguage(k as DictLanguage | null)} />
        ))}
      </ChipRow> : null}
      {!searching ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.letters} accessibilityLabel={t("dictionary.az", { defaultValue: "A to Z" })}>
          {letters.map(({ letter: L, count }) => (
            <TouchableOpacity key={L} onPress={() => { setLetter(L); setRows(null); list.current?.scrollToOffset({ offset: 0, animated: false }); }} disabled={!count}
              style={[s.letter, L === letter && s.letterOn, !count && s.letterOff]} accessibilityRole="button" accessibilityState={{ selected: L === letter, disabled: !count }}
              accessibilityLabel={t("dictionary.letterA11y", { defaultValue: "{{letter}}, {{n}} words", letter: L, n: count })}>
              <Text style={[s.letterText, L === letter && s.letterTextOn]}>{L}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      <Text style={s.meta}>
        {searching ? t("dictionary.results", { defaultValue: "{{n}} results", n: total.toLocaleString() })
          : browsingArticles ? t("dictionary.articleCount", { defaultValue: "{{n}} articles under {{letter}}", n: (counts.get(letter) ?? total).toLocaleString(), letter })
          : t("dictionary.letterCount", { defaultValue: "{{n}} words under {{letter}}", n: (counts.get(letter) ?? total).toLocaleString(), letter })}
      </Text>
      <StudyState loading={!rows && !error} error={error} onRetry={() => setRetry((n) => n + 1)}
        empty={rows && !rows.length ? (searching ? t("dictionary.noResults", { defaultValue: "No matches. Try another spelling, a Strong's number, or Hebrew or Greek letters." }) : t("dictionary.emptyLetter", { defaultValue: "No words under this letter." })) : null} />
    </View>
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{t("dictionary.title", { defaultValue: "Biblical Dictionary" })}</Text>
      </View>
      <FlatList ref={list} data={rows ?? []} keyExtractor={(i) => (i.type === "term" ? "t:" + i.key : i.type === "article" ? "a:" + i.id : "r:" + (i as { strongs: string }).strongs)}
        renderItem={renderItem} ListHeaderComponent={header} onEndReached={loadMore} onEndReachedThreshold={0.6} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: insets.bottom + 40 }} initialNumToRender={20} windowSize={9}
        ListFooterComponent={
          <View style={{ gap: 10, paddingTop: 12 }}>
            <Text style={s.note}>{t("dictionary.englishOnly", { defaultValue: "Headwords and meanings come from an English lexicon: search in English, in Hebrew, Aramaic or Greek letters, by transliteration or by Strong's number. Meanings are not machine-translated." })}</Text>
            {overview ? <Text style={s.note}>{overview.note}</Text> : null}
            {overview?.articles ? <Text style={s.note}>{overview.articles.note}</Text>
              : <Text style={s.note}>{t("dictionary.referencePending", { defaultValue: "Historical and theological reference articles (for example Pharisee, Septuagint, Targum) will be added once a licensed reference source has been approved. Until then, only the lexicon's own entries are shown." })}</Text>}
            {overview?.credits.map((cr) => <Attribution key={cr.id} credit={cr} compact />)}
            {overview?.articles?.credit ? <Attribution credit={overview.articles.credit} compact /> : null}
          </View>
        } />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    input: { minHeight: 48, fontSize: 16, color: c.textDark, fontFamily: "Inter_400Regular", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 12, backgroundColor: c.card },
    letters: { gap: 6, paddingVertical: 2 },
    letter: { minWidth: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    letterOn: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    letterOff: { opacity: 0.35 },
    letterText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    letterTextOn: { color: "#fff" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, padding: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    previewRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    word: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    id: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    articleKind: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    note: { fontSize: 12.5, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
  });
}
