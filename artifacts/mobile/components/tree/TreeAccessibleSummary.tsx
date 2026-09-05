import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { TreeStageDef } from "@/constants/treeStages";
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

interface TreeAccessibleSummaryProps {
  stage: TreeStageDef;
  earnedFruits: EarnedFruit[];
  fruitCatalog: FruitCatalogEntry[];
}

// A plain, screen-reader-friendly equivalent of everything the 3D-ish
// canvas shows — stage and every earned fruit — so nothing important
// exists only inside the visual scene (accessibility requirement).
export default function TreeAccessibleSummary({ stage, earnedFruits, fruitCatalog }: TreeAccessibleSummaryProps) {
  const catalogByKey = new Map(fruitCatalog.map((f) => [f.fruitKey, f]));

  return (
    <View accessibilityRole="summary" style={styles.container}>
      <Text style={styles.stageName} accessibilityRole="header">{stage.name}</Text>
      <Text style={styles.stageDescription}>{stage.description}</Text>

      <Text style={styles.sectionHeading} accessibilityRole="header">
        Fruit earned ({earnedFruits.length})
      </Text>
      {earnedFruits.length === 0 ? (
        <Text style={styles.emptyText}>No fruit earned yet — it will appear here as you grow.</Text>
      ) : (
        earnedFruits.map((f) => {
          const entry = catalogByKey.get(f.fruitKey);
          const earnedDate = new Date(f.awardedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
          return (
            <View key={f.fruitKey} style={styles.fruitRow} accessibilityLabel={`${entry?.name ?? f.fruitKey}, ${entry ? CATEGORY_LABEL[entry.category] ?? entry.category : ""}, earned ${earnedDate}`}>
              <Text style={styles.fruitName}>{entry?.name ?? f.fruitKey}</Text>
              {entry && <Text style={styles.fruitCategory}>{CATEGORY_LABEL[entry.category] ?? entry.category}</Text>}
              {entry?.description && <Text style={styles.fruitDescription}>{entry.description}</Text>}
              <Text style={styles.fruitDate}>Earned {earnedDate}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 4 },
  stageName: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  stageDescription: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", marginBottom: 14, lineHeight: 19 },
  sectionHeading: { fontSize: 13, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  fruitRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  fruitName: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  fruitCategory: { fontSize: 11, color: colors.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  fruitDescription: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular", marginTop: 4, lineHeight: 17 },
  fruitDate: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
});