import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import ReadableText from "@/components/ReadableText";

import { useSheetWidth } from "@/hooks/useLayout";
import { AppButton } from "@/components/ui";
interface GrainExplanationSheetProps {
  visible: boolean;
  onClose: () => void;
  count: number;
  displayName: string;
}

export function GrainExplanationSheet({ visible, onClose, count, displayName }: GrainExplanationSheetProps) {
  const sheetWidth = useSheetWidth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity accessibilityRole="button" style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.sheet, sheetWidth]}>
          <Text style={styles.title}>🌾 {count} Grain · {count === 1 ? "1 person" : `${count} people`} invited</Text>
          <Text style={styles.verse}>
            "Unless a grain of wheat falls into the earth and dies, it remains alone — but if it dies, it bears much fruit."
          </Text>
          <ReadableText style={styles.verseRef}>— John 12:24</ReadableText>
          <Text style={styles.body}>
            {displayName} has invited {count === 1 ? "1 person" : `${count} people`} to P2P Global Kingdom School.
          </Text>
          <Text style={styles.body}>
            Each grain represents one person who joined through their invitation.
          </Text>
          <AppButton label="Got it" onPress={onClose} style={{ marginTop: 16 }} />
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
      // Width follows the window: full width when narrow, a centered
      // panel of at most 600pt once tablet-wide (useSheetWidth).
      width: "100%", alignSelf: "center",
    },
    title: { fontSize: 17, fontWeight: "700", color: c.textDark, marginBottom: 16, fontFamily: "Inter_700Bold" },
    verse: { fontSize: 14, color: c.textMid, lineHeight: 20, fontStyle: "italic", fontFamily: "Inter_400Regular" },
    verseRef: { fontSize: 12, color: c.textMuted, marginTop: 6, marginBottom: 16, fontFamily: "Inter_400Regular" },
    body: { fontSize: 13, color: c.textMid, lineHeight: 19, marginBottom: 8, fontFamily: "Inter_400Regular" },
  });
}