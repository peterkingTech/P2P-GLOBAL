import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, Switch, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { EMPHASIS, emphasisColor, type EmphasisCategory } from "@/lib/scriptureEmphasis";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { FONT_MAX, FONT_MIN, LINE_HEIGHT, type BibleReadingPrefs } from "@/lib/bibleReadingPrefs";
import { SCRIPTURE_FONT } from "@/lib/bibleReaderApi";
import { AppButton, IconButton } from "@/components/ui";

// Reading comfort for the Bible. Deliberately no light/dark switch here: the
// Bible always follows the P2P appearance setting.
interface Props {
  visible: boolean;
  prefs: BibleReadingPrefs;
  onChange: (patch: Partial<BibleReadingPrefs>) => void;
  onClose: () => void;
  /** Scripture emphasis: categories with published references, and whether this translation marks Jesus' words. */
  emphasisAvailable?: string[];
  jesusMarked?: boolean;
  /** "emphasis": open as the Scripture emphasis sheet only (its own menu item in the reader, 2026-11-18). */
  only?: "emphasis";
}

export default function ReadingPrefsSheet({ visible, prefs, onChange, onClose, emphasisAvailable = [], jesusMarked = false, only }: Props) {
  const emphasisOnly = only === "emphasis";
  const { colors: c, resolvedMode } = useTheme();
  const { t } = useTranslation();
  const on = new Set(prefs.emphasis);
  const toggle = (k: EmphasisCategory, v: boolean) => onChange({ emphasis: v ? [...prefs.emphasis.filter((x) => x !== k), k] : prefs.emphasis.filter((x) => x !== k) });
  // What each category can honestly show right now.
  const note = (k: EmphasisCategory) => k === "jesus"
    ? (jesusMarked ? null : t("bibleEmphasis.jesusNotMarked"))
    : (on.has(k) && !emphasisAvailable.includes(k) ? t("bibleEmphasis.notPublished") : null);
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
      <TouchableOpacity accessibilityRole="button" style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close reading settings">
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <ScrollView style={{ maxHeight: 640 }} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">{emphasisOnly ? t("bibleEmphasis.title") : "Reading settings"}</Text>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} color={c.textDark} style={{ marginRight: -8 }} />
          </View>
          {!emphasisOnly ? (<>

          <Text style={[styles.preview, { fontSize: prefs.fontSize, lineHeight: Math.round(prefs.fontSize * LINE_HEIGHT[prefs.lineSpacing]) }]} numberOfLines={3}>
            In the beginning was the Word, and the Word was with God.
          </Text>

          <Text style={styles.label}>Text size</Text>
          <View style={styles.sizeRow}>
            <AppButton label="A" onPress={() => onChange({ fontSize: prefs.fontSize - 1 })} variant="secondary" disabled={prefs.fontSize <= FONT_MIN} accessibilityLabel="Smaller text" style={{ width: 52 }} />
            <Text style={styles.sizeValue} accessibilityLiveRegion="polite">{prefs.fontSize}</Text>
            <AppButton label="A" onPress={() => onChange({ fontSize: prefs.fontSize + 1 })} variant="secondary" disabled={prefs.fontSize >= FONT_MAX} accessibilityLabel="Larger text" style={{ width: 52 }} />
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

          </>) : null}
          {/* Scripture emphasis (2026-11-18): independent categories, each with its legend colour. */}
          {!emphasisOnly ? <Text style={styles.label} accessibilityRole="header">{t("bibleEmphasis.title")}</Text> : null}
          <Text style={styles.themeNoteText}>{t("bibleEmphasis.intro")}</Text>
          {EMPHASIS.map((k) => {
            const n = note(k);
            return (
              <View key={k} style={styles.emRow}>
                <Text style={[styles.emDot, { color: emphasisColor(k, resolvedMode === "dark" ? "dark" : "light") }]} accessibilityElementsHidden importantForAccessibility="no">{"\u25CF"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switchLabel, { color: emphasisColor(k, resolvedMode === "dark" ? "dark" : "light") }]}>{t(`bibleEmphasis.cat.${k}`)}</Text>
                  {n ? <Text style={styles.themeNoteText}>{n}</Text> : null}
                </View>
                <Switch value={on.has(k)} onValueChange={(v) => toggle(k, v)} trackColor={{ true: c.accentGreen, false: c.borderBeige }}
                  accessibilityLabel={t("bibleEmphasis.toggle", { name: t(`bibleEmphasis.cat.${k}`) })} />
              </View>
            );
          })}
          <Text style={[styles.themeNoteText, { marginTop: 8 }]}>{t("bibleEmphasis.yourHighlights")}</Text>
          </ScrollView>
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
    preview: { color: c.textDark, fontFamily: SCRIPTURE_FONT, backgroundColor: c.card, borderRadius: 12, padding: 14, marginTop: 6, marginBottom: 4 },
    label: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
    sizeRow: { flexDirection: "row", alignItems: "center", gap: 16 },
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
    emRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
    emDot: { fontSize: 16, width: 18, textAlign: "center" },
  });
}
