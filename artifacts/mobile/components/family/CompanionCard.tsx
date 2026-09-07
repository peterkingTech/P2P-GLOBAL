import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";

interface Props {
  name: string;
  isGuide: boolean;
  speaking: boolean;
  muted: boolean;
  praying: boolean;
  handUp: boolean;
  canModerate: boolean;
  onLongPress?: () => void;
  onHandUpPress?: () => void;
}

// One person in the Gathering — a soft, rounded card (not a thin
// avatar-only rail entry). "Speaking" is a subtle border tint, not an
// animated ring/wave, per this feature's own long-standing rule against
// copying another product's speaking indicator.
export default function CompanionCard({ name, isGuide, speaking, muted, praying, handUp, canModerate, onLongPress, onHandUpPress }: Props) {
  const initial = name.charAt(0).toUpperCase();
  const statusParts = [isGuide ? "Guide" : null, praying ? "Praying" : null, muted ? "Microphone muted" : null, handUp ? "Hand raised" : null].filter(Boolean);

  return (
    <TouchableOpacity
      style={[styles.card, speaking && styles.cardSpeaking]}
      onLongPress={onLongPress}
      activeOpacity={canModerate ? 0.7 : 1}
      accessibilityRole="text"
      accessibilityLabel={`${name}${statusParts.length ? `, ${statusParts.join(", ")}` : ""}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>{name}{isGuide ? " · Guide" : ""}</Text>
      <View style={styles.badges}>
        {praying && <Text style={styles.badgeEmoji}>🙏</Text>}
        {muted && <Ionicons name="mic-off" size={11} color={colors.textTertiary} />}
        {handUp && (
          <TouchableOpacity
            onPress={onHandUpPress}
            disabled={!onHandUpPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={onHandUpPress ? `Respond to ${name}'s raised hand` : undefined}
          >
            <Text style={styles.badgeEmoji}>✋</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceInset, borderRadius: radii.pill,
    paddingHorizontal: spacing.sm, minHeight: MIN_TOUCH_TARGET - 8, maxWidth: 160, borderWidth: 1.5, borderColor: "transparent",
  },
  cardSpeaking: { borderColor: colors.growth },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.growthSoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.growth, fontSize: 12, fontFamily: "Inter_700Bold" },
  name: { color: colors.textSecondary, ...type.caption, flexShrink: 1 },
  badges: { flexDirection: "row", alignItems: "center", gap: 4 },
  badgeEmoji: { fontSize: 11 },
});
