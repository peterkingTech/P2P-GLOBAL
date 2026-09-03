import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppStyle, resolveAppStyleColors } from "@/constants/appStyles";
import { useTheme } from "@/contexts/ThemeContext";

// A live mock of Home / Messages / Kingdom School / Profile using the
// tapped style's own resolved colors — never applies the style; only
// "Apply Style" does. Matches the App Style spec's preview requirement
// (nav, cards, buttons, text, selected states, example content).
export default function StylePreviewModal({
  style, visible, onCancel, onApply,
}: { style: AppStyle | null; visible: boolean; onCancel: () => void; onApply: () => void }) {
  const { resolvedMode } = useTheme();
  if (!style) return null;
  const c = resolveAppStyleColors(style, style.isExisting ? resolvedMode : resolvedMode);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.lightCream, borderColor: c.borderBeige }]}>
          <View style={styles.titleRow}>
            <Text style={styles.titleEmoji}>{style.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.textDark }]}>{style.name}</Text>
              <Text style={[styles.personality, { color: c.textMuted }]}>{style.description}</Text>
            </View>
          </View>

          {/* Mock nav bar */}
          <View style={[styles.navMock, { backgroundColor: c.navBg, borderColor: c.navBorder }]}>
            {[
              { icon: "home" as const, label: "Home", active: true },
              { icon: "chatbubbles" as const, label: "Messages", active: false },
              { icon: "book" as const, label: "Kingdom School", active: false },
              { icon: "person" as const, label: "Profile", active: false },
            ].map((t) => (
              <View key={t.label} style={styles.navItem}>
                <Ionicons name={t.icon} size={16} color={t.active ? c.accentGreen : c.textMutedLight} />
                <Text style={[styles.navLabel, { color: t.active ? c.accentGreen : c.textMutedLight }]} numberOfLines={1}>{t.label}</Text>
              </View>
            ))}
          </View>

          {/* Mock cards */}
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.borderBeige }]}>
            <View style={[styles.cardBadge, { backgroundColor: `${c.accentGreen}22` }]}>
              <Text style={{ fontSize: 16 }}>{style.illustrationAccent}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: c.textDark }]}>Sample Card</Text>
              <Text style={[styles.cardSub, { color: c.textMuted }]}>Progress and content preview</Text>
            </View>
            <View style={[styles.selectedChip, { backgroundColor: c.accentGreen }]}>
              <Ionicons name="checkmark" size={12} color="#fff" />
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.borderBeige }]}>
            <View style={[styles.cardBadge, { backgroundColor: `${c.primaryGreen}22` }]}>
              <Ionicons name="book-outline" size={16} color={c.primaryGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: c.textDark }]}>Kingdom School</Text>
              <Text style={[styles.cardSub, { color: c.textMuted }]}>4 modules · 17 lessons</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textMutedLight} />
          </View>

          {/* Mock button */}
          <TouchableOpacity style={[styles.mockBtn, { backgroundColor: c.primaryGreen }]} activeOpacity={1}>
            <Text style={styles.mockBtnText}>Sample Button</Text>
          </TouchableOpacity>

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.actionBtn, styles.cancelBtn, { borderColor: c.borderBeige }]} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel">
              <Text style={[styles.cancelText, { color: c.textMid }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.accentGreen }]} onPress={onApply} accessibilityRole="button" accessibilityLabel={`Apply ${style.name} style`}>
              <Text style={styles.applyText}>Apply Style</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  sheet: { width: "100%", maxWidth: 380, borderRadius: 22, borderWidth: 1, padding: 20, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  titleEmoji: { fontSize: 32 },
  title: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  personality: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  navMock: { flexDirection: "row", borderRadius: 14, borderWidth: 1, padding: 10, justifyContent: "space-around" },
  navItem: { alignItems: "center", gap: 3, flex: 1 },
  navLabel: { fontSize: 9, fontFamily: "Inter_500Medium" },
  card: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 12 },
  cardBadge: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  cardSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  selectedChip: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  mockBtn: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 },
  mockBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  actionBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cancelBtn: { borderWidth: 1, backgroundColor: "transparent" },
  cancelText: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  applyText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});