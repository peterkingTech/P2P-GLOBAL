import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { Attribution, OriginalText, StudyState } from "@/components/study/StudyUI";
import { dictionaryOccurrences, dictionaryRecord, type DictOccurrences, type DictRecordDetail } from "@/lib/deepStudyApi";
import { dictLanguageLabel } from "@/lib/dictionaryLabels";

// Every verse where one lemma (Strong's number) occurs in the BSB interlinear, with the ACTUAL word form
// used there (spelling, transliteration, parsing, BSB gloss). Counting the lemma is not counting an
// English word in a translation — the screen says which is which. Each verse opens in the normal Bible
// reader, in Deep Study (passage study with cross references and commentaries), or straight in the
// commentaries for that passage.
type Item = DictOccurrences["items"][number];

export default function DictionaryOccurrencesScreen() {
  const { strongs } = useLocalSearchParams<{ strongs: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [rec, setRec] = useState<DictRecordDetail | null>(null);
  const [page, setPage] = useState<DictOccurrences | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (!strongs) return;
    setError(null);
    dictionaryRecord(String(strongs)).then(setRec, () => {});
    dictionaryOccurrences(String(strongs)).then((p) => { setPage(p); setItems(p.items); }, (e) => setError(e?.message ?? t("dictionary.loadError", { defaultValue: "Couldn't load the dictionary." })));
  }, [strongs, t]);
  useEffect(load, [load]);
  const more = () => {
    if (!page || busy || items.length >= page.verses) return;
    setBusy(true);
    dictionaryOccurrences(String(strongs), items.length).then((p) => setItems((prev) => [...prev, ...p.items]), () => {}).finally(() => setBusy(false));
  };

  const r = rec?.record;
  const read = (i: Item) => router.push(`/bible?book=${i.book}&chapter=${i.chapter}&v=${i.verse}` as any);
  const study = (i: Item, tab?: string) => router.push({ pathname: "/deep-study", params: { book: i.book, chapter: String(i.chapter), v: String(i.verse), ve: String(i.verse), ...(tab ? { tab } : {}) } } as any);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">{t("dictionary.occurrences", { defaultValue: "Occurrences" })} · {String(strongs)}</Text>
      </View>
      <FlatList data={items} keyExtractor={(i) => `${i.book}.${i.chapter}.${i.verse}`} onEndReached={more} onEndReachedThreshold={0.6}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={
          <View style={{ gap: 8, paddingBottom: 6 }}>
            {r ? (
              <>
                <OriginalText text={r.lemma} direction={r.language === "greek" ? "ltr" : "rtl"} size={30} />
                <Text style={s.meta}>{r.transliteration} · {r.gloss} · {dictLanguageLabel(t, r.language)}</Text>
              </>
            ) : null}
            {page ? <Text style={s.count}>{t("dictionary.usage", { defaultValue: "{{words}} times in {{verses}} verses (every form, BSB interlinear)", words: page.words.toLocaleString(), verses: page.verses.toLocaleString() })}</Text> : null}
            {rec ? <Text style={s.note}>{rec.countsNote}</Text> : null}
            <StudyState loading={!page && !error} error={error} onRetry={load} empty={page && !page.verses ? t("dictionary.noOccurrences", { defaultValue: "No occurrences in the BSB interlinear." }) : null} />
          </View>
        }
        renderItem={({ item: i }) => (
          <View style={s.row}>
            <Text style={s.ref}>{i.bookName} {i.chapter}:{i.verse}</Text>
            {i.forms === null ? <Text style={s.meta}>{t("dictionary.formUnavailable", { defaultValue: "The word form couldn't be loaded for this verse." })}</Text> : i.forms.map((f) => (
              <View key={f.wordId} style={{ gap: 2 }}>
                <OriginalText text={f.text} direction={f.language === "greek" ? "ltr" : "rtl"} size={20} />
                <Text style={s.meta}>{[f.transliteration, f.parsing, f.gloss ? `BSB: “${f.gloss}”` : null].filter(Boolean).join(" · ")}</Text>
              </View>
            ))}
            <View style={s.actions}>
              <AppButton label={t("dictionary.read", { defaultValue: "Read" })} icon="book-outline" size="sm" variant="tertiary" onPress={() => read(i)} />
              <AppButton label={t("deepStudy.title", { defaultValue: "Deep Study" })} icon="layers-outline" size="sm" variant="tertiary" onPress={() => study(i)} />
              <AppButton label={t("deepStudy.commentaries", { defaultValue: "Commentaries" })} icon="library-outline" size="sm" variant="tertiary" onPress={() => study(i, "commentaries")} />
            </View>
          </View>
        )}
        ListFooterComponent={<View style={{ gap: 8, paddingTop: 10 }}>{page?.credits.map((cr) => <Attribution key={cr.id} credit={cr} compact />)}</View>} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    row: { padding: 12, gap: 6, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    ref: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_700Bold" },
    count: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    note: { fontSize: 12.5, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  });
}
