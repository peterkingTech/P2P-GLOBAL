import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getLanguageName } from "@/lib/languageNames";
import type { BibleTranslation } from "@/lib/bibleReaderApi";

// Only translations our API.Bible plan is confirmed to license (the server
// lists nothing else), grouped by language.
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

export default function TranslationPicker({ visible, onClose, translations, current, onSelect, error, onRetry }: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const groups = useMemo(() => {
    const m = new Map<string, BibleTranslation[]>();
    for (const t of translations) m.set(t.language, [...(m.get(t.language) ?? []), t]);
    // The language being read first, then the others by name.
    const currentLang = translations.find((t) => t.code === current)?.language;
    return [...m.entries()].sort(([a], [b]) => (a === currentLang ? -1 : b === currentLang ? 1 : langName(a).localeCompare(langName(b))));
  }, [translations, current]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close translations">
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Translation</Text>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.textDark} />
            </TouchableOpacity>
          </View>
          {error ? (
            <View style={{ padding: 16, gap: 10 }}>
              <Text style={styles.muted}>{error}</Text>
              {onRetry && <TouchableOpacity onPress={onRetry} style={styles.retry} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></TouchableOpacity>}
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              {groups.map(([lang, list]) => (
                <View key={lang}>
                  <Text style={styles.group}>{langName(lang)}</Text>
                  {list.map((t) => {
                    const selected = t.code === current;
                    return (
                      <TouchableOpacity key={t.code} style={[styles.row, selected && styles.rowSelected]} onPress={() => onSelect(t.code)}
                        accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${t.name}, ${t.code}`}>
                        <View style={styles.abbr}><Text style={styles.abbrText}>{t.code}</Text></View>
                        <Text style={styles.name} numberOfLines={2}>{t.name}</Text>
                        {selected && <Ionicons name="checkmark" size={20} color={c.accentGreen} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
              <Text style={styles.foot}>More translations appear here once they're licensed for P2P Global.</Text>
            </ScrollView>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { maxHeight: "80%", backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 12 },
    header: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingTop: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    group: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 52 },
    rowSelected: { backgroundColor: c.card },
    abbr: { minWidth: 52, paddingHorizontal: 8, height: 28, borderRadius: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    abbrText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_700Bold" },
    name: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular" },
    retry: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
    retryText: { color: c.accentGreen, fontSize: 15, fontFamily: "Inter_600SemiBold" },
    foot: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", paddingHorizontal: 16, paddingTop: 16 },
  });
}
