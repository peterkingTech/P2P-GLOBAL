import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "pt", label: "Português" },
  { code: "zh", label: "中文" },
  { code: "ar", label: "العربية" },
];

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

  async function setLanguage(kind: "app" | "content", code: string) {
    setLangPickerOpen(null);
    await updateProfile(kind === "app" ? { appLanguage: code } : { contentLanguage: code });
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
              <Text style={styles.linkRowValue}>{LANGUAGES.find((l) => l.code === profile?.contentLanguage)?.label ?? "English"}</Text>
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
            {LANGUAGES.map((l) => (
              <TouchableOpacity key={l.code} style={styles.optionRow} onPress={() => setLanguage(langPickerOpen!, l.code)}>
                <Text style={styles.optionLabel}>{l.label}</Text>
                {(langPickerOpen === "app" ? profile?.appLanguage : profile?.contentLanguage) === l.code && (
                  <Ionicons name="checkmark" size={18} color={colors.accentGreen} />
                )}
              </TouchableOpacity>
            ))}
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