import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { AppColors } from "@/constants/themes";
import { BIBLE_COVER, BIBLE_COVER_BG } from "@/constants/artwork";

// "Explore Learning" on the Learning Centre: one tap to each learning
// experience. Every tile opens that experience's own screen and data —
// nothing here is a copy.
export const LEARNING_DESTINATIONS = [
  { key: "school", icon: "school-outline", title: "Kingdom School", sub: "Foundations, learning plans and lessons", route: "/kingdom-school" },
  { key: "stories", icon: "library-outline", title: "Kingdom Stories", sub: "Bible stories in biblical order", route: "/kingdom-stories" },
  { key: "bible", icon: "book-outline", title: "Bible Study", sub: "Read, search and explore Scripture", route: "/bible-study", image: BIBLE_COVER },
  { key: "together", icon: "people-outline", title: "Study Together", sub: "Every shared study in one place", route: "/study-together" },
] as const;

export default function LearningHub({ colors }: { colors: AppColors }) {
  const router = useRouter();
  const s = makeStyles(colors);
  return (
    <View style={s.grid}>
      {LEARNING_DESTINATIONS.map((d) => (
        <TouchableOpacity key={d.key} style={s.tile} onPress={() => router.push(d.route as any)} activeOpacity={0.75}
          accessibilityRole="button" accessibilityLabel={`${d.title}. ${d.sub}`}>
          {"image" in d
            ? <Image source={d.image} style={s.art} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no" />
            : <View style={s.icon}><Ionicons name={d.icon} size={20} color={colors.accentGreen} /></View>}
          <Text style={s.tileTitle} numberOfLines={1}>{d.title}</Text>
          <Text style={s.tileSub} numberOfLines={2}>{d.sub}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tile: { flexBasis: "47%", flexGrow: 1, minHeight: 104, padding: 14, gap: 4, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: `${c.accentGreen}1F`, marginBottom: 4 },
    art: { width: 44, height: 44, borderRadius: 10, marginBottom: 4, backgroundColor: BIBLE_COVER_BG },
    tileTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    tileSub: { fontSize: 12, lineHeight: 16, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
