import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { FONT_MAX, FONT_MIN, LINE_HEIGHT, type BibleReadingPrefs } from "@/lib/bibleReadingPrefs";
import { SCRIPTURE_FONT } from "@/lib/bibleReaderApi";

// Reading comfort for the Bible. Deliberately no light/dark switch here: the
// Bible always follows the P2P appearance setting.
interface Props {
  visible: boolean;
  prefs: BibleReadingPrefs;
  onChange: (patch: Partial<BibleReadingPrefs>) => void;
  onClose: () => void;
}

export default function ReadingPrefsSheet({ visible, prefs, onChange, onClose }: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const segmented = <K extends "lineSpacing" | "layout">(key: K, options: { value: BibleReadingPrefs[K]; label: string }[]) => (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = prefs[key] === o.value;
        return (
          <TouchableOpacity key={String(o.value)} style={[styles.segBtn, on && styles.segBtnOn]} onPress={() => onChange({ [key]: o.value } as Partial<BibleReadingPrefs>)}
            accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}>
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close reading settings">
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Reading settings</Text>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.textDark} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.preview, { fontSize: prefs.fontSize, lineHeight: Math.round(prefs.fontSize * LINE_HEIGHT[prefs.lineSpacing]) }]} numberOfLines={3}>
            In the beginning was the Word, and the Word was with God.
          </Text>

          <Text style={styles.label}>Text size</Text>
          <View style={styles.sizeRow}>
            <TouchableOpacity style={styles.sizeBtn} onPress={() => onChange({ fontSize: prefs.fontSize - 1 })} disabled={prefs.fontSize <= FONT_MIN}
              accessibilityRole="button" accessibilityLabel="Smaller text" accessibilityState={{ disabled: prefs.fontSize <= FONT_MIN }}>
              <Text style={[styles.sizeGlyph, { fontSize: 14 }, prefs.fontSize <= FONT_MIN && { opacity: 0.35 }]}>A</Text>
            </TouchableOpacity>
            <Text style={styles.sizeValue} accessibilityLiveRegion="polite">{prefs.fontSize}</Text>
            <TouchableOpacity style={styles.sizeBtn} onPress={() => onChange({ fontSize: prefs.fontSize + 1 })} disabled={prefs.fontSize >= FONT_MAX}
              accessibilityRole="button" accessibilityLabel="Larger text" accessibilityState={{ disabled: prefs.fontSize >= FONT_MAX }}>
              <Text style={[styles.sizeGlyph, { fontSize: 22 }, prefs.fontSize >= FONT_MAX && { opacity: 0.35 }]}>A</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Line spacing</Text>
          {segmented("lineSpacing", [{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }, { value: "relaxed", label: "Relaxed" }])}

          <Text style={styles.label}>Layout</Text>
          {segmented("layout", [{ value: "paragraphs", label: "Paragraphs" }, { value: "verses", label: "Verse by verse" }])}

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Verse numbers</Text>
            <Switch value={prefs.verseNumbers} onValueChange={(v) => onChange({ verseNumbers: v })} trackColor={{ true: c.accentGreen, false: c.borderBeige }}
              accessibilityLabel="Show verse numbers" />
          </View>

          <View style={styles.themeNote}>
            <Ionicons name="contrast-outline" size={14} color={c.textMuted} />
            <Text style={styles.themeNoteText}>Light and dark follow your P2P appearance setting.</Text>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32 },
    header: { flexDirection: "row", alignItems: "center" },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -8 },
    preview: { color: c.textDark, fontFamily: SCRIPTURE_FONT, backgroundColor: c.card, borderRadius: 12, padding: 14, marginTop: 6, marginBottom: 4 },
    label: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
    sizeRow: { flexDirection: "row", alignItems: "center", gap: 16 },
    sizeBtn: { width: 52, height: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, alignItems: "center", justifyContent: "center" },
    sizeGlyph: { color: c.textDark, fontFamily: SCRIPTURE_FONT },
    sizeValue: { minWidth: 32, textAlign: "center", fontSize: 16, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    segment: { flexDirection: "row", gap: 6 },
    segBtn: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center", backgroundColor: c.card },
    segBtnOn: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    segText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    segTextOn: { color: "#fff" },
    switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, minHeight: 44 },
    switchLabel: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    themeNote: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
    themeNoteText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", flex: 1 },
  });
}
