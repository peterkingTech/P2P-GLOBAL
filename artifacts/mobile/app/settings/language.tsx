import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { SUPPORTED_LANGUAGES, BIBLE_STUDY_LANGUAGES, LANGUAGE_DISPLAY } from "@/lib/i18n";

// Multilingual Expansion Stage 2 — generated directly from lib/i18n.ts's
// SUPPORTED_LANGUAGES/LANGUAGE_DISPLAY instead of a separately hardcoded
// list. Previously this array silently omitted hi/sw (which already had
// real i18next resources) — a language could be fully wired into the app
// and still be unreachable from Settings with no error. Generating it
// from the same source i18next itself uses makes that specific drift
// structurally impossible going forward.
const LANGUAGES = SUPPORTED_LANGUAGES.map((code) => ({ code, label: LANGUAGE_DISPLAY[code].native }));

// Stage 3 — Content (Bible Study) Language is a genuinely different list
// from App Language: it must never offer a language with no confirmed
// Bible source, regardless of whether that language's UI menus happen to
// be translated (zh/zh-TW are the concrete example — full UI translation,
// zero confirmed Bible translation). Previously this screen reused
// `LANGUAGES` for both pickers, which both over- and under-served users:
// it could offer zh/zh-TW for Bible study (no real Scripture behind it)
// while never offering some content languages that don't need UI
// translation to be a valid Bible Study Language choice.
const BIBLE_LANGUAGES = BIBLE_STUDY_LANGUAGES.map((code) => ({ code, label: LANGUAGE_DISPLAY[code].native }));

const DATE_FORMATS: { value: "DD.MM.YYYY" | "MM/DD/YYYY"; label: string; example: string }[] = [
  { value: "DD.MM.YYYY", label: "DD.MM.YYYY", example: "e.g. 25.12.1998" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY", example: "e.g. 12/25/1998" },
];

export default function LanguageSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [langPickerOpen, setLangPickerOpen] = useState<"app" | "content" | null>(null);

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
      Alert.alert("Couldn't save", err);
      return;
    }
    setLangPickerOpen(null);
  }

  async function setDateFormat(value: "DD.MM.YYYY" | "MM/DD/YYYY") {
    await updateProfile({ dateFormat: value });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Language and Region" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.linkRow} onPress={() => setLangPickerOpen("app")}>
            <View>
              <Text style={styles.fieldLabel}>App Language</Text>
              <Text style={styles.rowSub}>Changes the language of the app's interface</Text>
            </View>
            <View style={styles.linkRowRight}>
              <Text style={styles.linkRowValue}>{LANGUAGES.find((l) => l.code === profile?.appLanguage)?.label ?? "English"}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow, styles.linkRowLast]} onPress={() => setLangPickerOpen("content")}>
            <View>
              <Text style={styles.fieldLabel}>Content Language</Text>
              <Text style={styles.rowSub}>Changes the language curriculum is delivered in</Text>
            </View>
            <View style={styles.linkRowRight}>
              <Text style={styles.linkRowValue}>{BIBLE_LANGUAGES.find((l) => l.code === profile?.contentLanguage)?.label ?? "English"}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Date Format</Text>
        <View style={styles.card}>
          {DATE_FORMATS.map((f, i) => {
            const selected = (profile?.dateFormat ?? "DD.MM.YYYY") === f.value;
            return (
              <TouchableOpacity
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

      <Modal visible={!!langPickerOpen} animationType="slide" transparent onRequestClose={() => setLangPickerOpen(null)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{langPickerOpen === "app" ? "App Language" : "Content Language"}</Text>
              <TouchableOpacity onPress={() => setLangPickerOpen(null)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.textMid} />
              </TouchableOpacity>
            </View>
            {/* 39-language expansion: the App Language list grew from 7 to 34
                entries — the sheet's maxHeight (75%) was previously never
                reached with so few rows, so this was never wrapped in a
                scroll container. Without it, anything past the visible
                area would be unreachable with no indication more exists. */}
            <ScrollView showsVerticalScrollIndicator={false}>
              {(langPickerOpen === "app" ? LANGUAGES : BIBLE_LANGUAGES).map((l) => (
                <TouchableOpacity key={l.code} style={styles.optionRow} onPress={() => setLanguage(langPickerOpen!, l.code)}>
                  <Text style={styles.optionLabel}>{l.label}</Text>
                  {(langPickerOpen === "app" ? profile?.appLanguage : profile?.contentLanguage) === l.code && (
                    <Ionicons name="checkmark" size={18} color={colors.accentGreen} />
                  )}
                </TouchableOpacity>
              ))}
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
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "75%" },
    sheetHeader: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
    sheetTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    closeBtn: { padding: 4 },
    optionRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    optionLabel: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
  });
}