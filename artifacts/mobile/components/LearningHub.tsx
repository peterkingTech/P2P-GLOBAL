import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { AppColors } from "@/constants/themes";

// "Explore Learning" on the Learning tab: a launcher of the learning experiences — an icon,
// a short label and, where there is one, where you are. Every tile opens that experience's own
// existing screen; nothing here is a copy. The tab passes each status line from data it has
// already loaded (no requests here).
//   • Bible has its own main tab, so it isn't repeated here.
//   • Study Together (owner 2026-11-14) has its own tile: the existing hub (/study-together) is the
//     one place every shared study lives — stories, lessons, plans, and Family / Church studies.
//     Studies are still started from the resources themselves.
//   • "My Learning" is the Learning Centre (same screen, which holds the learning dashboard),
//     so it is one tile.
export const LEARNING_DESTINATIONS = [
  { key: "school", icon: "school", title: "Kingdom School", route: "/kingdom-school", tint: "green" },
  { key: "stories", icon: "library", title: "Kingdom Stories", route: "/kingdom-stories", tint: "amber" },
  // P2P Plans (2026-11-14): one plan system organising Bible, Kingdom School, Kingdom Stories and Deep Study.
  { key: "plans", icon: "calendar", title: "P2P Plans", route: "/plans", tint: "green" },
  { key: "together", icon: "people", title: "Study Together", route: "/study-together", tint: "amber" },
  { key: "centre", icon: "clipboard", title: "Learning Centre", route: "/learning", tint: "earth" },
  { key: "evaluations", icon: "checkmark-done-circle", title: "My Evaluations", route: "/evaluation", tint: "gold" },
] as const;

export type LearningDestinationKey = (typeof LEARNING_DESTINATIONS)[number]["key"];
export type LearningHubDetails = Partial<Record<LearningDestinationKey, { status?: string | null }>>;

// Restrained tints from the P2P palette (alpha over the card colour, so both themes work).
function tintOf(tint: (typeof LEARNING_DESTINATIONS)[number]["tint"], c: AppColors): { bg: string; fg: string } {
  if (tint === "green") return { bg: "rgba(29,158,117,0.14)", fg: c.primaryGreen };
  if (tint === "amber") return { bg: "rgba(186,117,23,0.15)", fg: c.amber };
  if (tint === "gold") return { bg: "rgba(247,201,72,0.24)", fg: c.textDark };
  return { bg: "rgba(107,92,61,0.13)", fg: c.textMid };
}

export default function LearningHub({ colors, details = {}, columns = 2 }: { colors: AppColors; details?: LearningHubDetails; columns?: 2 | 3 | 4 }) {
  const router = useRouter();
  // Exact tile widths from the grid's own width, so rows line up with the cards below.
  const [width, setWidth] = useState(0);
  const tileWidth = width ? Math.floor((width - GAP * (columns - 1)) / columns) : undefined;
  return (
    <View style={s.grid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {LEARNING_DESTINATIONS.map((d) => {
        const status = details[d.key]?.status ?? null;
        const t = tintOf(d.tint, colors);
        return (
          <Pressable key={d.key} onPress={() => router.push(d.route as any)}
            style={({ pressed }) => [s.tile, tileWidth ? { width: tileWidth } : columns === 4 ? s.quarter : columns === 3 ? s.third : s.half, { backgroundColor: colors.card, borderColor: colors.borderBeige }, pressed && s.pressed]}
            accessibilityRole="button" accessibilityLabel={`${d.title}${status ? `. ${status}` : ""}`}>
            <View style={[s.icon, { backgroundColor: t.bg }]}>
              <Ionicons name={d.icon} size={28} color={t.fg} />
            </View>
            <Text style={[s.label, { color: colors.textDark }]} numberOfLines={2}>{d.title}</Text>
            {status ? <Text style={[s.status, { color: colors.textMuted }]} numberOfLines={2}>{status}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const GAP = 12;
const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  // Two per row on phones, four on tablets (these widths only apply before the grid is measured).
  half: { width: "47.9%" },
  third: { width: "31.6%" },
  quarter: { width: "23.5%" },
  tile: { minHeight: 128, padding: 14, borderRadius: 18, borderWidth: 1, gap: 8 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  icon: { width: 52, height: 52, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  status: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium" },
});
