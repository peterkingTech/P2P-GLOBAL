import React from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import type { AppColors } from "@/constants/themes";
import { BIBLE_COVER, BIBLE_COVER_BG } from "@/constants/artwork";
import { CategoryCard, type LearningArtSource } from "@/components/learning/LearningCards";

// "Explore Learning" on the Learning Centre: one tap to each learning
// experience. Every card opens that experience's own screen and data —
// nothing here is a copy. The Learning tab passes each card's picture and
// "where you are" line from the data it has already loaded (no requests here).
export const LEARNING_DESTINATIONS = [
  { key: "bible", icon: "book-outline", title: "Bible Study", sub: "Read, search and explore Scripture", route: "/bible-study", image: BIBLE_COVER },
  { key: "school", icon: "school-outline", title: "Kingdom School", sub: "Foundations, learning plans and lessons", route: "/kingdom-school" },
  { key: "stories", icon: "library-outline", title: "Kingdom Stories", sub: "Bible stories in biblical order", route: "/kingdom-stories" },
  { key: "together", icon: "people-outline", title: "Study Together", sub: "Every shared study in one place", route: "/study-together" },
] as const;

export type LearningDestinationKey = (typeof LEARNING_DESTINATIONS)[number]["key"];
export type LearningHubDetails = Partial<Record<LearningDestinationKey, { status?: string | null; art?: LearningArtSource }>>;

export default function LearningHub({ colors, details = {}, columns = 1 }: { colors: AppColors; details?: LearningHubDetails; columns?: 1 | 2 }) {
  const router = useRouter();
  return (
    <View style={s.grid}>
      {LEARNING_DESTINATIONS.map((d) => {
        const extra = details[d.key];
        const art: LearningArtSource = "image" in d ? { bundled: d.image, background: BIBLE_COVER_BG, ratio: 1 } : extra?.art ?? {};
        return (
          <View key={d.key} style={columns === 2 ? s.half : s.full}>
            <CategoryCard title={d.title} sub={d.sub} status={extra?.status} icon={d.icon} art={art} colors={colors}
              onPress={() => router.push(d.route as any)} />
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  full: { width: "100%" },
  half: { flexBasis: "47%", flexGrow: 1 },
});
