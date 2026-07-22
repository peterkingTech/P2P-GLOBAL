import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, FruitCatalogEntry, EarnedFruit, FruitProgressEntry } from "@/contexts/DataContext";

// Deliberately dark, garden-at-night palette — distinct from the rest of the
// app's light/cream theme. This screen is a keepsake, not a settings page.
const dark = {
  bg: "#081611",
  card: "#0F2019",
  cardLocked: "#0B1712",
  cardHidden: "#050B08",
  border: "rgba(157,225,203,0.14)",
  borderLocked: "rgba(157,225,203,0.06)",
  cream: "#F4EFE4",
  textMuted: "#7C9186",
  textFaint: "#4A5B52",
  green: "#2FBE8F",
  greenGlow: "rgba(47,190,143,0.35)",
  gold: "#F7C948",
  goldGlow: "rgba(247,201,72,0.3)",
};

const RARITY_COLOR: Record<string, string> = {
  common: "#9DB8AC",
  rare: "#5FA8D3",
  epic: "#B98AE0",
  legendary: dark.gold,
};

const CATEGORY_SECTIONS: { key: string; label: string; emoji: string; categories: string[] }[] = [
  { key: "personal_growth", label: "Personal Growth", emoji: "🌱", categories: ["personal_growth"] },
  { key: "faithfulness", label: "Faithfulness", emoji: "⭐", categories: ["faithfulness"] },
  { key: "multiplication", label: "Multiplication", emoji: "🌾", categories: ["multiplication"] },
  { key: "community", label: "Community", emoji: "🤝", categories: ["community"] },
  { key: "kingdom_influence", label: "Kingdom Influence", emoji: "🌍", categories: ["kingdom_influence"] },
  { key: "special_legendary", label: "Special & Legendary", emoji: "👑", categories: ["special", "legendary"] },
];

function FruitCard({
  fruit,
  earned,
  progress,
  onPress,
}: {
  fruit: FruitCatalogEntry;
  earned: EarnedFruit | null;
  progress: FruitProgressEntry | null;
  onPress: () => void;
}) {
  const rarityColor = RARITY_COLOR[fruit.rarity] ?? RARITY_COLOR.common;

  if (fruit.isHidden && !earned) {
    return (
      <TouchableOpacity style={[styles.card, styles.cardHidden]} activeOpacity={0.85} onPress={onPress}>
        <View style={[styles.iconWrap, { backgroundColor: "rgba(255,255,255,0.03)" }]}>
          <Text style={styles.hiddenMark}>?</Text>
        </View>
        <Text style={styles.hiddenLabel}>Hidden Achievement</Text>
        <Text style={styles.hiddenSub}>Keep walking — this one reveals itself when earned.</Text>
      </TouchableOpacity>
    );
  }

  if (earned) {
    return (
      <TouchableOpacity
        style={[styles.card, styles.cardEarned, { shadowColor: dark.greenGlow, borderColor: "rgba(47,190,143,0.4)" }]}
        activeOpacity={0.85}
        onPress={onPress}
      >
        <View style={[styles.iconWrap, { backgroundColor: dark.greenGlow }]}>
          <Text style={styles.iconText}>{fruit.icon}</Text>
        </View>
        <Text style={styles.fruitName}>{fruit.name}</Text>
        <View style={[styles.rarityBadge, { borderColor: rarityColor }]}>
          <Text style={[styles.rarityText, { color: rarityColor }]}>{fruit.rarity.toUpperCase()}</Text>
        </View>
        {fruit.themeVerse && <Text style={styles.verseRef}>{fruit.themeVerse}</Text>}
        <Text style={styles.desc} numberOfLines={2}>{fruit.description}</Text>
        <Text style={styles.earnedDate}>
          Earned {new Date(earned.awardedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={[styles.card, styles.cardLocked]} activeOpacity={0.85} onPress={onPress}>
      <View style={[styles.iconWrap, { backgroundColor: "rgba(255,255,255,0.04)", opacity: 0.4 }]}>
        <Text style={[styles.iconText, { opacity: 0.5 }]}>{fruit.icon}</Text>
      </View>
      <Text style={[styles.fruitName, styles.fruitNameLocked]}>{fruit.name}</Text>
      <View style={[styles.rarityBadge, { borderColor: "rgba(255,255,255,0.15)" }]}>
        <Text style={[styles.rarityText, { color: dark.textFaint }]}>{fruit.rarity.toUpperCase()}</Text>
      </View>
      <Text style={styles.conditionText} numberOfLines={3}>{fruit.unlockConditionDescription}</Text>
      {progress && progress.requiredCount > 0 && (
        <View style={styles.progressBlock}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, (progress.currentCount / progress.requiredCount) * 100)}%` }]} />
          </View>
          <Text style={styles.progressLabel}>{progress.currentCount} of {progress.requiredCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function FruitScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { fruitCatalog, userFruits, fruitProgress, fruitCount, modules, forestStats } = useData();

  const earnedByKey = useMemo(() => new Map(userFruits.map((f) => [f.fruitKey, f])), [userFruits]);
  const progressByKey = useMemo(() => new Map(fruitProgress.map((p) => [p.fruitKey, p])), [fruitProgress]);
  const modulesCompleted = modules.filter((m) => m.lessonCount > 0 && m.completedLessons === m.lessonCount).length;

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={dark.cream} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Fruits</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroBlock}>
          <Text style={styles.heroCount}>{fruitCount}</Text>
          <Text style={styles.heroSubtitle}>Your discipleship journey</Text>
        </View>

        <View style={styles.summaryStrip}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{fruitCount}</Text>
            <Text style={styles.summaryLabel}>Fruits Earned</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{modulesCompleted}</Text>
            <Text style={styles.summaryLabel}>Modules Completed</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNum}>{forestStats.totalDisciples}</Text>
            <Text style={styles.summaryLabel}>Disciples Mentored</Text>
          </View>
        </View>

        {CATEGORY_SECTIONS.map((section) => {
          const items = fruitCatalog
            .filter((f) => section.categories.includes(f.category))
            .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
          if (items.length === 0) return null;
          return (
            <View key={section.key} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.emoji} {section.label}</Text>
              <View style={styles.grid}>
                {items.map((fruit) => (
                  <FruitCard
                    key={fruit.fruitKey}
                    fruit={fruit}
                    earned={earnedByKey.get(fruit.fruitKey) ?? null}
                    progress={progressByKey.get(fruit.fruitKey) ?? null}
                    onPress={() => router.push(`/fruit/${fruit.fruitKey}` as any)}
                  />
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const CARD_WIDTH = "48%";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.bg },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: dark.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: dark.cream, fontFamily: "Inter_700Bold" },

  heroBlock: { alignItems: "center", paddingTop: 28, paddingBottom: 8 },
  heroCount: { fontSize: 48, fontWeight: "700", color: dark.green, fontFamily: "Inter_700Bold", textShadowColor: dark.greenGlow, textShadowRadius: 20, textShadowOffset: { width: 0, height: 0 } },
  heroSubtitle: { fontSize: 13, color: dark.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },

  summaryStrip: {
    flexDirection: "row", marginHorizontal: 16, marginTop: 20, marginBottom: 8,
    backgroundColor: dark.card, borderRadius: 16, borderWidth: 1, borderColor: dark.border,
    paddingVertical: 16,
  },
  summaryItem: { flex: 1, alignItems: "center", gap: 4 },
  summaryDivider: { width: 1, backgroundColor: dark.border },
  summaryNum: { fontSize: 20, fontWeight: "700", color: dark.cream, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 10, color: dark.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 4 },

  section: { marginTop: 26, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: dark.cream, fontFamily: "Inter_700Bold", marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },

  card: {
    width: CARD_WIDTH, borderRadius: 18, borderWidth: 1, padding: 14,
    alignItems: "center", gap: 4,
  },
  cardEarned: { backgroundColor: dark.card, shadowOpacity: 0.6, shadowRadius: 14, elevation: 4 },
  cardLocked: { backgroundColor: dark.cardLocked, borderColor: dark.borderLocked },
  cardHidden: { backgroundColor: dark.cardHidden, borderColor: dark.borderLocked, minHeight: 150, justifyContent: "center" },

  iconWrap: { width: 56, height: 56, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  iconText: { fontSize: 26 },
  hiddenMark: { fontSize: 22, fontWeight: "700", color: dark.textFaint },

  fruitName: { fontSize: 13, fontWeight: "700", color: dark.cream, fontFamily: "Inter_700Bold", textAlign: "center" },
  fruitNameLocked: { color: dark.textMuted },

  rarityBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  rarityText: { fontSize: 9, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.5 },

  verseRef: { fontSize: 10, color: dark.gold, fontFamily: "Inter_500Medium", marginTop: 6 },
  desc: { fontSize: 11, color: dark.textMuted, textAlign: "center", lineHeight: 15, fontFamily: "Inter_400Regular", marginTop: 4 },
  earnedDate: { fontSize: 9, color: dark.textFaint, fontFamily: "Inter_400Regular", marginTop: 6 },

  conditionText: { fontSize: 11, color: dark.textFaint, textAlign: "center", lineHeight: 15, fontFamily: "Inter_400Regular", marginTop: 6 },

  progressBlock: { width: "100%", marginTop: 8, gap: 4 },
  progressTrack: { height: 4, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: dark.green, borderRadius: 2 },
  progressLabel: { fontSize: 9, color: dark.textFaint, fontFamily: "Inter_400Regular", textAlign: "center" },

  hiddenLabel: { fontSize: 13, fontWeight: "700", color: dark.textMuted, fontFamily: "Inter_700Bold", marginTop: 4 },
  hiddenSub: { fontSize: 10, color: dark.textFaint, textAlign: "center", fontFamily: "Inter_400Regular", marginTop: 4, paddingHorizontal: 8 },
});
