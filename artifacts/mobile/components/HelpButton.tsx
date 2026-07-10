import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const CRISIS_RESOURCES = [
  { label: "Call a crisis line", value: "[INSERT REGIONAL CRISIS LINE]" },
  { label: "Text a crisis line", value: "[INSERT REGIONAL CRISIS TEXT LINE]" },
  { label: "Emergency services", value: "[INSERT LOCAL EMERGENCY NUMBER, e.g. 911 / 999 / 112]" },
];

export function HelpButton({ variant = "fab" }: { variant?: "fab" | "inline" }) {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const { submitHelpRequest } = useData();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  if (!isAuthenticated) return null;

  async function handlePress() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setOpen(true);
    setSent(false);
    const err = await submitHelpRequest({ tier: "crisis" });
    setSent(!err);
  }

  return (
    <>
      <TouchableOpacity
        style={variant === "fab" ? [styles.fab, { bottom: insets.bottom + (Platform.OS === "web" ? 24 : 90) }] : styles.inlineBtn}
        onPress={handlePress}
        activeOpacity={0.85}
        accessibilityLabel="I need help now"
      >
        <Ionicons name="heart" size={variant === "fab" ? 22 : 20} color={variant === "fab" ? "#fff" : "#B91C1C"} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHeader}>
              <Ionicons name="heart" size={22} color="#B91C1C" />
              <Text style={styles.sheetTitle}>You are not alone</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.textMid} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetBody}>
                If you are in immediate danger or crisis, please reach out right now:
              </Text>
              {CRISIS_RESOURCES.map((r) => (
                <View key={r.label} style={styles.resourceRow}>
                  <Text style={styles.resourceLabel}>{r.label}</Text>
                  <Text style={styles.resourceValue}>{r.value}</Text>
                </View>
              ))}
              <Text style={styles.disclaimer}>
                These are placeholders. Real, region-appropriate crisis line numbers must be
                added before this app launches to real users.
              </Text>
              <Text style={styles.statusText}>
                {sent
                  ? "A crisis responder from our team has also been notified and will reach out to you directly."
                  : "Notifying a crisis responder..."}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  inlineBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(185,28,28,0.1)",
    borderWidth: 1, borderColor: "rgba(185,28,28,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  fab: {
    position: "absolute",
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#B91C1C",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.lightCream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: "80%",
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  closeBtn: { padding: 4 },
  sheetBody: { fontSize: 14, color: colors.textMid, lineHeight: 20, marginBottom: 16, fontFamily: "Inter_400Regular" },
  resourceRow: {
    backgroundColor: "rgba(185,28,28,0.06)",
    borderWidth: 1, borderColor: "rgba(185,28,28,0.2)",
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  resourceLabel: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  resourceValue: { fontSize: 14, color: "#B91C1C", fontWeight: "700", marginTop: 4, fontFamily: "Inter_700Bold" },
  disclaimer: { fontSize: 12, color: colors.textMuted, marginTop: 8, fontStyle: "italic", fontFamily: "Inter_400Regular" },
  statusText: { fontSize: 13, color: colors.accentGreen, marginTop: 16, fontFamily: "Inter_500Medium" },
});
