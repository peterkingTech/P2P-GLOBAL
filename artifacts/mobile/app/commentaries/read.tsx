import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { Attribution, SectionTitle, StudyState } from "@/components/study/StudyUI";
import { bookByCode } from "@/lib/bibleReaderApi";
import { commentaryChapter, commentaryIntroduction, studyResources, type CommentaryChapter, type Credit } from "@/lib/deepStudyApi";

// Reading one commentary on one chapter (or its introduction to a book) — the same records Deep Study shows.
// Each section names the verses it covers and can open them in Deep Study.
export default function CommentaryReadScreen() {
  const p = useLocalSearchParams<{ id: string; book: string; chapter?: string; intro?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const chapter = Number(p.chapter) || 0;
  const intro = p.intro === "1";
  const [d, setD] = useState<(CommentaryChapter | { introduction: string | null; credit: Credit; covered?: boolean; sections?: [] }) | null>(null);
  const [name, setName] = useState<string>("");
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null); setD(null);
    const job = intro ? commentaryIntroduction(String(p.id), String(p.book)) : commentaryChapter(String(p.id), String(p.book), chapter);
    job.then(setD as never, (e) => setError(e?.message ?? "Couldn't load this commentary."));
    studyResources().then((r) => { const x = r.commentaries.find((y) => y.id === p.id); if (x) { setName(x.name); setDirection(x.direction); } }).catch(() => {});
  }, [p.id, p.book, chapter, intro]);
  useEffect(load, [load]);
  const book = bookByCode(String(p.book));
  const paras = (txt: string) => txt.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => router.back()} color={c.textDark} />
        <View style={{ flex: 1 }}>
          <Text style={s.kicker} numberOfLines={1}>{name}</Text>
          <Text style={s.title} numberOfLines={1} accessibilityRole="header">{book?.name ?? p.book}{intro ? ` · ${t("deepStudy.introduction", { defaultValue: "Introduction" })}` : ` ${chapter}`}</Text>
        </View>
        {!intro ? <IconButton icon="layers-outline" accessibilityLabel={t("deepStudy.studyChapter", { defaultValue: "Study this chapter in Deep Study" })}
          onPress={() => router.push({ pathname: "/deep-study", params: { book: String(p.book), chapter: String(chapter), tab: "commentaries" } } as any)} color={c.textDark} /> : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }}>
        {!d || error ? <StudyState loading={!d && !error} error={error} onRetry={load} /> : (
          <>
            <StudyState offline={(d as { offline?: boolean }).offline} />
            {"covered" in d && d.covered === false ? <StudyState empty={t("deepStudy.notCovered", { defaultValue: "Doesn't cover this book or chapter." })} /> : null}
            {d.introduction ? (
              <View style={s.card}>
                {!intro ? <SectionTitle>{t("deepStudy.chapterIntro", { defaultValue: "Chapter introduction" })}</SectionTitle> : null}
                {paras(d.introduction).map((x, i) => <Text key={i} style={[s.text, { writingDirection: direction }]}>{x}</Text>)}
              </View>
            ) : intro ? <StudyState empty={t("deepStudy.noIntro", { defaultValue: "This commentary has no introduction to this book." })} /> : null}
            {"sections" in d && d.sections?.map((sec) => (
              <View key={sec.start} style={s.card}>
                <SectionTitle>{chapter}:{sec.start}{sec.end && sec.end > sec.start ? `–${sec.end}` : ""}</SectionTitle>
                {sec.paragraphs.map((x, i) => <Text key={i} style={[s.text, { writingDirection: direction }]}>{x}</Text>)}
                <AppButton label={t("deepStudy.studyVerses", { defaultValue: "Study these verses" })} variant="tertiary" size="sm"
                  onPress={() => router.push({ pathname: "/deep-study", params: { book: String(p.book), chapter: String(chapter), v: String(sec.start), ve: String(sec.end ?? sec.start) } } as any)} />
              </View>
            ))}
            <Attribution credit={d.credit} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 8, paddingBottom: 6 },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    title: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    card: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    text: { fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 23 },
  });
}
