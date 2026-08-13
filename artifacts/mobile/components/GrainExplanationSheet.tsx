import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

interface GrainExplanationSheetProps {
  visible: boolean;
  onClose: () => void;
  count: number;
  displayName: string;
}

export function GrainExplanationSheet({ visible, onClose, count, displayName }: GrainExplanationSheetProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <Text style={styles.title}>🌾 {count} Grain · {count === 1 ? "1 person" : `${count} people`} invited</Text>
          <Text style={styles.verse}>
            "Unless a grain of wheat falls into the earth and dies, it remains alone — but if it dies, it bears much fruit."
          </Text>
          <Text style={styles.verseRef}>— John 12:24</Text>
          <Text style={styles.body}>
            {displayName} has invited {count === 1 ? "1 person" : `${count} people`} to P2P Global Kingdom School.
          </Text>
          <Text style={styles.body}>
            Each grain represents one person who joined through their invitation.
          </Text>
          <TouchableOpacity style={styles.gotItBtn} onPress={onClose}>
            <Text style={styles.gotItBtnText}>Got it</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: c.lightCream, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 36,
    },
    title: { fontSize: 17, fontWeight: "700", color: c.textDark, marginBottom: 16, fontFamily: "Inter_700Bold" },
    verse: { fontSize: 14, color: c.textMid, lineHeight: 20, fontStyle: "italic", fontFamily: "Inter_400Regular" },
    verseRef: { fontSize: 12, color: c.textMuted, marginTop: 6, marginBottom: 16, fontFamily: "Inter_400Regular" },
    body: { fontSize: 13, color: c.textMid, lineHeight: 19, marginBottom: 8, fontFamily: "Inter_400Regular" },
    gotItBtn: { backgroundColor: c.accentGreen, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center", marginTop: 16 },
    gotItBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}