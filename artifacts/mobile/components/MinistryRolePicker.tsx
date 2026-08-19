import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MinistryRole } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

export const MINISTRY_ROLE_OPTIONS: { key: MinistryRole; emoji: string; label: string; description: string }[] = [
  { key: "new_believer", emoji: "🌱", label: "New to faith", description: "I just started my journey with God" },
  { key: "believer", emoji: "📖", label: "Growing believer", description: "I have believed for a while and want to go deeper" },
  { key: "small_group_leader", emoji: "👥", label: "Small group leader", description: "I lead a home group, cell group, or fellowship" },
  { key: "pastor", emoji: "⛪", label: "Pastor or church leader", description: "I lead a local church or congregation" },
  { key: "bible_teacher", emoji: "🎓", label: "Bible teacher or minister", description: "I teach the Word in a ministry context" },
  { key: "missionary", emoji: "🌍", label: "Missionary or evangelist", description: "I serve in outreach and missions" },
];

export default function MinistryRolePicker({ value, onSelect }: { value: MinistryRole | null; onSelect: (role: MinistryRole) => void }) {
  return (
    <View style={styles.grid}>
      {MINISTRY_ROLE_OPTIONS.map((opt) => {
        const selected = value === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[styles.card, selected && styles.cardSelected]}
            onPress={() => onSelect(opt.key)}
            activeOpacity={0.85}
          >
            <Text style={styles.emoji}>{opt.emoji}</Text>
            <Text style={[styles.label, selected && styles.labelSelected]}>{opt.label}</Text>
            <Text style={[styles.description, selected && styles.descriptionSelected]}>{opt.description}</Text>
            {selected && (
              <View style={styles.checkmark}>
                <Ionicons name="checkmark" size={12} color={colors.cream} />
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center" },
  card: {
    width: "45%",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.borderBeige,
    padding: 14,
    alignItems: "center",
    gap: 4,
    position: "relative",
  },
  cardSelected: { backgroundColor: colors.accentGreen, borderColor: colors.primaryGreen },
  emoji: { fontSize: 26 },
  label: { fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  labelSelected: { color: colors.cream },
  description: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  descriptionSelected: { color: "rgba(255,255,255,0.85)" },
  checkmark: {
    position: "absolute", top: 8, right: 8, width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center",
  },
});