import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { Attribution, OriginalText, SectionTitle, StudyState } from "@/components/study/StudyUI";
import ListenPlayer from "@/components/listen/ListenPlayer";
import { listen, useListenOwner } from "@/lib/listen";
import { articleSections } from "@/lib/listen/studyContent";
import { dictionaryArticle, type DictArticle, type DictArticleSegment, type DictScriptureRef } from "@/lib/deepStudyApi";
import { dictLanguageLabel } from "@/lib/dictionaryLabels";

// One REFERENCE ARTICLE (Pharisees, Sanhedrin, Covenant …) from Easton's Bible Dictionary (1897) — a
// separate entry type from the Hebrew/Greek/Aramaic lexical records. The text is shown exactly as
// published (English; it is not translated), with the passages it cites opening in the normal Bible
// reader, its see-also articles, and — kept apart and labelled — the lexicon words glossed with its
// headword. The source, its date and its public-domain status are always shown.
const OWNER = "dictionary-article";

export default function DictionaryArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [a, setA] = useState<DictArticle | null>(null);
  const [error, setError] = useState<string | null>(null);
  useListenOwner(OWNER);
  const load = useCallback(() => { if (!id) return; setError(null); dictionaryArticle(String(id)).then(setA, (e) => setError(e?.message ?? t("dictionary.loadError", { defaultValue: "Couldn't load the dictionary." }))); }, [id, t]);
  useEffect(load, [load]);

  const read = (r: DictScriptureRef) => router.push(`/bible?book=${r.book}&chapter=${r.chapter}${r.verse ? `&v=${r.verse}` : ""}` as any);
  const readRef = (ref: string) => { const r = a?.scripture.find((x) => x.ref === ref); if (r) read(r); };
  const openArticle = (to: string) => router.push({ pathname: "/dictionary/article/[id]", params: { id: to } } as any);
  const openTerm = (key: string) => router.push({ pathname: "/dictionary/term/[key]", params: { key } } as any);
  const onListen = () => {
    if (!a) return;
    void listen.play({ key: `dictionary-article:${a.id}`, owner: OWNER, kind: "study", title: a.title,
      subtitle: t("deepStudy.readInEnglish", { defaultValue: "Read in English" }), language: "en", highlight: "sentence",
      sections: articleSections(a, a.credit?.attribution ?? null),
      route: { pathname: "/dictionary/article/[id]", params: { id: a.id } } }, "start");
  };

  const segment = (seg: DictArticleSegment, i: number) => {
    if (typeof seg === "string") return seg;
    if (seg[0] === "i") return <Text key={i} style={s.foreign}>{seg[1]}</Text>;
    const [kind, target, label] = seg;
    if (!target) return label;   // a passage outside the 66 books, or a see-also the edition doesn't have
    return kind === "r"
      ? <Text key={i} style={s.link} onPress={() => readRef(target)} accessibilityRole="link">{label}</Text>
      : <Text key={i} style={s.link} onPress={() => openArticle(target)} accessibilityRole="link">{label}</Text>;
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">{a?.title ?? t("dictionary.title", { defaultValue: "Biblical Dictionary" })}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 120 }}>
        {!a || error ? <StudyState loading={!a && !error} error={error} onRetry={load} /> : (
          <>
            <View style={{ gap: 6 }}>
              <Text style={s.headword}>{a.title}</Text>
              <Text style={s.kind}>{t("dictionary.kindArticle", { defaultValue: "Reference article · Easton's Bible Dictionary (1897)" })}</Text>
              <Text style={s.note}>{t("dictionary.articleNote", { defaultValue: "Shown as published in 1897 and not revised since, so its dates, places and scholarship reflect that time. It is in English and is not translated. It is a separate source from the Hebrew and Greek lexicon." })}</Text>
              <AppButton label={t("dictionary.listenArticle", { defaultValue: "Listen to this article" })} icon="headset-outline" variant="secondary" onPress={onListen} />
            </View>
            <View style={s.card}>
              {a.paragraphs.map((p, i) => <Text key={i} style={s.para}>{p.map(segment)}</Text>)}
            </View>
            {a.seeAlso.length ? (
              <View style={{ gap: 8 }}>
                <SectionTitle>{t("dictionary.seeAlso", { defaultValue: "See also" })}</SectionTitle>
                <View style={s.chips}>
                  {a.seeAlso.map((x) => <AppButton key={x.id} label={x.title} icon="document-text-outline" size="sm" variant="tertiary" onPress={() => openArticle(x.id)} />)}
                </View>
              </View>
            ) : null}
            {a.scripture.length ? (
              <View style={{ gap: 8 }}>
                <SectionTitle>{t("dictionary.articlePassages", { defaultValue: "Passages cited ({{n}})", n: a.scripture.length })}</SectionTitle>
                <View style={s.chips}>
                  {a.scripture.map((r) => (
                    <TouchableOpacity key={r.ref} style={s.refChip} onPress={() => read(r)} accessibilityRole="button"
                      accessibilityLabel={t("dictionary.readPassage", { defaultValue: "Read {{ref}}", ref: r.label })}>
                      <Text style={s.refText}>{r.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
            {a.relatedWords.length ? (
              <View style={{ gap: 8 }}>
                <SectionTitle>{t("dictionary.relatedOriginal", { defaultValue: "Original-language words" })}</SectionTitle>
                <Text style={s.note}>{a.relatedNote}</Text>
                {a.relatedWords.map((w) => (
                  <TouchableOpacity key={w.key} style={s.wordRow} onPress={() => openTerm(w.key)} accessibilityRole="button"
                    accessibilityLabel={t("dictionary.termA11y", { defaultValue: "{{word}}: {{n}} original words", word: w.display, n: w.records.length })}>
                    <Text style={s.wordTitle}>“{w.display}”</Text>
                    {w.records.map((r) => (
                      <View key={r.strongs} style={s.wordLine}>
                        <OriginalText text={r.lemma} direction={r.language === "greek" ? "ltr" : "rtl"} size={18} />
                        <Text style={s.meta}>{r.transliteration} · {r.strongs} · {dictLanguageLabel(t, r.language)}</Text>
                      </View>
                    ))}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {a.credit ? <Attribution credit={a.credit} /> : null}
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
    card: { padding: 14, gap: 12, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    para: { fontSize: 15.5, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 24 },
    foreign: { fontStyle: "italic" },
    link: { color: c.accentGreen, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    refChip: { minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    refText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    wordRow: { padding: 12, gap: 6, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    wordTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    wordLine: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
  });
}
