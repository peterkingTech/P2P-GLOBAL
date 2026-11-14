import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal, Alert, TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import LanguageFlag from "@/components/language/LanguageFlag";
import LanguageOption from "@/components/language/LanguageOption";
import { languageMatches } from "@/lib/languageRegistry";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { SUPPORTED_LANGUAGES, LANGUAGE_DISPLAY } from "@/lib/i18n";

import { useSheetWidth } from "@/hooks/useLayout";
import { showAlert } from "@/lib/alerts";
// Multilingual Expansion Stage 2 — generated directly from lib/i18n.ts's
// SUPPORTED_LANGUAGES/LANGUAGE_DISPLAY instead of a separately hardcoded
// list. Previously this array silently omitted hi/sw (which already had
// real i18next resources) — a language could be fully wired into the app
// and still be unreachable from Settings with no error. Generating it
// from the same source i18next itself uses makes that specific drift
// structurally impossible going forward.
//
// Sorted A-Z by English name (LANGUAGE_DISPLAY[code].label), not the
// displayed native name — sorting by native script would scatter
// non-Latin entries unpredictably rather than producing a real A-Z order.
// Only the ORDER changes; the picker still displays the native name.
const LANGUAGES = SUPPORTED_LANGUAGES
  .map((code) => ({ code, label: LANGUAGE_DISPLAY[code].native }))
  .sort((a, b) => LANGUAGE_DISPLAY[a.code].label.localeCompare(LANGUAGE_DISPLAY[b.code].label));

// Content Language offers the SAME languages as App Language (owner decision 2026-11-14). It governs every
// kind of content except the Bible — lessons, plans, Kingdom Stories, Listen signposts — and each falls back
// to English where no translation exists yet. The Bible has its own language and version choice (Bible ›
// Languages / Versions) and never depends on this setting. (Before: only languages with a confirmed Bible
// translation, enforced by migration 155's trigger; migration 246 removes that trigger. Until 246 is
// applied, the database refuses such a language and this screen shows the error.)
const CONTENT_LANGUAGES = LANGUAGES;

const DATE_FORMATS: { value: "DD.MM.YYYY" | "MM/DD/YYYY"; label: string; example: string }[] = [
  { value: "DD.MM.YYYY", label: "DD.MM.YYYY", example: "e.g. 25.12.1998" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY", example: "e.g. 12/25/1998" },
];

export default function LanguageSettingsScreen() {
  const sheetWidth = useSheetWidth();
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [langPickerOpen, setLangPickerOpen] = useState<"app" | "content" | null>(null);
  const [query, setQuery] = useState("");
  const { t } = useTranslation();
  const pickerList = (langPickerOpen === "app" ? LANGUAGES : CONTENT_LANGUAGES).filter((l) => languageMatches(l.code, query));

  // Pre-integration audit finding: this used to close the picker before
  // the write even started and discarded updateProfile()'s result — once
  // migration 155's server-side Bible Study Language validation is live,
  // a rejected write (e.g. no confirmed Bible source for the selected
  // content language) would close the sheet as if it succeeded with zero
  // feedback. Mirrors the exact existing convention already used by
  // account.tsx/change-username.tsx (`const err = await updateProfile(...);
  // if (err) Alert.alert(...)`) rather than inventing a new pattern.
  async function setLanguage(kind: "app" | "content", code: string) {
    const err = await updateProfile(kind === "app" ? { appLanguage: code } : { contentLanguage: code });
    if (err) {
      showAlert("Couldn't save", err);
      return;
    }
    setLangPickerOpen(null);
    setQuery("");
  }

  async function setDateFormat(value: "DD.MM.YYYY" | "MM/DD/YYYY") {
    await updateProfile({ dateFormat: value });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Language and Region" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <TouchableOpacity accessibilityRole="button" style={styles.linkRow} onPress={() => setLangPickerOpen("app")}>
            <View>
              <Text style={styles.fieldLabel}>App Language</Text>
              <Text style={styles.rowSub}>Changes the language of the app's interface</Text>
            </View>
            <View style={styles.linkRowRight}>
              <LanguageFlag language={profile?.appLanguage ?? "en"} size={15} />
              <Text style={styles.linkRowValue}>{LANGUAGES.find((l) => l.code === profile?.appLanguage)?.label ?? "English"}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={[styles.linkRow, styles.linkRowLast]} onPress={() => setLangPickerOpen("content")}>
            <View>
              <Text style={styles.fieldLabel}>Content Language</Text>
              <Text style={styles.rowSub}>Changes the language curriculum is delivered in</Text>
            </View>
            <View style={styles.linkRowRight}>
              <LanguageFlag language={profile?.contentLanguage ?? "en"} size={15} />
              <Text style={styles.linkRowValue}>{CONTENT_LANGUAGES.find((l) => l.code === profile?.contentLanguage)?.label ?? "English"}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Date Format</Text>
        <View style={styles.card}>
          {DATE_FORMATS.map((f, i) => {
            const selected = (profile?.dateFormat ?? "DD.MM.YYYY") === f.value;
            return (
              <TouchableOpacity accessibilityRole="button"
                key={f.value}
                style={[styles.formatRow, i === DATE_FORMATS.length - 1 && styles.linkRowLast]}
                onPress={() => setDateFormat(f.value)}
              >
                <View>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  <Text style={styles.rowSub}>{f.example}</Text>
                </View>
                {selected && <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <Modal visible={!!langPickerOpen} animationType="slide" transparent onRequestClose={() => { setLangPickerOpen(null); setQuery(""); }}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, sheetWidth, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{langPickerOpen === "app" ? "App Language" : "Content Language"}</Text>
              <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" hitSlop={10} onPress={() => { setLangPickerOpen(null); setQuery(""); }} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.textMid} />
              </TouchableOpacity>
            </View>
            {/* 39-language expansion: the App Language list grew from 7 to 34
                entries — the sheet's maxHeight (75%) was previously never
                reached with so few rows, so this was never wrapped in a
                scroll container. Without it, anything past the visible
                area would be unreachable with no indication more exists. */}
            {/* Search by native name, English name, code or another name (lib/languageRegistry.ts). */}
            <TextInput value={query} onChangeText={setQuery} placeholder={t("languages.search", { defaultValue: "Search languages" })} placeholderTextColor={colors.textMuted}
              style={styles.search} accessibilityLabel={t("languages.search", { defaultValue: "Search languages" })} autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {pickerList.map((l) => (
                <LanguageOption key={l.code} language={l.code} name={l.label} style={styles.optionRow}
                  selected={(langPickerOpen === "app" ? profile?.appLanguage : profile?.contentLanguage) === l.code}
                  onPress={() => setLanguage(langPickerOpen!, l.code)}
                  colors={{ text: colors.textDark, muted: colors.textMuted, accent: colors.accentGreen }} />
              ))}
              {!pickerList.length ? <Text style={styles.noMatch}>{t("languages.noMatch", { defaultValue: "No language matches your search." })}</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    sectionTitle: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 24 },
    fieldLabel: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rowSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    linkRow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    formatRow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    linkRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
    linkRowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
    linkRowValue: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "75%", width: "100%", alignSelf: "center" },
    sheetHeader: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
    sheetTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    closeBtn: { padding: 4 },
    optionRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    optionLabel: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    search: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 12, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular", marginBottom: 8 },
    noMatch: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 20 },
  });
}