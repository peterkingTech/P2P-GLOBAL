import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { FruitCatalogEntry, EarnedFruit } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const CATEGORY_LABEL: Record<string, string> = {
  personal_growth: "Personal Growth",
  faithfulness: "Faithfulness",
  multiplication: "Multiplication",
  community: "Community",
  special: "Special",
  legendary: "Legendary",
  kingdom_influence: "Kingdom Influence",
};

interface FruitDetailCardProps {
  visible: boolean;
  catalogEntry: FruitCatalogEntry | null;
  earnedFruit: EarnedFruit | null;
  onClose: () => void;
}

export default function FruitDetailCard({ visible, catalogEntry, earnedFruit, onClose }: FruitDetailCardProps) {
  if (!catalogEntry) return null;
  const earnedDate = earnedFruit?.awardedAt
    ? new Date(earnedFruit.awardedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <View style={styles.iconWrap}>
            <Ionicons name={(catalogEntry.icon as keyof typeof Ionicons.glyphMap) || "leaf"} size={26} color={colors.accentGreen} />
          </View>
          <Text style={styles.name}>{catalogEntry.name}</Text>
          <Text style={styles.category}>{CATEGORY_LABEL[catalogEntry.category] ?? catalogEntry.category}</Text>
          <Text style={styles.description}>{catalogEntry.description}</Text>
          {catalogEntry.biblicalMeaning && (
            <Text style={styles.meaning}>{catalogEntry.biblicalMeaning}</Text>
          )}
          {catalogEntry.themeVerse && (
            <View style={styles.verseBlock}>
              <Text style={styles.verseText}>{catalogEntry.themeVerseText}</Text>
              <Text style={styles.verseRef}>{catalogEntry.themeVerse}</Text>
            </View>
          )}
          {earnedDate && <Text style={styles.earnedDate}>Earned {earnedDate}</Text>}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 30 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 22, width: "100%", maxWidth: 340, alignItems: "center", gap: 6 },
  iconWrap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(29,158,117,0.12)",
    alignItems: "center", justifyContent: "center", marginBottom: 6,
  },
  name: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  category: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  description: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  meaning: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "center", marginTop: 6, lineHeight: 18 },
  verseBlock: { marginTop: 10, alignItems: "center" },
  verseText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "center" },
  verseRef: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  earnedDate: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 10 },
  closeBtn: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 10, backgroundColor: colors.accentGreen },
  closeBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});