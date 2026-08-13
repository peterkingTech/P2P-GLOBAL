import React, { useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

export type BadgeSize = "small" | "medium" | "large";

interface VerificationBadgeProps {
  isVerified: boolean;
  badgeVisible?: boolean;
  size?: BadgeSize;
  username?: string | null;
  verifiedAt?: string | null;
  style?: any;
}

const SIZES: Record<BadgeSize, { container: number; icon: number }> = {
  small: { container: 14, icon: 8 },
  medium: { container: 18, icon: 10 },
  large: { container: 24, icon: 14 },
};

export function VerificationBadge({
  isVerified,
  badgeVisible = true,
  size = "medium",
  username,
  verifiedAt,
  style,
}: VerificationBadgeProps) {
  const [explainOpen, setExplainOpen] = useState(false);
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  if (!isVerified || !badgeVisible) return null;
  const { container, icon } = SIZES[size];

  return (
    <>
      <TouchableOpacity
        onPress={() => setExplainOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[
          {
            width: container, height: container, borderRadius: container / 2,
            backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center",
            marginLeft: 4,
          },
          style,
        ]}
      >
        <Ionicons name="checkmark" size={icon} color="#fff" />
      </TouchableOpacity>

      <Modal visible={explainOpen} animationType="slide" transparent onRequestClose={() => setExplainOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setExplainOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHeaderRow}>
              <View style={styles.checkCircle}>
                <Ionicons name="checkmark" size={16} color="#fff" />
              </View>
              <Text style={styles.sheetTitle}>Identity Verified</Text>
            </View>
            <Text style={styles.sheetBody}>
              {username ? `@${username} has` : "This person has"} confirmed their identity on P2P Global through a verified selfie.
            </Text>
            <Text style={styles.sheetSubheading}>This means:</Text>
            <View style={styles.pointRow}>
              <Ionicons name="checkmark" size={14} color={colors.accentGreen} />
              <Text style={styles.pointText}>They are a real person</Text>
            </View>
            <View style={styles.pointRow}>
              <Ionicons name="checkmark" size={14} color={colors.accentGreen} />
              <Text style={styles.pointText}>Their profile photo matches their verification</Text>
            </View>
            <View style={styles.pointRow}>
              <Ionicons name="checkmark" size={14} color={colors.accentGreen} />
              <Text style={styles.pointText}>They have been reviewed by the P2P Global team</Text>
            </View>
            {verifiedAt && (
              <Text style={styles.verifiedSince}>
                Verified {new Date(verifiedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </Text>
            )}
            <TouchableOpacity style={styles.gotItBtn} onPress={() => setExplainOpen(false)}>
              <Text style={styles.gotItBtnText}>Got it</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: c.lightCream, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 36,
    },
    sheetHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
    checkCircle: {
      width: 28, height: 28, borderRadius: 14, backgroundColor: "#1D9E75",
      alignItems: "center", justifyContent: "center",
    },
    sheetTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    sheetBody: { fontSize: 14, color: c.textMid, lineHeight: 20, marginBottom: 16, fontFamily: "Inter_400Regular" },
    sheetSubheading: { fontSize: 13, fontWeight: "600", color: c.textDark, marginBottom: 8, fontFamily: "Inter_600SemiBold" },
    pointRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    pointText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular" },
    verifiedSince: { fontSize: 12, color: c.textMuted, marginTop: 8, fontFamily: "Inter_400Regular" },
    gotItBtn: { backgroundColor: c.accentGreen, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center", marginTop: 20 },
    gotItBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}