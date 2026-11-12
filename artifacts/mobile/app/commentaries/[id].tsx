import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { Attribution, SectionTitle, StudyState } from "@/components/study/StudyUI";
import { commentaryDetail, type CommentaryBook, type CommentaryDetail } from "@/lib/deepStudyApi";

// One commentary: who wrote it, its licence, and the books and chapters it ACTUALLY covers (from its own
// book list — never assumed). Choose a book, then a chapter, to read it.
export default function CommentaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<CommentaryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<CommentaryBook | null>(null);
  const load = useCallback(() => { setError(null); commentaryDetail(String(id)).then(setD, (e) => setError(e?.message ?? "Couldn't load this commentary.")); }, [id]);
  useEffect(load, [load]);
  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("deepStudy.back", { defaultValue: "Back" })} onPress={() => (book ? setBook(null) : router.back())} color={c.textDark} />
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">{book ? `${d?.name ?? ""} · ${book.name}` : d?.name ?? t("deepStudy.commentaries", { defaultValue: "Commentaries" })}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }}>
        {!d || error ? <StudyState loading={!d && !error} error={error} onRetry={load} /> : !book ? (
          <>
            <View style={s.card}>
              <Text style={s.name}>{d.name}</Text>
              <Text style={s.meta}>{d.author}</Text>
              <Text style={s.meta}>{t("deepStudy.language", { defaultValue: "Language" })}: {d.language} · {d.credit.licence.name}</Text>
              <Text style={s.meta}>{d.books.length} {t("deepStudy.books", { defaultValue: "books" })} · {d.coverage.chapters ?? "?"} {t("deepStudy.chapters", { defaultValue: "chapters" })}</Text>
              {d.website ? <AppButton label={t("deepStudy.aboutSource", { defaultValue: "About this source" })} variant="tertiary" size="sm" icon="open-outline" onPress={() => Linking.openURL(d.website!).catch(() => {})} /> : null}
              <Attribution credit={d.credit} />
            </View>
            <SectionTitle>{t("deepStudy.chooseBook", { defaultValue: "Choose a book" })}</SectionTitle>
            <View style={s.grid}>
              {d.books.map((b) => (
                <TouchableOpacity key={b.id} style={s.bookBtn} onPress={() => setBook(b)} accessibilityRole="button" accessibilityLabel={`${b.name}, ${b.chapters} ${t("deepStudy.chapters", { defaultValue: "chapters" })}`}>
                  <Text style={s.bookText} numberOfLines={1}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <>
            {book.hasIntroduction ? <AppButton label={t("deepStudy.bookIntro", { defaultValue: "Introduction to the book" })} variant="secondary" icon="document-text-outline"
              onPress={() => router.push({ pathname: "/commentaries/read", params: { id: d.id, book: book.id, intro: "1" } } as any)} /> : null}
            <SectionTitle>{t("deepStudy.chooseChapter", { defaultValue: "Choose a chapter" })}</SectionTitle>
            <View style={s.grid}>
              {Array.from({ length: book.lastChapter - book.firstChapter + 1 }, (_, i) => book.firstChapter + i).map((n) => (
                <TouchableOpacity key={n} style={s.chapterBtn} onPress={() => router.push({ pathname: "/commentaries/read", params: { id: d.id, book: book.id, chapter: String(n) } } as any)}
                  accessibilityRole="button" accessibilityLabel={`${book.name} ${n}`}>
                  <Text style={s.bookText}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    card: { padding: 14, gap: 4, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    name: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    bookBtn: { width: "31%", minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    chapterBtn: { width: 56, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    bookText: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
