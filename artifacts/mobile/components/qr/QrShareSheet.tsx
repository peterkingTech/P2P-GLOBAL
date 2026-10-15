import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet, Share, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useSheetWidth } from "@/hooks/useLayout";
import type { QrSpec } from "@/lib/qrLinks";

interface Props {
  spec: QrSpec | null;
  visible: boolean;
  onClose(): void;
}

// One QR presentation for profiles, Circles and app sharing (lib/qrLinks.ts
// decides what goes in each code). The code is always black on white with a
// quiet zone and medium error correction, and nothing is drawn over it, so it
// scans in any theme. "Enlarge" fills the screen for scanning across a room.
// Copy and Share send the same link the code contains.
export function QrShareSheet({ spec, visible, onClose }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const sheetWidth = useSheetWidth();
  const { width, height } = useWindowDimensions();
  const [enlarged, setEnlarged] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (!visible) { setEnlarged(false); setCopied(false); } }, [visible]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (!spec) return null;
  const size = enlarged ? Math.min(width - 48, height - 260, 420) : Math.min(width - 120, 240);

  async function copy() {
    if (!spec) return;
    try { await Clipboard.setStringAsync(spec.url); setCopied(true); } catch { /* clipboard unavailable */ }
  }
  async function share() {
    if (!spec) return;
    try { await Share.share({ title: spec.title, message: spec.shareMessage }); } catch { /* dismissed */ }
  }

  const code = (
    <View style={styles.qrCard} accessible accessibilityRole="image" accessibilityLabel={`QR code. ${spec.caption}`}>
      <QRCode value={spec.url} size={size} color="#000000" backgroundColor="#FFFFFF" ecl="M" quietZone={12} />
    </View>
  );

  return (
    <Modal visible={visible} transparent={!enlarged} animationType="slide" onRequestClose={enlarged ? () => setEnlarged(false) : onClose}>
      {enlarged ? (
        <View style={[styles.full, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.fullTitle} numberOfLines={2}>{spec.title}</Text>
          <Text style={styles.caption}>{spec.caption}</Text>
          <View style={styles.fullCode}>{code}</View>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setEnlarged(false)} accessibilityRole="button" accessibilityLabel="Make the QR code smaller">
            <Ionicons name="contract-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.overlay}>
          <View style={[styles.sheet, sheetWidth, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>{spec.title}</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => setEnlarged(true)} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel="Enlarge QR code" accessibilityHint="Shows the code full screen for easier scanning">
              {code}
            </TouchableOpacity>
            <Text style={styles.caption}>{spec.caption}</Text>
            <Text style={styles.note}>{spec.note}</Text>
            <Text style={styles.link} numberOfLines={2} selectable>{spec.url}</Text>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.outlineBtn} onPress={() => setEnlarged(true)} accessibilityRole="button" accessibilityLabel="Enlarge QR code">
                <Ionicons name="expand-outline" size={16} color={colors.accentGreen} />
                <Text style={styles.outlineBtnText}>Enlarge</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.outlineBtn} onPress={copy} accessibilityRole="button" accessibilityLabel={copied ? "Link copied" : "Copy link"}>
                <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={colors.accentGreen} />
                <Text style={styles.outlineBtnText}>{copied ? "Copied" : "Copy link"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={share} accessibilityRole="button" accessibilityLabel="Share link">
                <Ionicons name="share-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}

export default QrShareSheet;

const makeStyles = (c: AppColors) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12, alignItems: "center", width: "100%", alignSelf: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 12 },
    title: { flex: 1, fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    closeBtn: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
    qrCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center" },
    caption: { fontSize: 15, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold", marginTop: 14, textAlign: "center" },
    note: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "center", lineHeight: 17, paddingHorizontal: 8 },
    link: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 10, textAlign: "center" },
    actions: { flexDirection: "row", gap: 8, marginTop: 16, width: "100%" },
    outlineBtn: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: c.accentGreen, borderRadius: 12 },
    outlineBtnText: { color: c.accentGreen, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
    primaryBtnSmall: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: c.accentGreen, borderRadius: 12 },
    primaryBtn: { minHeight: 48, minWidth: 160, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: c.accentGreen, borderRadius: 14, paddingHorizontal: 24 },
    primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
    full: { flex: 1, backgroundColor: c.lightCream, alignItems: "center", paddingHorizontal: 16 },
    fullTitle: { fontSize: 20, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    fullCode: { flex: 1, alignItems: "center", justifyContent: "center" },
  });
