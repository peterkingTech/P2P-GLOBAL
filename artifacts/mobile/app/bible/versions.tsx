import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, SectionList, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { BibleApiError, getTranslations, type BibleTranslation } from "@/lib/bibleReaderApi";
import { bibleLanguages, chooseTranslation, setVersionLanguage, versionLanguage, versionSections } from "@/lib/bibleVersions";
import { AppButton, FilterChip, IconButton } from "@/components/ui";

// Bible Versions (owner request 2026-11-09): every translation the server licenses for P2P Global, by
// language — search, All / Audio Available, a language chooser (Bible Languages screen). Choosing one
// goes Back to the reader, which opens it at the same book and chapter (lib/bibleVersions hand-off).
// The speaker icon appears only for licensed recorded audio; nothing here is assumed or hard-coded.
export default function BibleVersions() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { current } = useLocalSearchParams<{ current?: string }>();
  const [list, setList] = useState<BibleTranslation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);
  const [language, setLanguage] = useState<string | null>(versionLanguage());
  // The Bible Languages screen sets the language; pick it up when this screen is in front again.
  useFocusEffect(React.useCallback(() => { setLanguage(versionLanguage()); }, []));

  useEffect(() => {
    let live = true;
    setError(null);
    getTranslations().then((r) => { if (live) setList(r.translations); })
      .catch((e) => { if (live) setError(e instanceof BibleApiError ? e.message : "Couldn't load the Bible versions."); });
    return () => { live = false; };
  }, [attempt]);

  const languages = useMemo(() => bibleLanguages(list ?? []), [list]);
  const lang = languages.find((l) => l.code === language) ?? null;
  const sections = useMemo(() => versionSections(list ?? [], { query, language, audioOnly, current }).map((g) => ({ ...g, data: g.translations })), [list, query, language, audioOnly, current]);
  const anyAudio = (list ?? []).some((t) => t.recordedAudio === true);
  const total = sections.reduce((n, g) => n + g.data.length, 0);

  const pick = (code: string) => { chooseTranslation(code); router.back(); };

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">Bible Versions</Text>
      </View>

      <View style={s.controls}>
        <View style={s.search}>
          <Ionicons name="search" size={16} color={c.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search Versions" placeholderTextColor={c.textMuted} style={s.searchInput}
            accessibilityLabel="Search versions" autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
          {query ? <IconButton icon="close-circle" size="sm" accessibilityLabel="Clear search" onPress={() => setQuery("")} color={c.textMuted} /> : null}
        </View>
        <View style={s.filterRow}>
          <FilterChip label="All" selected={!audioOnly} onPress={() => setAudioOnly(false)} />
          <FilterChip label="Audio Available" selected={audioOnly} onPress={() => setAudioOnly(true)} />
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={s.langButton} onPress={() => router.push({ pathname: "/bible/languages", params: { current: current ?? "" } } as any)}
            accessibilityRole="button" accessibilityLabel={`Language: ${lang ? lang.native : "all languages"}. Choose a language`}>
            <Ionicons name="globe-outline" size={16} color={c.textDark} />
            <Text style={s.langButtonText} numberOfLines={1}>{lang ? lang.native : "All languages"}</Text>
            <Ionicons name="chevron-down" size={14} color={c.textMuted} />
          </TouchableOpacity>
        </View>
        {lang ? (
          <TouchableOpacity onPress={() => { setVersionLanguage(null); setLanguage(null); }} accessibilityRole="button" accessibilityLabel="Show all languages" style={s.clearLang}>
            <Text style={s.clearLangText}>Showing {lang.native} only · Show all languages</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? (
        <View style={s.center}>
          <Text style={s.muted}>{error}</Text>
          <AppButton label="Try again" variant="secondary" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : !list ? (
        <View style={s.center}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading versions" /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.code}
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name={audioOnly ? "volume-mute-outline" : "search-outline"} size={28} color={c.textMuted} />
              <Text style={s.emptyTitle}>{audioOnly ? "No recorded audio yet" : "No versions found"}</Text>
              <Text style={s.muted}>
                {audioOnly
                  ? anyAudio ? "None of the versions shown has licensed recorded audio available." : "No Bible version available to P2P Global has licensed recorded audio yet. Listen still reads any version aloud with your phone's voice."
                  : query ? `Nothing matches “${query}”.` : "No version is available in this language yet."}
              </Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>{section.language.native}</Text>
              {section.language.english ? <Text style={s.sectionSub}>{section.language.english}</Text> : null}
              <View style={{ flex: 1 }} />
              <Text style={s.sectionCount}>{section.data.length} {section.data.length === 1 ? "version" : "versions"}</Text>
            </View>
          )}
          renderItem={({ item: t }) => {
            const selected = t.code === current;
            const abbr = t.abbreviation ?? t.code;
            return (
              <TouchableOpacity style={[s.row, selected && s.rowSelected]} onPress={() => pick(t.code)} accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${t.name}, ${abbr}${t.recordedAudio ? ", recorded audio available" : ""}${selected ? ", currently reading" : ""}`}>
                <View style={[s.tile, selected && s.tileSelected]}>
                  <Text style={[s.tileText, selected && s.tileTextSelected]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{abbr}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[s.name, t.textDirection === "rtl" && { writingDirection: "rtl" }]} numberOfLines={2}>{t.name}</Text>
                  {selected ? <Text style={s.reading}>Currently reading</Text>
                    : t.coverage && t.coverage !== "bible" && t.coverageLabel ? <Text style={s.coverage}>{t.coverageLabel}</Text> : null}
                </View>
                {t.recordedAudio ? <Ionicons name="volume-high-outline" size={18} color={c.textMid} accessibilityElementsHidden /> : null}
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={total ? <Text style={s.foot}>More versions appear here once their licences are approved for P2P Global.</Text> : null}
        />
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
    filterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    langButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, maxWidth: 170, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    langButtonText: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
    clearLang: { alignSelf: "flex-start", paddingVertical: 2 },
    clearLangText: { fontSize: 12.5, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
    sectionHeader: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, backgroundColor: c.lightCream },
    sectionTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    sectionSub: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_500Medium" },
    sectionCount: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_500Medium" },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 60 },
    rowSelected: { backgroundColor: c.card },
    tile: { width: 56, height: 44, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
    tileSelected: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    tileText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_700Bold" },
    tileTextSelected: { color: "#fff" },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    reading: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    coverage: { fontSize: 12, color: c.amber, fontFamily: "Inter_600SemiBold" },
    empty: { alignItems: "center", gap: 8, padding: 32 },
    emptyTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
    foot: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", paddingHorizontal: 16, paddingTop: 16 },
  });
}
