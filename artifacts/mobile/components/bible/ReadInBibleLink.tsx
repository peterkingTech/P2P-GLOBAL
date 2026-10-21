import React from "react";
import { Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { readerTarget } from "@/lib/bibleReaderApi";
import { openScripture } from "@/lib/openScripture";

/**
 * A small "Read in Bible ›" link under a Scripture reference. Renders nothing
 * when the reference can't be opened (not Book Chapter[:Verse]). When shown
 * inside a Modal, pass `beforeOpen` to close it first — a Modal would
 * otherwise stay on top of the reader.
 */
export default function ReadInBibleLink({ reference, translation, label = "Read in Bible", color, style, beforeOpen }: {
  reference: string | null | undefined;
  translation?: string | null;
  label?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
  beforeOpen?: () => void;
}) {
  const { colors } = useTheme();
  if (!readerTarget(reference)) return null;
  const tint = color ?? colors.accentGreen;
  return (
    <TouchableOpacity
      style={[styles.link, style]}
      onPress={() => { beforeOpen?.(); openScripture(reference, translation); }}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${reference}`}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="book-outline" size={14} color={tint} />
      <Text style={[styles.text, { color: tint }]}>{label} ›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 32, marginTop: 6 },
  text: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
