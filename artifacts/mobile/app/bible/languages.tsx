import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, SectionList, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import type { AppColors } from "@/constants/themes";
import { BibleApiError, getTranslations, type BibleTranslation } from "@/lib/bibleReaderApi";
import { bibleLanguages, filterLanguages, indexLetter, setVersionLanguage, suggestedLanguages, versionLanguage, type BibleLanguage } from "@/lib/bibleVersions";
import { AppButton, IconButton, SegmentedControl } from "@/components/ui";
import LanguageFlag from "@/components/language/LanguageFlag";

// Bible Languages (owner request 2026-11-09): the languages that have at least one licensed Bible
// version — Suggested (from what this person reads and their languages) and All (A–Z with an index).
// Native names first, English underneath. Choosing one goes Back to Bible Versions showing that language.
export default function BibleLanguages() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { i18n, t } = useTranslation();
  const { profile } = useAuth();
  const { current } = useLocalSearchParams<{ current?: string }>();
  const [list, setList] = useState<BibleTranslation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"suggested" | "all">("suggested");
  const selected = versionLanguage();
  const listRef = useRef<SectionList<BibleLanguage>>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    getTranslations().then((r) => { if (live) setList(r.translations); })
      .catch((e) => { if (live) setError(e instanceof BibleApiError ? e.message : "Couldn't load the Bible languages."); });
    return () => { live = false; };
  }, [attempt]);

  const all = useMemo(() => bibleLanguages(list ?? []), [list]);
  const suggested = useMemo(() => suggestedLanguages(all, {
    current: (list ?? []).find((t) => t.code === current)?.language, contentLanguage: profile?.contentLanguage, appLanguage: i18n.language,
  }), [all, list, current, profile?.contentLanguage, i18n.language]);
  // Searching always looks through every language.
  const shown = query.trim() ? filterLanguages(all, query) : tab === "suggested" ? suggested : all;
  const sections = useMemo(() => {
    if (tab === "suggested" && !query.trim()) return shown.length ? [{ key: "Suggested", data: shown }] : [];
    const by = new Map<string, BibleLanguage[]>();
    for (const l of shown) by.set(indexLetter(l.native), [...(by.get(indexLetter(l.native)) ?? []), l]);
    return [...by.entries()].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b))).map(([key, data]) => ({ key, data }));
  }, [shown, tab, query]);
  const letters = tab === "all" && !query.trim() ? sections.map((x) => x.key) : [];

  const pick = (code: string | null) => { setVersionLanguage(code); router.back(); };
  const jump = (i: number) => listRef.current?.scrollToLocation({ sectionIndex: i, itemIndex: 0, viewOffset: 0, animated: true });

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">Bible Languages</Text>
      </View>
      <View style={s.controls}>
        <View style={s.search}>
          <Ionicons name="search" size={16} color={c.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder={t("languages.search", { defaultValue: "Search languages" })} placeholderTextColor={c.textMuted} style={s.searchInput}
            accessibilityLabel={t("languages.search", { defaultValue: "Search languages" })} autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
          {query ? <IconButton icon="close-circle" size="sm" accessibilityLabel="Clear search" onPress={() => setQuery("")} color={c.textMuted} /> : null}
        </View>
        {!query.trim() ? (
          <SegmentedControl accessibilityLabel="Show" value={tab} onChange={(v) => setTab(v as "suggested" | "all")}
            options={[{ value: "suggested", label: "Suggested" }, { value: "all", label: `All (${all.length})` }]} />
        ) : null}
      </View>

      {error ? (
        <View style={s.center}><Text style={s.muted}>{error}</Text><AppButton label="Try again" variant="secondary" onPress={() => setAttempt((n) => n + 1)} /></View>
      ) : !list ? (
        <View style={s.center}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading languages" /></View>
      ) : (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <SectionList
            ref={listRef}
            style={{ flex: 1 }}
            sections={sections}
            keyExtractor={(l) => l.code}
            stickySectionHeadersEnabled
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            onScrollToIndexFailed={() => {}}
            ListHeaderComponent={!query.trim() ? (
              <TouchableOpacity style={[s.row, !selected && s.rowSelected]} onPress={() => pick(null)} accessibilityRole="radio" accessibilityState={{ selected: !selected }} accessibilityLabel="All languages">
                <View style={s.globe}><Ionicons name="globe-outline" size={20} color={c.accentGreen} /></View>
                <View style={{ flex: 1 }}><Text style={s.name}>All languages</Text><Text style={s.sub}>{(list ?? []).length} versions</Text></View>
                {!selected ? <Ionicons name="checkmark-circle" size={22} color={c.accentGreen} /> : null}
              </TouchableOpacity>
            ) : null}
            ListEmptyComponent={<Text style={[s.muted, { padding: 24 }]}>{query.trim() ? `No language matches “${query}”.` : "No suggestions yet — see All."}</Text>}
            renderSectionHeader={({ section }) => <Text style={s.sectionTitle}>{section.key}</Text>}
            renderItem={({ item: l }) => {
              const on = selected === l.code;
              return (
                <TouchableOpacity style={[s.row, on && s.rowSelected]} onPress={() => pick(l.code)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${l.native}${l.english ? `, ${l.english}` : ""}, ${l.count} ${l.count === 1 ? "version" : "versions"}${l.audio ? ", recorded audio available" : ""}`}>
                  <LanguageFlag language={l.code} size={22} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={s.name}>{l.native}</Text>
                    <Text style={s.sub}>{[l.english, `${l.count} ${l.count === 1 ? "version" : "versions"}`].filter(Boolean).join(" · ")}</Text>
                  </View>
                  {l.audio ? <Ionicons name="volume-high-outline" size={18} color={c.textMid} accessibilityElementsHidden /> : null}
                  {on ? <Ionicons name="checkmark-circle" size={22} color={c.accentGreen} /> : <Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
                </TouchableOpacity>
              );
            }}
          />
          {letters.length > 1 ? (
            <View style={s.index} accessibilityLabel="Jump to letter">
              {letters.map((L, i) => (
                <TouchableOpacity key={L} onPress={() => jump(i)} hitSlop={{ left: 10, right: 6 }} accessibilityRole="button" accessibilityLabel={`Jump to ${L}`} style={s.indexHit}>
                  <Text style={s.indexText}>{L}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { fontSize: 19, color: c.textDark, fontFamily: "Inter_700Bold" },
    controls: { paddingHorizontal: 16, gap: 10, paddingBottom: 8 },
    search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    searchInput: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular", paddingVertical: 8 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    sectionTitle: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, backgroundColor: c.lightCream },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 56 },
    rowSelected: { backgroundColor: c.card },
    globe: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    name: { fontSize: 16, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    sub: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular" },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    index: { width: 26, justifyContent: "center", alignItems: "center", paddingVertical: 8 },
    indexHit: { paddingVertical: 1, minWidth: 24, alignItems: "center" },
    indexText: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold" },
  });
}
