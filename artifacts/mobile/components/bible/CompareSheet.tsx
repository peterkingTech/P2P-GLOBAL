import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getLanguageName } from "@/lib/languageNames";
import type { BibleTranslation } from "@/lib/bibleReaderApi";
import { MAX_TRANSLATIONS } from "@/lib/bibleCompare";
import { IconButton, AppButton } from "@/components/ui";

// Choose up to three more licensed translations to read beside the current
// one. Only translations the server lists can be chosen.
interface Props {
  visible: boolean;
  onClose: () => void;
  translations: BibleTranslation[];
  primary: string;
  selected: string[];
  onApply: (codes: string[]) => void;
}
const langName = (code: string) => (code === "en" ? "English" : getLanguageName(code));

export default function CompareSheet({ visible, onClose, translations, primary, selected, onApply }: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [picked, setPicked] = useState<string[]>(selected);
  useEffect(() => { if (visible) setPicked(selected); }, [visible, selected.join(",")]);
  const max = MAX_TRANSLATIONS - 1;
  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((x) => x !== code) : p.length >= max ? p : [...p, code]));
  const others = translations.filter((t) => t.code !== primary);
  const primaryT = translations.find((t) => t.code === primary);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity accessibilityRole="button" style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close compare">
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Compare translations</Text>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} color={c.textDark} />
          </View>
          <Text style={styles.sub}>Reading {primaryT ? `${primaryT.name} (${primary})` : primary}. Add up to {max} more to read the same verses side by side.</Text>
          <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
            {others.length === 0 ? <Text style={styles.sub}>No other translation is licensed for P2P Global yet.</Text> : others.map((t) => {
              const on = picked.includes(t.code);
              const full = !on && picked.length >= max;
              return (
                <TouchableOpacity key={t.code} style={[styles.row, on && styles.rowOn, full && { opacity: 0.45 }]} onPress={() => toggle(t.code)} disabled={full}
                  accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: full }} accessibilityLabel={`${t.name}, ${t.code}, ${langName(t.language)}`}>
                  <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? c.accentGreen : c.textMuted} />
                  <View style={styles.abbr}><Text style={styles.abbrText}>{t.code}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{t.name}</Text>
                    <Text style={styles.lang}>{langName(t.language)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={styles.actions}>
            {selected.length ? (
              <AppButton label="Stop comparing" onPress={() => onApply([])} variant="outline" accessibilityLabel="Stop comparing" />
            ) : null}
            <TouchableOpacity style={[styles.btn, !picked.length && { opacity: 0.5 }]} disabled={!picked.length} onPress={() => onApply(picked)} accessibilityRole="button"
              accessibilityLabel={picked.length ? `Compare ${picked.length + 1} translations` : "Choose a translation to compare"}>
              <Text style={styles.btnText}>{picked.length ? `Compare ${picked.length + 1}` : "Choose one"}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { maxHeight: "85%", backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 16 },
    header: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingTop: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    sub: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", paddingHorizontal: 16, paddingBottom: 8 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 56 },
    rowOn: { backgroundColor: c.card },
    abbr: { minWidth: 52, paddingHorizontal: 8, height: 28, borderRadius: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    abbrText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_700Bold" },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    lang: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, paddingHorizontal: 16, paddingTop: 10 },
    btn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    btnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  });
}
