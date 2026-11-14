import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { Attribution, OriginalText, StudyState } from "@/components/study/StudyUI";
import { dictLanguageLabel } from "@/lib/dictionaryLabels";
import LanguageFlag from "@/components/language/LanguageFlag";
import { languageFlag } from "@/lib/languageRegistry";
import { languageName, normaliseStrongs, searchLexicon, type LexiconSearch } from "@/lib/deepStudyApi";

// Lexicon search for Study Tools (Hebrew / Greek / Aramaic lexicons, Strong's lookup, word study): by
// Strong's number or by Hebrew/Greek letters. Each result opens the same entry a tapped word opens.
export default function LexiconSearchScreen() {
  const p = useLocalSearchParams<{ language?: string; mode?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [language, setLanguage] = useState<string | null>(p.language && ["hebrew", "greek", "aramaic"].includes(p.language) ? p.language : null);
  const [q, setQ] = useState("");
  const [d, setD] = useState<LexiconSearch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const [retry, setRetry] = useState(0);
  const strongsMode = p.mode === "strongs";

  useEffect(() => {
    const n = ++seq.current;
    const timer = setTimeout(() => {
      setError(null);
      searchLexicon(q.trim(), language).then((r) => { if (n === seq.current) setD(r); }, (e) => { if (n === seq.current) setError(e?.message ?? "Couldn't search the lexicon."); });
    }, 300);
    return () => clearTimeout(timer);
  }, [q, language, retry]);

  const open = (id: string) => router.push({ pathname: "/study-tools/word/[strongs]", params: { strongs: id } } as any);
  const direct = normaliseStrongs(q);
  const title = strongsMode ? t("deepStudy.strongsLookup", { defaultValue: "Strong's lookup" }) : p.mode === "word" ? t("deepStudy.wordStudy", { defaultValue: "Word study" })
    : language ? `${languageName(language)} ${t("deepStudy.lexiconLower", { defaultValue: "lexicon" })}` : t("deepStudy.lexicon", { defaultValue: "Lexicon" });

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <TextInput value={q} onChangeText={setQ} autoCapitalize="characters" autoCorrect={false} style={s.input}
          placeholder={strongsMode ? t("deepStudy.strongsPlaceholder", { defaultValue: "Strong's number, e.g. H1254 or G3056" }) : t("deepStudy.lexiconPlaceholder", { defaultValue: "Strong's number or Hebrew/Greek letters" })}
          placeholderTextColor={c.textMuted} accessibilityLabel={t("deepStudy.searchLexicon", { defaultValue: "Search the lexicon" })} />
        {direct ? <AppButton label={`${t("deepStudy.open", { defaultValue: "Open" })} ${direct}`} icon="book-outline" onPress={() => open(direct)} /> : null}
        {!strongsMode ? (
          <ChipRow accessibilityLabel={t("deepStudy.language", { defaultValue: "Language" })} single>
            {[[null, t("deepStudy.all", { defaultValue: "All" })], ...(["hebrew", "aramaic", "greek"] as const).map((k) => [k, dictLanguageLabel(t, k)])].map(([k, l]) => (
              <FilterChip key={String(k)} label={String(l)} leading={k && languageFlag(k) ? <LanguageFlag language={k} size={14} /> : undefined} selected={language === k} selection="single" onPress={() => setLanguage(k)} />
            ))}
          </ChipRow>
        ) : null}
        {p.mode === "word" ? <Text style={s.hint}>{t("deepStudy.wordStudyHint", { defaultValue: "Open a word to see all its meanings. From a passage in Deep Study, it also shows where the word is used in that chapter." })}</Text> : null}
        <StudyState loading={!d && !error} error={error} onRetry={() => setRetry((n) => n + 1)} />
        {d ? (
          <>
            <Text style={s.hint}>{d.mode === "browse" ? `${d.total.toLocaleString()} ${t("deepStudy.entries", { defaultValue: "entries" })}` : `${d.total.toLocaleString()} ${t("deepStudy.matches", { defaultValue: "matches" })}`}{d.total > d.items.length ? ` · ${t("deepStudy.firstShown", { defaultValue: "first {{n}} shown", n: d.items.length })}` : ""}</Text>
            {!d.items.length && q.trim() ? <Text style={s.hint}>{t("deepStudy.lexiconNoMatch", { defaultValue: "No match. English words can't be searched here — the meanings are inside each entry. Try a Strong's number." })}</Text> : null}
            {d.items.map((i) => (
              <TouchableOpacity key={i.id} style={s.row} onPress={() => open(i.id)} accessibilityRole="button" accessibilityLabel={`${i.id}, ${languageName(i.language)}`}>
                <Text style={s.id}>{i.id}</Text>
                <OriginalText text={i.name} direction={i.language === "greek" ? "ltr" : "rtl"} size={20} style={{ flex: 1 }} />
                <Text style={s.lang}>{languageName(i.language)}</Text>
              </TouchableOpacity>
            ))}
            <Attribution credit={d.credit} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    input: { minHeight: 46, fontSize: 16, color: c.textDark, fontFamily: "Inter_400Regular", borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 12, backgroundColor: c.card },
    hint: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    id: { width: 58, fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    lang: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
  });
}
