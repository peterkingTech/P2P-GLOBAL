import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";

export const CRISIS_RESOURCES = [
  { label: "Call a crisis line", value: "[INSERT REGIONAL CRISIS LINE]" },
  { label: "Text a crisis line", value: "[INSERT REGIONAL CRISIS TEXT LINE]" },
  { label: "Emergency services", value: "[INSERT LOCAL EMERGENCY NUMBER, e.g. 911 / 999 / 112]" },
];

export function CrisisResourcesModal({
  visible,
  onClose,
  statusText,
}: {
  visible: boolean;
  onClose: () => void;
  statusText: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.sheetHeader}>
            <Ionicons name="heart" size={22} color="#B91C1C" />
            <Text style={styles.sheetTitle}>You are not alone</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
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
            <Text style={styles.statusText}>{statusText}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
