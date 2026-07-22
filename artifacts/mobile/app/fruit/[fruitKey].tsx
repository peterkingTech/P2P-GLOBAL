import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";

const dark = {
  bg: "#081611",
  card: "#0F2019",
  border: "rgba(157,225,203,0.14)",
  cream: "#F4EFE4",
  textMuted: "#7C9186",
  textFaint: "#4A5B52",
  green: "#2FBE8F",
  greenGlow: "rgba(47,190,143,0.35)",
  gold: "#F7C948",
};

const RARITY_COLOR: Record<string, string> = {
  common: "#9DB8AC",
  rare: "#5FA8D3",
  epic: "#B98AE0",
  legendary: dark.gold,
};

const CATEGORY_LABEL: Record<string, string> = {
  personal_growth: "Personal Growth",
  faithfulness: "Faithfulness",
  multiplication: "Multiplication",
  community: "Community",
  kingdom_influence: "Kingdom Influence",
  special: "Special",
  legendary: "Legendary",
};

export default function FruitDetailScreen() {
  const { fruitKey } = useLocalSearchParams<{ fruitKey: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fruitCatalog, userFruits, fruitProgress } = useData();

  const fruit = fruitCatalog.find((f) => f.fruitKey === fruitKey);
  const earned = userFruits.find((f) => f.fruitKey === fruitKey) ?? null;
  const progress = fruitProgress.find((p) => p.fruitKey === fruitKey) ?? null;
  const isHiddenAndUnearned = fruit?.isHidden && !earned;

  const relatedFruits = useMemo(() => {
    if (!fruit) return [];
    return fruitCatalog
      .filter((f) => f.category === fruit.category && f.fruitKey !== fruit.fruitKey && !(f.isHidden && !userFruits.some((u) => u.fruitKey === f.fruitKey)))
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .slice(0, 2);
  }, [fruit, fruitCatalog, userFruits]);

  if (!fruit) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <Text style={styles.notFound}>Fruit not found.</Text>
      </View>
    );
  }

  const rarityColor = RARITY_COLOR[fruit.rarity] ?? RARITY_COLOR.common;

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={dark.cream} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{isHiddenAndUnearned ? "Hidden Achievement" : fruit.name}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.iconHero}>
          <View style={[styles.iconCircle, { backgroundColor: earned ? dark.greenGlow : "rgba(255,255,255,0.05)" }]}>
            <Text style={styles.iconText}>{isHiddenAndUnearned ? "?" : fruit.icon}</Text>
          </View>
        </View>

        {isHiddenAndUnearned ? (
          <>
            <Text style={styles.name}>Hidden Achievement</Text>
            <Text style={styles.hiddenNote}>This fruit's name and condition stay hidden until you earn it. Keep walking faithfully — you'll know it when it happens.</Text>
          </>
        ) : (
          <>
            <Text style={styles.name}>{fruit.name}</Text>
            <View style={styles.metaRow}>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryText}>{CATEGORY_LABEL[fruit.category] ?? fruit.category}</Text>
              </View>
              <View style={[styles.rarityBadge, { borderColor: rarityColor }]}>
                <Text style={[styles.rarityText, { color: rarityColor }]}>{fruit.rarity.toUpperCase()}</Text>
              </View>
            </View>

            {fruit.themeVerse && (
              <View style={styles.verseCard}>
                <Text style={styles.verseText}>"{fruit.themeVerseText}"</Text>
                <Text style={styles.verseRef}>— {fruit.themeVerse}</Text>
              </View>
            )}

            {fruit.biblicalMeaning && (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Biblical Meaning</Text>
                <Text style={styles.blockBody}>{fruit.biblicalMeaning}</Text>
              </View>
            )}

            <View style={styles.block}>
              <Text style={styles.blockTitle}>How It's Earned</Text>
              <Text style={styles.blockBody}>{fruit.unlockConditionDescription}</Text>
            </View>

            {earned ? (
              <View style={[styles.block, styles.evidenceBlock]}>
                <Text style={styles.blockTitle}>How You Earned It</Text>
                <Text style={styles.blockBody}>{earned.evidenceSummary}</Text>
                <Text style={styles.earnedDate}>
                  {new Date(earned.awardedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                </Text>
              </View>
            ) : progress && progress.requiredCount > 0 ? (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Your Progress</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, (progress.currentCount / progress.requiredCount) * 100)}%` }]} />
                </View>
                <Text style={styles.blockBody}>{progress.currentCount} of {progress.requiredCount}</Text>
              </View>
            ) : null}

            <View style={styles.block}>
              <Text style={styles.blockTitle}>A Prayer for This</Text>
              <Text style={styles.blockBody}>
                Lord, {fruit.themeVerse ? `as it says in ${fruit.themeVerse}, ` : ""}shape this in me — {fruit.unlockConditionDescription?.toLowerCase().replace(/\.$/, "")}. Not for recognition, but because it's who You're making me. Amen.
              </Text>
            </View>

            {relatedFruits.length > 0 && (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Related Fruits</Text>
                {relatedFruits.map((rf) => (
                  <TouchableOpacity key={rf.fruitKey} style={styles.relatedRow} onPress={() => router.push(`/fruit/${rf.fruitKey}` as any)}>
                    <Text style={styles.relatedIcon}>{rf.isHidden && !userFruits.some((u) => u.fruitKey === rf.fruitKey) ? "?" : rf.icon}</Text>
                    <Text style={styles.relatedName}>{rf.isHidden && !userFruits.some((u) => u.fruitKey === rf.fruitKey) ? "Hidden Achievement" : rf.name}</Text>
                    <Ionicons name="chevron-forward" size={16} color={dark.textFaint} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.bg },
  notFound: { color: dark.textMuted, fontFamily: "Inter_400Regular" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: dark.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: dark.cream, fontFamily: "Inter_700Bold" },

  iconHero: { alignItems: "center", marginTop: 12, marginBottom: 16 },
  iconCircle: { width: 96, height: 96, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  iconText: { fontSize: 44 },

  name: { fontSize: 22, fontWeight: "700", color: dark.cream, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 10 },
  hiddenNote: { fontSize: 14, color: dark.textMuted, textAlign: "center", lineHeight: 22, fontFamily: "Inter_400Regular", paddingHorizontal: 10 },

  metaRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 18 },
  categoryBadge: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  categoryText: { fontSize: 11, color: dark.textMuted, fontFamily: "Inter_500Medium" },
  rarityBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  rarityText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },

  verseCard: {
    backgroundColor: dark.card, borderRadius: 16, borderWidth: 1, borderColor: "rgba(247,201,72,0.2)",
    borderLeftWidth: 3, borderLeftColor: dark.gold,
    padding: 16, marginBottom: 18,
  },
  verseText: { fontSize: 15, fontStyle: "italic", color: dark.cream, lineHeight: 24, fontFamily: "Inter_400Regular", marginBottom: 8 },
  verseRef: { fontSize: 12, color: dark.gold, fontFamily: "Inter_500Medium" },

  block: { marginBottom: 20 },
  evidenceBlock: { backgroundColor: dark.card, borderRadius: 16, borderWidth: 1, borderColor: "rgba(47,190,143,0.25)", padding: 16 },
  blockTitle: { fontSize: 12, fontWeight: "700", color: dark.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  blockBody: { fontSize: 14, color: dark.cream, lineHeight: 22, fontFamily: "Inter_400Regular" },
  earnedDate: { fontSize: 11, color: dark.textFaint, fontFamily: "Inter_400Regular", marginTop: 8 },

  progressTrack: { height: 6, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden", marginBottom: 8 },
  progressFill: { height: "100%", backgroundColor: dark.green, borderRadius: 3 },

  relatedRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: dark.border },
  relatedIcon: { fontSize: 18 },
  relatedName: { flex: 1, fontSize: 13, color: dark.cream, fontFamily: "Inter_500Medium" },
});
