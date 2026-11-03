import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getLanguageName } from "@/lib/languageNames";
import type { BibleTranslation } from "@/lib/bibleReaderApi";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";

// Only translations the server allows: API.Bible ones our plan licenses, and
// Free Use Bible API (AO Lab) ones whose own licence has been approved —
// grouped by language. Search (name, abbreviation, language) and a language
// filter help with many translations. A translation offered by both sources
// shows where each comes from; choosing never changes the app's language.

interface Props {
  visible: boolean;
  onClose: () => void;
  translations: BibleTranslation[];
  current: string;
  onSelect: (code: string) => void;
  error?: string | null;
  onRetry?: () => void;
}

// The shared map leaves English out (it's the app default elsewhere).
const langName = (code: string) => (code === "en" ? "English" : getLanguageName(code));
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Translations matching a search across name, abbreviation, code and language. */
export function filterTranslations(list: BibleTranslation[], query: string, language: string | null): BibleTranslation[] {
  const q = norm(query.trim());
  return list.filter((t) => (!language || t.language === language)
    && (!q || [t.name, t.abbreviation ?? "", t.code, t.languageName ?? "", langName(t.language), t.language].some((x) => norm(x).includes(q))));
}

/** Names (or abbreviations) offered by more than one source — those rows say where they come from. */
export function sharedAcrossProviders(list: BibleTranslation[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const t of list) {
    const key = `${t.language}:${norm(t.abbreviation ?? t.code)}`;
    (seen.get(key) ?? seen.set(key, new Set()).get(key)!).add(t.provider ?? "api.bible");
  }
  return new Set([...seen.entries()].filter(([, p]) => p.size > 1).map(([k]) => k));
}

export default function TranslationPicker({ visible, onClose, translations, current, onSelect, error, onRetry }: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<string | null>(null);
  // The server names languages the app has no name for (e.g. Oromo, Lingala).
  const nameOf = useMemo(() => {
    const m = new Map(translations.filter((t) => t.languageName).map((t) => [t.language, t.languageName as string]));
    return (code: string) => m.get(code) ?? langName(code);
  }, [translations]);
  const languages = useMemo(() => [...new Set(translations.map((t) => t.language))].sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [translations, nameOf]);
  const shared = useMemo(() => sharedAcrossProviders(translations), [translations]);
  const groups = useMemo(() => {
    const m = new Map<string, BibleTranslation[]>();
    for (const t of filterTranslations(translations, query, language)) m.set(t.language, [...(m.get(t.language) ?? []), t]);
    // The language being read first, then the others by name.
    const currentLang = translations.find((t) => t.code === current)?.language;
    return [...m.entries()].sort(([a], [b]) => (a === currentLang ? -1 : b === currentLang ? 1 : nameOf(a).localeCompare(nameOf(b))));
  }, [translations, current, query, language, nameOf]);
  const many = translations.length > 8;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity accessibilityRole="button" style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close translations">
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Translation</Text>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} color={c.textDark} />
          </View>
          {error ? (
            <View style={{ padding: 16, gap: 10 }}>
              <Text style={styles.muted}>{error}</Text>
              {onRetry && <AppButton label="Try again" onPress={onRetry} variant="tertiary" style={{ alignSelf: "flex-start" }} />}
            </View>
          ) : (
            <>
              {many ? (
                <View style={{ paddingHorizontal: 16, gap: 8, paddingBottom: 4 }}>
                  <View style={styles.search}>
                    <Ionicons name="search" size={16} color={c.textMuted} />
                    <TextInput value={query} onChangeText={setQuery} placeholder="Search name, abbreviation or language" placeholderTextColor={c.textMuted}
                      style={styles.searchInput} accessibilityLabel="Search translations" autoCorrect={false} autoCapitalize="none" />
                    {query ? <IconButton icon="close-circle" size="sm" accessibilityLabel="Clear search" onPress={() => setQuery("")} color={c.textMuted} /> : null}
                  </View>
                  <ChipRow accessibilityLabel="Filter by language">
                    <FilterChip label="All languages" selected={!language} onPress={() => setLanguage(null)} />
                    {languages.map((l) => <FilterChip key={l} label={nameOf(l)} selected={language === l} onPress={() => setLanguage(language === l ? null : l)} />)}
                  </ChipRow>
                </View>
              ) : null}
              <ScrollView contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
                {!groups.length ? <Text style={[styles.muted, { padding: 16 }]}>No translation matches “{query}”.</Text> : null}
                {groups.map(([lang, list]) => (
                  <View key={lang}>
                    <Text style={styles.group}>{nameOf(lang)}</Text>
                    {list.map((t) => {
                      const selected = t.code === current;
                      const showSource = shared.has(`${t.language}:${norm(t.abbreviation ?? t.code)}`) || t.provider === "helloao";
                      return (
                        <TouchableOpacity key={t.code} style={[styles.row, selected && styles.rowSelected]} onPress={() => onSelect(t.code)}
                          accessibilityRole="radio" accessibilityState={{ selected }}
                          accessibilityLabel={`${t.name}, ${t.abbreviation ?? t.code}${showSource && t.providerName ? `, from ${t.providerName}` : ""}`}>
                          <View style={styles.abbr}><Text style={styles.abbrText}>{t.abbreviation ?? t.code}</Text></View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={[styles.name, t.textDirection === "rtl" && { writingDirection: "rtl" }]} numberOfLines={2}>{t.name}</Text>
                            {t.coverage && t.coverage !== "bible" && t.coverageLabel ? <Text style={styles.coverage}>{t.coverageLabel}</Text> : null}
                            {showSource && t.providerName ? <Text style={styles.source}>{t.providerName}{t.preview ? " · preview, licence not yet approved" : ""}</Text> : null}
                            {selected && t.attribution ? <Text style={styles.attribution} numberOfLines={3}>{t.attribution}</Text> : null}
                          </View>
                          {selected && <Ionicons name="checkmark" size={20} color={c.accentGreen} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
                <Text style={styles.foot}>More translations appear here once their licences are approved for P2P Global.</Text>
              </ScrollView>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { maxHeight: "85%", backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 12 },
    header: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingTop: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    searchInput: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular", paddingVertical: 8 },
    group: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 6, minHeight: 52 },
    rowSelected: { backgroundColor: c.card },
    abbr: { minWidth: 52, paddingHorizontal: 8, height: 28, borderRadius: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    abbrText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_700Bold" },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    source: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_500Medium" },
    coverage: { fontSize: 11.5, color: c.amber, fontFamily: "Inter_600SemiBold" },
    attribution: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 16 },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular" },
    foot: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", paddingHorizontal: 16, paddingTop: 16 },
  });
}
