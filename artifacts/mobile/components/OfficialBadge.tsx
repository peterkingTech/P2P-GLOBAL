import React, { useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

export type OfficialAccountType = "crisis_response" | "announcement" | "support" | "general";
export type BadgeSize = "small" | "medium";

interface OfficialBadgeProps {
  accountType: OfficialAccountType;
  size?: BadgeSize;
}

const BADGE_CONFIG: Record<OfficialAccountType, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  crisis_response: { icon: "shield-checkmark", color: "#1D9E75" },
  announcement: { icon: "megaphone", color: "#B8860B" },
  support: { icon: "help-circle", color: "#1D9E75" },
  general: { icon: "checkmark-circle", color: "#1D9E75" },
};

export function OfficialBadge({ accountType, size = "medium" }: OfficialBadgeProps) {
  const [explainOpen, setExplainOpen] = useState(false);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const config = BADGE_CONFIG[accountType];
  const iconSize = size === "small" ? 10 : 12;

  return (
    <>
      <TouchableOpacity
        onPress={() => setExplainOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[styles.badge, { backgroundColor: config.color }, size === "small" && styles.badgeSmall]}
      >
        <Ionicons name={config.icon} size={iconSize} color="#fff" />
        <Text style={[styles.badgeText, size === "small" && styles.badgeTextSmall]}>Official</Text>
      </TouchableOpacity>

      <Modal visible={explainOpen} animationType="slide" transparent onRequestClose={() => setExplainOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setExplainOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHeaderRow}>
              <View style={[styles.iconCircle, { backgroundColor: config.color }]}>
                <Ionicons name={config.icon} size={16} color="#fff" />
              </View>
              <Text style={styles.sheetTitle}>{accountType === "crisis_response" ? "Official Crisis Response Account" : "P2P Official Account"}</Text>
            </View>
            <Text style={styles.sheetBody}>
              This account is operated by the Amen Tech team. It is verified and trusted.
            </Text>
            <Text style={styles.sheetBody}>
              Messages from this account are genuine official communications from P2P Global.
            </Text>
            <Text style={styles.sheetWarning}>
              If you receive a message claiming to be from P2P Official from a different account — report it immediately using the three-dot menu.
            </Text>
            <TouchableOpacity style={styles.gotItBtn} onPress={() => setExplainOpen(false)}>
              <Text style={styles.gotItBtnText}>Got it</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export default OfficialBadge;

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    badge: {
      flexDirection: "row", alignItems: "center", gap: 3,
      borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4,
    },
    badgeSmall: { paddingHorizontal: 4 },
    badgeText: { color: "#fff", fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    badgeTextSmall: { fontSize: 9 },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: c.lightCream, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 36,
    },
    sheetHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
    iconCircle: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    sheetTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", flex: 1 },
    sheetBody: { fontSize: 14, color: c.textMid, lineHeight: 20, marginBottom: 12, fontFamily: "Inter_400Regular" },
    sheetWarning: { fontSize: 13, color: "#B91C1C", lineHeight: 19, marginBottom: 8, fontFamily: "Inter_500Medium" },
    gotItBtn: { backgroundColor: c.accentGreen, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center", marginTop: 20 },
    gotItBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}