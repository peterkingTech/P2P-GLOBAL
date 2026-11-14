import React from "react";
import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import LanguageFlag from "@/components/language/LanguageFlag";
import { languageEntry } from "@/lib/languageRegistry";

// One language in a language list: its representative flag beside its name (native name first, the English
// name below when it differs), a check when chosen. The same row everywhere a language is chosen. The name
// is written in its own direction (Arabic, Hebrew, Persian, Urdu right to left); the row follows the app's
// layout direction. Colours come from the caller's theme.
export default function LanguageOption({ language, name, subtitle, selected, onPress, colors, accessibilityLabel, style }: {
  /** Any language ID the app uses (unchanged — the registry looks it up). */
  language: string;
  /** The name to show (defaults to the registry's native name). */
  name?: string;
  /** Second line (defaults to the English name when it differs from the native one). */
  subtitle?: string | null;
  selected?: boolean;
  onPress: () => void;
  colors: { text: string; muted: string; accent: string; selectedBg?: string };
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const e = languageEntry(language);
  const title = name ?? e?.native ?? language;
  const sub = subtitle === undefined ? (e && e.english && e.english !== title ? e.english : null) : subtitle;
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? (sub ? `${title}, ${sub}` : title)}
      style={[styles.row, selected && colors.selectedBg ? { backgroundColor: colors.selectedBg } : null, style]}>
      <LanguageFlag language={language} size={20} />
      <View style={{ flex: 1 }}>
        {/* Read in its own direction, but lined up with the other names ("left" follows the app's layout
            direction, so in a right-to-left app every name lines up on the right). */}
        <Text style={[styles.name, { color: colors.text, writingDirection: e?.rtl ? "rtl" : "ltr", textAlign: "left" }]} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={[styles.sub, { color: colors.muted }]} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={20} color={colors.accent} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 10, paddingHorizontal: 16 },
  name: { fontSize: 16, fontFamily: "Inter_500Medium" },
  sub: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 1 },
});
