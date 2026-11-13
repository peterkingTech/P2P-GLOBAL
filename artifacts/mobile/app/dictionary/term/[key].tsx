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
import { dictionarySections } from "@/lib/listen/studyContent";
import { dictionaryTerm, type DictLanguage, type DictRecord, type DictTerm } from "@/lib/deepStudyApi";
import { dictLanguageLabel } from "@/lib/dictionaryLabels";

// One dictionary headword (e.g. "love"): EVERY original-language word the lexicon glosses with it, shown
// separately — never merged — with its Strong's number, transliteration, part of speech, lettered senses,
// real usage counts (BSB interlinear, all forms) and how the BSB renders it. Then the original words the
// BSB also translates with this English word. Each record opens the canonical lexicon entry (Study Tools),
// its occurrences, and Deep Study. Listening uses the shared P2P Listen player.
const OWNER = "dictionary";
const ORDER: DictLanguage[] = ["hebrew", "aramaic", "greek"];

export default function DictionaryTermScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<DictTerm | null>(null);
  const [error, setError] = useState<string | null>(null);
  useListenOwner(OWNER);
  const load = useCallback(() => { if (!key) return; setError(null); dictionaryTerm(String(key)).then(setD, (e) => setError(e?.message ?? t("dictionary.loadError", { defaultValue: "Couldn't load the dictionary." }))); }, [key, t]);
  useEffect(load, [load]);

  const openRecord = (strongs: string) => router.push({ pathname: "/study-tools/word/[strongs]", params: { strongs } } as any);
  const openOccurrences = (strongs: string) => router.push({ pathname: "/dictionary/occurrences/[strongs]", params: { strongs } } as any);
  const onListen = () => {
    if (!d) return;
    void listen.play({ key: `dictionary:${d.key}`, owner: OWNER, kind: "study", title: d.display,
      subtitle: t("deepStudy.readInEnglish", { defaultValue: "Read in English" }), language: "en", highlight: "sentence",
      sections: dictionarySections(d, d.credits.map((x) => x.attribution).join(" ")),
      route: { pathname: "/dictionary/term/[key]", params: { key: d.key } } }, "start");
  };

  const card = (r: DictRecord, renderCount?: number) => (
    <View key={r.id} style={s.card}>
      <View style={s.cardTop}>
        <OriginalText text={r.lemma} direction={r.language === "greek" ? "ltr" : "rtl"} size={28} style={{ flex: 1 }} />
        <View style={{ alignItems: "flex-end" }}>
          <Text style={s.id}>{r.strongs}</Text>
          <Text style={s.meta}>{dictLanguageLabel(t, r.language)}</Text>
        </View>
      </View>
      <Text style={s.translit}>{r.transliteration}{r.partOfSpeech ? ` · ${r.partOfSpeech}` : ""}</Text>
      <Text style={s.gloss}>{t("dictionary.lexiconGloss", { defaultValue: "Lexicon gloss" })}: {r.gloss || "—"}</Text>
      {r.senses.length > 1 ? (
        <Text style={s.meta}>{t("dictionary.senses", { defaultValue: "Separate senses" })}: {r.senses.map((x) => `${x.id} ${x.gloss}`).join(" · ")}</Text>
      ) : null}
      {r.occurrenceLanguages.length && !r.occurrenceLanguages.every((l) => l === r.language) ? (
        <Text style={s.meta}>{t("dictionary.usedIn", { defaultValue: "Used in: {{langs}}", langs: r.occurrenceLanguages.map((l) => dictLanguageLabel(t, l)).join(", ") })}</Text>
      ) : null}
      <Text style={s.meta}>
        {r.words ? t("dictionary.usage", { defaultValue: "{{words}} times in {{verses}} verses (every form, BSB interlinear)", words: r.words.toLocaleString(), verses: r.verses.toLocaleString() })
          : t("dictionary.noOccurrences", { defaultValue: "No occurrences in the BSB interlinear." })}
      </Text>
      {renderCount ? <Text style={s.meta}>{t("dictionary.renderedThisWay", { defaultValue: "Translated “{{word}}” {{n}} times in the BSB", word: d?.display ?? "", n: renderCount })}</Text>
        : r.renderings.length ? <Text style={s.meta}>{t("dictionary.bsbRenders", { defaultValue: "BSB renders it" })}: {r.renderings.slice(0, 5).map((x) => `${x.text} (${x.count})`).join(", ")}</Text> : null}
      <PronounceButton text={r.lemma} language={r.language} transliteration={r.transliteration} />
      <View style={s.actions}>
        <AppButton label={t("dictionary.fullEntry", { defaultValue: "Full entry" })} icon="book-outline" size="sm" variant="secondary" onPress={() => openRecord(r.strongs)} />
        {r.words ? <AppButton label={t("dictionary.occurrences", { defaultValue: "Occurrences" })} icon="list-outline" size="sm" variant="secondary" onPress={() => openOccurrences(r.strongs)} /> : null}
      </View>
    </View>
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">{d?.display ?? t("dictionary.title", { defaultValue: "Biblical Dictionary" })}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 120 }}>
        {!d || error ? <StudyState loading={!d && !error} error={error} onRetry={load} /> : (
          <>
            <View style={{ gap: 6 }}>
              <Text style={s.headword}>{d.display}</Text>
              <Text style={s.kind}>{t("dictionary.kindLexical", { defaultValue: "Biblical language entry · STEPBible brief lexicon" })}</Text>
              <Text style={s.note}>{d.records.length === 1 ? t("dictionary.glossNoteOne", { defaultValue: "One original word has this English gloss. A gloss is a short meaning — the meaning in a verse depends on the verse." })
                : t("dictionary.glossNote", { defaultValue: "{{n}} different original words have this English gloss. Each is its own word with its own range of meaning — the meaning in a verse depends on the verse.", n: d.records.length })}</Text>
              <AppButton label={t("dictionary.listenEntry", { defaultValue: "Listen to this entry" })} icon="headset-outline" variant="secondary" onPress={onListen} />
            </View>
            {d.articles?.length ? (
              <View style={{ gap: 8 }}>
                <SectionTitle>{t("dictionary.referenceArticle", { defaultValue: "Reference article" })}</SectionTitle>
                {d.articles.map((x) => (
                  <TouchableOpacity key={x.id} style={s.card} onPress={() => router.push({ pathname: "/dictionary/article/[id]", params: { id: x.id } } as any)} accessibilityRole="button"
                    accessibilityLabel={`${x.title}, ${t("dictionary.kindArticle", { defaultValue: "Reference article · Easton's Bible Dictionary (1897)" })}`}>
                    <Text style={s.translit}>{x.title}</Text>
                    <Text style={s.kind}>{t("dictionary.kindArticle", { defaultValue: "Reference article · Easton's Bible Dictionary (1897)" })}</Text>
                    <Text style={s.meta} numberOfLines={3}>{x.preview}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {ORDER.map((lang) => {
              const list = d.records.filter((r) => r.language === lang);
              return list.length ? (
                <View key={lang} style={{ gap: 10 }}>
                  <SectionTitle>{dictLanguageLabel(t, lang)} ({list.length})</SectionTitle>
                  {list.map((r) => card(r))}
                </View>
              ) : null;
            })}
            {!d.records.some((r) => r.language === "aramaic") ? (
              <Text style={s.note}>{t("dictionary.noAramaic", { defaultValue: "No Aramaic word in the lexicon has this gloss." })}</Text>
            ) : null}
            {d.renderedAs.length ? (
              <View style={{ gap: 10 }}>
                <SectionTitle>{t("dictionary.alsoTranslated", { defaultValue: "Also translated “{{word}}”", word: d.display })}</SectionTitle>
                <Text style={s.note}>{d.renderedNote}</Text>
                {d.renderedAs.map((r) => card(r, r.renderCount))}
              </View>
            ) : null}
            {d.credits.map((cr) => <Attribution key={cr.id} credit={cr} />)}
          </>
        )}
      </ScrollView>
      <ListenPlayer owner={OWNER} bottomInset={insets.bottom} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    headword: { fontSize: 28, color: c.textDark, fontFamily: "Inter_700Bold" },
    kind: { fontSize: 12.5, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    note: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
    card: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    id: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    translit: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium" },
    gloss: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  });
}
