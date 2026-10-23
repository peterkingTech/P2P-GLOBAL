import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, type TextStyle, type StyleProp } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { bibleRoute } from "@/lib/bibleReaderApi";
import { scriptureLinks, inlineScripture, type ScriptureLink } from "@/lib/storybook";

// Scripture in the storybook opens the existing P2P Bible — the same reader,
// licensed text source and route Core Curriculum lessons use. No translation
// is passed, so the reader opens in the peer's own chosen translation and
// theme; Back returns to the same place in the chapter (the chapter screen
// stays mounted underneath, scroll position and all).
function useOpen() {
  const router = useRouter();
  return (t: NonNullable<ScriptureLink["target"]>) => router.push(bibleRoute(t) as any);
}

/** A chapter's Scripture line as tappable references. Unrecognised parts stay plain text. */
export function ScriptureChips({ line, label = "Scripture" }: { line: string | null | undefined; label?: string }) {
  const { colors: c } = useTheme();
  const open = useOpen();
  const links = scriptureLinks(line);
  if (!links.length) return null;
  return (
    <View style={styles.row} accessibilityRole="list" accessibilityLabel={label}>
      <Ionicons name="book" size={14} color={c.accentGreen} style={{ marginTop: 6 }} />
      <View style={styles.chips}>
        {links.map((l, i) => l.target ? (
          <TouchableOpacity key={i} onPress={() => open(l.target!)} style={[styles.chip, { borderColor: c.accentGreen }]}
            accessibilityRole="link" accessibilityLabel={`${l.label}. Opens in the P2P Bible`}>
            <Text style={[styles.chipText, { color: c.accentGreen }]}>{l.label}</Text>
          </TouchableOpacity>
        ) : (
          <Text key={i} style={[styles.plain, { color: c.textMid }]}>{l.label}</Text>
        ))}
      </View>
    </View>
  );
}

/** A paragraph whose verified Scripture references (e.g. "Hebrews 11:31") open the P2P Bible. */
export function ScriptureText({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  const { colors: c } = useTheme();
  const open = useOpen();
  const runs = inlineScripture(text);
  return (
    <Text style={style}>
      {runs.map((r, i) => r.target ? (
        <Text key={i} onPress={() => open(r.target!)} style={{ color: c.accentGreen, textDecorationLine: "underline" }}
          accessibilityRole="link" accessibilityLabel={`${r.text}. Opens in the P2P Bible`}>{r.text}</Text>
      ) : r.text)}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, minHeight: 28, justifyContent: "center" },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  plain: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 5 },
});
