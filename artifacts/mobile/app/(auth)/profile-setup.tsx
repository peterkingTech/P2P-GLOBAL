import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, SpiritualGift } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

const GIFTS: { key: SpiritualGift; label: string; icon: string }[] = [
  { key: "teaching", label: "Teaching", icon: "school" },
  { key: "evangelism", label: "Evangelism", icon: "megaphone" },
  { key: "mercy", label: "Mercy", icon: "heart" },
  { key: "leadership", label: "Leadership", icon: "trending-up" },
  { key: "intercession", label: "Intercession", icon: "radio" },
  { key: "hospitality", label: "Hospitality", icon: "home" },
  { key: "giving", label: "Giving", icon: "gift" },
  { key: "prophecy", label: "Prophecy", icon: "eye" },
];

export default function ProfileSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { updateProfile } = useAuth();

  const [selectedGifts, setSelectedGifts] = useState<SpiritualGift[]>([]);
  const [loading, setLoading] = useState(false);

  function toggleGift(gift: SpiritualGift) {
    setSelectedGifts((prev) =>
      prev.includes(gift) ? prev.filter((g) => g !== gift) : [...prev, gift]
    );
  }

  async function handleFinish() {
    setLoading(true);
    await updateProfile({ gifts: selectedGifts });
    setLoading(false);
    router.replace("/(tabs)");
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + (Platform.OS === "web" ? 40 : 32),
          paddingBottom: insets.bottom + 40,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.iconRing}>
          <Ionicons name="sparkles" size={36} color={colors.brightYellow} />
        </View>
        <Text style={styles.title}>Your Spiritual Gifts</Text>
        <Text style={styles.subtitle}>
          Select the gifts you believe God has given you. This helps us match you with the right study partners.
        </Text>
      </View>

      <View style={styles.grid}>
        {GIFTS.map((gift) => {
          const selected = selectedGifts.includes(gift.key);
          return (
            <TouchableOpacity
              key={gift.key}
              style={[styles.giftCard, selected && styles.giftCardSelected]}
              onPress={() => toggleGift(gift.key)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={gift.icon as any}
                size={26}
                color={selected ? colors.cream : colors.accentGreen}
              />
              <Text style={[styles.giftLabel, selected && styles.giftLabelSelected]}>
                {gift.label}
              </Text>
              {selected && (
                <View style={styles.checkmark}>
                  <Ionicons name="checkmark" size={12} color={colors.cream} />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={handleFinish}
        activeOpacity={0.85}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.cream} />
        ) : (
          <Text style={styles.primaryBtnText}>
            {selectedGifts.length === 0 ? "Skip for Now" : "Plant My Tree"}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { paddingHorizontal: 24 },
  header: { alignItems: "center", marginBottom: 36 },
  iconRing: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(186,117,23,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(186,117,23,0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.textDark,
    fontFamily: "Inter_700Bold",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 36,
    justifyContent: "center",
  },
  giftCard: {
    width: "45%",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.borderBeige,
    padding: 16,
    alignItems: "center",
    gap: 8,
    position: "relative",
  },
  giftCardSelected: {
    backgroundColor: colors.accentGreen,
    borderColor: colors.primaryGreen,
  },
  giftLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textDark,
    fontFamily: "Inter_600SemiBold",
  },
  giftLabelSelected: { color: colors.cream },
  checkmark: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primaryGreen,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    backgroundColor: colors.primaryGreen,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: colors.cream,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
