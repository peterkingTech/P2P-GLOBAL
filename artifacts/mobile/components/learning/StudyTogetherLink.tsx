import React from "react";
import { TouchableOpacity, View, Text, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";

// The one way into the Study Together hub (app/study-together) from a learning
// or community area. The hub lists every shared study the person may open —
// from Kingdom Stories, Kingdom School, a Family Circle or a Church — so each
// area links to the same place instead of keeping its own list.
export default function StudyTogetherLink({ note = "Shared studies with your people, in one place", style }: { note?: string; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const p = { card: c.card, border: c.borderBeige, text: c.textDark, muted: c.textMuted, accent: c.accentGreen };
  return (
    <TouchableOpacity onPress={() => router.push("/study-together" as any)} activeOpacity={0.8}
      style={[styles.row, { borderColor: p.border, backgroundColor: p.card }, style]}
      accessibilityRole="button" accessibilityLabel={`Study Together. ${note}`}>
      <Ionicons name="people-outline" size={18} color={p.accent} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: p.text }]}>Study Together</Text>
        <Text style={[styles.note, { color: p.muted }]}>{note}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={p.muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  title: { fontSize: 14, fontFamily: "Inter_700Bold" },
  note: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
