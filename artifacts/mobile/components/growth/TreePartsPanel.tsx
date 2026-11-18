import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import type { GrowthTree } from "@/lib/growthApi";
import type { MyGrowthSection } from "@/lib/myGrowth";

// PARTS OF MY TREE (owner brief 2026-11-18 §9 — interactive Growth Tree). Each part of the living tree, tapped,
// says three things: what it is in a real tree (biology), what it stands for in P2P, and what MY records say —
// counts straight from GET /growth/me/tree (the Growth Matrix's own facts; nothing estimated, no thresholds
// changed). Each part opens the section that lists the records behind it.
type Part = "roots" | "trunk" | "branches" | "leaves" | "buds" | "fruit" | "seeds";
const PARTS: Part[] = ["roots", "trunk", "branches", "leaves", "buds", "fruit", "seeds"];
const ICON: Record<Part, string> = { roots: "🌱", trunk: "🪵", branches: "🌿", leaves: "🍃", buds: "🌸", fruit: "🍎", seeds: "🌰" };
const SECTION: Record<Part, MyGrowthSection> = { roots: "roots", trunk: "application", branches: "application", leaves: "consistency", buds: "contributions", fruit: "contributions", seeds: "contributions" };
const DEFAULTS: Record<Part, { name: string; biology: string; meaning: string }> = {
  roots: { name: "Roots", biology: "Roots anchor a tree and draw up water and nourishment. They grow first, mostly out of sight.", meaning: "Your roots are your learning in God's Word: the Core Foundations lessons you have passed and the study units you have completed." },
  trunk: { name: "Trunk", biology: "The trunk carries water up from the roots and holds the tree steady as it grows.", meaning: "Your trunk is what you have put into practice: practical actions recorded and verified." },
  branches: { name: "Branches", biology: "Branches reach out from the trunk and carry the leaves and fruit.", meaning: "Your branches are the areas of life where your practice has been verified." },
  leaves: { name: "Leaves", biology: "Leaves take in light every day; a tree full of leaves is one that keeps growing season after season.", meaning: "Your leaves show steady faithfulness over time: the weeks and months you have been active." },
  buds: { name: "Blossoms and buds", biology: "Blossoms come before fruit. Not every blossom becomes fruit; some are still forming.", meaning: "Your buds are contributions waiting for review. They become fruit only once they are verified." },
  fruit: { name: "Fruit", biology: "Fruit is what a healthy tree gives away — it carries seeds that can grow new trees.", meaning: "Your fruit is verified contributions to other people's growth." },
  seeds: { name: "Seeds", biology: "Seeds carried from the fruit grow into new trees of their own.", meaning: "Your seeds are people you helped who are now helping others themselves." },
};

export default function TreePartsPanel({ tree, onOpenSection }: { tree: GrowthTree | null; onOpenSection: (s: MyGrowthSection) => void }) {
  const { colors: c } = useTheme();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(c), [c]);
  const [part, setPart] = useState<Part | null>(null);
  const router = useRouter();
  const na = t("myGrowth.notAvailable", { defaultValue: "Not available yet" });

  const facts = (p: Part): string[] => {
    if (!tree) return [na];
    switch (p) {
      case "roots": return [
        t("treeParts.facts.foundations", { defaultValue: "Core Foundations: {{passed}} of {{total}} lessons passed", passed: tree.roots.coreLessons.passed, total: tree.roots.coreLessons.total }),
        t("treeParts.facts.units", { defaultValue: "Study units completed: {{count}}", count: tree.roots.learningUnits }),
      ];
      case "trunk": return [t("treeParts.facts.practical", { defaultValue: "Verified practical actions: {{count}}", count: tree.stems.practicalActions })];
      case "branches": return tree.branches.length ? tree.branches.map((b) => `${b.label}: ${b.verified}`) : [t("treeParts.facts.noBranches", { defaultValue: "No verified areas yet." })];
      case "leaves": {
        const wk = tree.consistency?.activeWeeks ?? tree.roots.activeWeeks, mo = tree.consistency?.activeMonths ?? tree.roots.activeMonths;
        return [t("treeParts.facts.activeWeeks", { defaultValue: "Active weeks: {{count}}", count: wk ?? 0 }), t("treeParts.facts.activeMonths", { defaultValue: "Active months: {{count}}", count: mo ?? 0 })];
      }
      case "buds": return [t("treeParts.facts.pending", { defaultValue: "Waiting for review: {{count}}", count: tree.fruitTotals.pendingReview })];
      case "fruit": return [t("treeParts.facts.verified", { defaultValue: "Verified fruit: {{count}}", count: tree.fruitTotals.verified })];
      case "seeds": return [t("treeParts.facts.seeds", { defaultValue: "People now helping others: {{count}}", count: tree.seeds.filter((x) => x.nowHelpingOthers).length })];
    }
  };
  const label = (p: Part) => t(`treeParts.${p}.name`, { defaultValue: DEFAULTS[p].name });

  return (
    <View style={s.card}>
      <Text style={s.title} accessibilityRole="header">{t("treeParts.title", { defaultValue: "Parts of my tree" })}</Text>
      <Text style={s.small}>{t("treeParts.intro", { defaultValue: "Tap a part to see what it means and the records behind it." })}</Text>
      <View style={s.grid} accessibilityRole="tablist">
        {PARTS.map((p) => (
          <TouchableOpacity key={p} style={[s.chip, part === p && s.chipOn]} onPress={() => setPart(part === p ? null : p)}
            accessibilityRole="tab" accessibilityState={{ selected: part === p }} accessibilityLabel={label(p)}>
            <Text style={s.chipIcon} importantForAccessibility="no">{ICON[p]}</Text>
            <Text style={[s.chipText, part === p && s.chipTextOn]}>{label(p)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {part ? (
        <View style={s.detail} accessibilityLiveRegion="polite">
          <Text style={s.subhead}>{ICON[part]} {label(part)}</Text>
          <Text style={s.label}>{t("treeParts.inNature", { defaultValue: "In a real tree" })}</Text>
          <Text style={s.body}>{t(`treeParts.${part}.biology`, { defaultValue: DEFAULTS[part].biology })}</Text>
          <Text style={s.label}>{t("treeParts.inP2P", { defaultValue: "In your growth" })}</Text>
          <Text style={s.body}>{t(`treeParts.${part}.meaning`, { defaultValue: DEFAULTS[part].meaning })}</Text>
          <Text style={s.label}>{t("treeParts.myRecords", { defaultValue: "Your records" })}</Text>
          {facts(part).map((f) => <Text key={f} style={s.fact}>• {f}</Text>)}
          <AppButton label={t("treeParts.open", { defaultValue: "See the records" })} size="sm" variant="secondary" icon="list-outline" onPress={() => onOpenSection(SECTION[part])} />
        </View>
      ) : null}
      <AppButton label={t("treeParts.biology", { defaultValue: "How a real apple tree grows, from seed to fruit" })} size="sm" variant="tertiary" icon="leaf-outline"
        onPress={() => router.push("/botanical" as any)} />
      <Text style={s.small}>{t("treeParts.notStages", { defaultValue: "The biology explains the picture. Your growth stage comes only from the Growth Matrix, not from the tree's stages." })}</Text>
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: 18, padding: 16, gap: 10, borderWidth: 1, borderColor: c.borderBeige },
  title: { color: c.textDark, fontSize: 17, fontWeight: "700" },
  small: { color: c.textMuted, fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.lightCream },
  chipOn: { borderColor: c.accentGreen, backgroundColor: c.accentGreen },
  chipIcon: { fontSize: 16 },
  chipText: { color: c.textDark, fontSize: 14, fontWeight: "600" },
  chipTextOn: { color: "#fff" },
  detail: { gap: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: c.borderBeige },
  subhead: { color: c.textDark, fontSize: 16, fontWeight: "700" },
  label: { color: c.accentGreen, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  body: { color: c.textMid, fontSize: 15, lineHeight: 22 },
  fact: { color: c.textDark, fontSize: 15 },
});
