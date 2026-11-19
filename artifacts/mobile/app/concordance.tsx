import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import { StudyState } from "@/components/study/StudyUI";
import { SCRIPTURE_FONT, bibleRoute, getTranslations, searchBible, type BibleTranslation, type SearchResult } from "@/lib/bibleReaderApi";
import { loadPosition } from "@/lib/bibleReadingPrefs";
import { dictionarySearch, type DictTermSummary } from "@/lib/deepStudyApi";
import { isNetworkError } from "@/lib/offline";

// CONCORDANCE (owner brief 2026-11-18 §5). Type a word → every verse that contains it, in BIBLE ORDER (Genesis
// to Revelation), with the total count, Old/New Testament filter, the word highlighted and "Load more" — the
// classic concordance. Underneath: the Greek and Hebrew words whose meaning matches, each opening its own list
// of every occurrence in the original languages (STEPBible / BSB interlinear). Counts are labelled honestly:
// an English word in one translation is not the same as an original-language word.
// Uses the person's translation when it supports word search; otherwise a searchable licensed translation
// (KJV preferred), and says so.
type Scope = "all" | "ot" | "nt";
const PAGE = 50;

export default function ConcordanceScreen() {
  const p = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [q, setQ] = useState(p.q ? String(p.q) : "");
  const [word, setWord] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const [trans, setTrans] = useState<{ code: string; name: string; fallback: boolean } | null>(null);
  const [items, setItems] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState<DictTermSummary[]>([]);
  const run = useRef(0);

  // The translation to search: the reader's own if it supports word search, else KJV / another licensed one.
  useEffect(() => {
    Promise.all([loadPosition().catch(() => null), getTranslations().catch(() => ({ translations: [] as BibleTranslation[] }))]).then(([pos, list]) => {
      const all = list.translations;
      const searchable = all.filter((x) => x.provider !== "helloao" && x.provider !== "youversion" && !x.preview);
      const mine = searchable.find((x) => x.code === pos?.translation);
      const pick = mine ?? searchable.find((x) => /^KJV$/i.test(x.abbreviation ?? x.code)) ?? searchable.find((x) => x.language?.startsWith("en")) ?? searchable[0];
      if (pick) setTrans({ code: pick.code, name: pick.name, fallback: !mine });
    });
  }, []);

  const load = useCallback(async (w: string, sc: Scope, offset: number) => {
    if (!trans) return;
    const id = ++run.current;
    setLoading(true); setError(null);
    try {
      const r = await searchBible(w, trans.code, offset, undefined, { order: "canonical", testament: sc === "all" ? null : sc, limit: PAGE });
      if (id !== run.current) return;
      if (r.kind === "reference") { setError(t("concordance.isReference", { defaultValue: "That looks like a Bible reference. Type a word to find every verse that uses it." })); setItems([]); setTotal(0); return; }
      setItems((cur) => (offset ? [...cur, ...r.results] : r.results));
      setTotal(r.total);
    } catch (e: any) {
      if (id === run.current) setError(isNetworkError(e) ? t("concordance.needsInternet", { defaultValue: "The concordance needs an internet connection." }) : e?.message ?? "");
    } finally { if (id === run.current) setLoading(false); }
  }, [trans, t]);

  const submit = (text = q) => {
    const w = text.trim();
    if (w.length < 2) return;
    setWord(w); setItems([]); setTotal(null);
    void load(w, scope, 0);
    dictionarySearch(w).then((r) => setTerms(r.items.filter((x): x is DictTermSummary & { rank: number; matched: string } => x.type === "term").slice(0, 8))).catch(() => setTerms([]));
  };
  useEffect(() => { if (p.q && trans && !word) submit(String(p.q)); }, [trans]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeScope = (sc: Scope) => { setScope(sc); if (word) { setItems([]); setTotal(null); void load(word, sc, 0); } };

  // Highlight every whole-word occurrence (case-insensitive) in the verse text.
  const highlighted = (text: string) => {
    if (!word) return text;
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(\\b${esc}\\w*)`, "gi"));
    return parts.map((part, i) => (i % 2 === 1 ? <Text key={i} style={s.hit}>{part}</Text> : part));
  };

  return (
    <>
      <Stack.Screen options={{ title: t("concordance.title", { defaultValue: "Concordance" }) }} />
      <FlatList
        style={s.root}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 40, maxWidth: 820, width: "100%", alignSelf: "center" }}
        data={items}
        keyExtractor={(x, i) => `${x.reference}-${i}`}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <Text style={s.intro}>{t("concordance.intro", { defaultValue: "Find every verse that uses a word, in Bible order from Genesis to Revelation." })}</Text>
            <View style={s.searchRow}>
              <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => submit()} returnKeyType="search" style={s.input} autoCapitalize="none"
                placeholder={t("concordance.placeholder", { defaultValue: "A word, e.g. grace, shepherd, faith" })} placeholderTextColor={c.textMuted}
                accessibilityLabel={t("concordance.inputLabel", { defaultValue: "Word to find" })} />
              <AppButton label={t("concordance.find", { defaultValue: "Find" })} icon="search" onPress={() => submit()} disabled={q.trim().length < 2 || !trans} />
            </View>
            <ChipRow accessibilityLabel={t("concordance.scope", { defaultValue: "Where to look" })} single>
              {(["all", "ot", "nt"] as Scope[]).map((sc) => (
                <FilterChip key={sc} selection="single" selected={scope === sc} onPress={() => changeScope(sc)}
                  label={sc === "all" ? t("concordance.all", { defaultValue: "Whole Bible" }) : sc === "ot" ? t("concordance.ot", { defaultValue: "Old Testament" }) : t("concordance.nt", { defaultValue: "New Testament" })} />
              ))}
            </ChipRow>
            {trans ? <Text style={s.note}>{trans.fallback
              ? t("concordance.fallback", { defaultValue: "Searching the {{name}}: your translation doesn't support word search yet.", name: trans.name })
              : t("concordance.searching", { defaultValue: "Searching the {{name}}.", name: trans.name })}</Text> : null}
            {word && total !== null ? (
              <Text style={s.count} accessibilityLiveRegion="polite">
                {t("concordance.count", { defaultValue: "“{{word}}” appears in {{count}} verses", word, count: total })}
                {scope !== "all" ? ` · ${scope === "ot" ? t("concordance.ot", { defaultValue: "Old Testament" }) : t("concordance.nt", { defaultValue: "New Testament" })}` : ""}
              </Text>
            ) : null}
            {terms.length ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>{t("concordance.original", { defaultValue: "In Greek and Hebrew" })}</Text>
                <Text style={s.note}>{t("concordance.originalNote", { defaultValue: "Original-language words with this meaning. Each one lists every verse where that word itself is used." })}</Text>
                {terms.map((w) => (
                  <TouchableOpacity key={w.key} style={s.term} accessibilityRole="link" onPress={() => router.push({ pathname: "/dictionary/term/[key]", params: { key: w.key } } as any)}>
                    <Text style={s.termTitle}>{w.display}</Text>
                    <Text style={s.note}>{w.languages.map((l) => `${l.language === "hebrew" ? "Hebrew" : l.language === "greek" ? "Greek" : l.language} ${l.count}`).join(" · ")}{w.preview[0] ? ` · ${w.preview.map((x) => x.lemma).slice(0, 3).join(", ")}` : ""}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <StudyState loading={loading && !items.length} error={error} onRetry={() => word && load(word, scope, 0)}
              empty={word && total === 0 && !loading && !error ? t("concordance.none", { defaultValue: "No verses use that word in this translation. Try another form of the word." }) : null} />
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} accessibilityRole="link" onPress={() => router.push(bibleRoute({ book: item.bookCode, chapter: item.chapter, v: item.verse, ve: item.verse, translation: trans?.code }) as any)}
            accessibilityLabel={`${item.reference}. ${item.text}`}>
            <Text style={s.ref}>{item.reference}</Text>
            <Text style={s.verse}>{highlighted(item.text)}</Text>
          </TouchableOpacity>
        )}
        ListFooterComponent={total !== null && items.length < total && !error ? (
          <AppButton label={t("concordance.more", { defaultValue: "Load more ({{shown}} of {{total}})", shown: items.length, total })} variant="secondary" loading={loading}
            onPress={() => word && load(word, scope, items.length)} style={{ marginTop: 8 }} />
        ) : null}
      />
    </>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.lightCream },
  intro: { color: c.textMid, fontSize: 15, lineHeight: 21 },
  searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: c.textDark, backgroundColor: c.card },
  note: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
  count: { color: c.textDark, fontSize: 16, fontWeight: "700" },
  card: { backgroundColor: c.card, borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: c.borderBeige },
  cardTitle: { color: c.textDark, fontSize: 16, fontWeight: "700" },
  term: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.borderBeige, minHeight: 44 },
  termTitle: { color: c.accentGreen, fontSize: 15, fontWeight: "700" },
  row: { backgroundColor: c.card, borderRadius: 12, padding: 12, gap: 4, borderWidth: 1, borderColor: c.borderBeige },
  ref: { color: c.accentGreen, fontSize: 14, fontWeight: "700" },
  verse: { color: c.textDark, fontSize: 16, lineHeight: 24, fontFamily: SCRIPTURE_FONT },
  hit: { fontWeight: "700", backgroundColor: c.brightYellow, color: "#111318" },
});
