import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { getGrowthTree, type GrowthTree } from "@/lib/growthApi";
import { stageStillUrl } from "@/lib/growthModels";

// GROWTH STORY & TIMELINE — my development over time, from RECORDED events only: each stage change
// (with its date and how it was recorded) and each verified contribution. The tree pictures beside a
// stage change are RECONSTRUCTED from the recorded stage (no picture of anyone's tree was ever saved),
// and say so. Choose a year to see that period. Nothing is inferred or invented.
type Event = { date: string; kind: "stage" | "fruit"; title: string; detail: string; stage?: number };

export default function GrowthTimelineScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<GrowthTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<string>("all");
  const load = useCallback(() => { setError(null); getGrowthTree().then(setD, (e) => setError(e?.message ?? "Couldn't load your timeline.")); }, []);
  useEffect(load, [load]);

  const events: Event[] = useMemo(() => {
    if (!d) return [];
    const e: Event[] = d.history.map((h) => ({ date: h.achievedAt.slice(0, 10), kind: "stage", stage: h.stage, title: `Became ${h.name}`,
      detail: h.kind === "legacy_import" ? "Recognised from the earlier growth system" : "Verified milestone" }));
    for (const f of d.fruits) if (f.countsTowardMilestone) e.push({ date: f.date, kind: "fruit", title: f.label, detail: `${f.areaLabel}${f.kind === "group" ? " · group" : ""}` });
    return e.sort((a, b) => b.date.localeCompare(a.date));
  }, [d]);
  const years = [...new Set(events.map((e) => e.date.slice(0, 4)))].sort().reverse();
  const shown = events.filter((e) => year === "all" || e.date.startsWith(year));

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">Growth Story</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }}>
        {!d ? (error ? (
          <View style={s.center}><Text style={s.muted}>{error}</Text><AppButton label="Try again" variant="secondary" size="sm" onPress={load} /></View>
        ) : <View style={s.center}><ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" /></View>) : (
          <>
            <View style={s.card}>
              <Text style={s.kicker}>Today</Text>
              <Text style={s.name}>{d.stage.name}</Text>
              <Text style={s.meta}>Since {new Date(d.stage.since).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} · {d.stage.objective.title}</Text>
              <Text style={s.meta}>Foundations {d.roots.coreLessons.passed}/{d.roots.coreLessons.total} · {d.roots.learningUnits} learning units · {d.stems.practicalActions} practical actions · {d.fruitTotals.verified} contributions · {d.roots.activeWeeks} active weeks</Text>
            </View>
            {years.length > 1 ? (
              <ChipRow accessibilityLabel="Period" single>
                <FilterChip label="All" selected={year === "all"} selection="single" onPress={() => setYear("all")} />
                {years.map((y) => <FilterChip key={y} label={y} selected={year === y} selection="single" onPress={() => setYear(y)} />)}
              </ChipRow>
            ) : null}
            {!shown.length ? <Text style={s.muted}>No recorded milestones or verified contributions yet. They appear here as they happen.</Text> : null}
            {shown.map((e, i) => {
              const still = e.kind === "stage" && e.stage ? stageStillUrl(e.stage - 1) : null;
              return (
                <View key={`${e.date}-${i}`} style={s.event} accessible accessibilityLabel={`${e.date}: ${e.title}. ${e.detail}`}>
                  <View style={[s.mark, e.kind === "stage" ? s.markStage : s.markFruit]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.date}>{new Date(e.date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</Text>
                    <Text style={s.name}>{e.title}</Text>
                    <Text style={s.meta}>{e.detail}</Text>
                    {still ? (
                      <View style={{ gap: 2, marginTop: 4 }}>
                        <Image source={{ uri: still }} style={s.still} resizeMode="contain" accessibilityIgnoresInvertColors />
                        <Text style={s.small}>Reconstructed from your recorded stage — not a saved picture of your tree.</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
            <View style={s.links}>
              <AppButton label="Fruit Harvest" icon="nutrition-outline" variant="secondary" size="sm" onPress={() => router.push("/fruit-harvest" as any)} />
              <AppButton label="My genealogy" icon="git-network-outline" variant="secondary" size="sm" onPress={() => router.push("/lineage" as any)} />
            </View>
            <Text style={s.small}>{d.disclaimer}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    center: { alignItems: "center", gap: 10, padding: 24 },
    muted: { fontSize: 13.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 19, textAlign: "center" },
    small: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 16 },
    card: { padding: 14, gap: 4, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    date: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    event: { flexDirection: "row", gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    mark: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
    markStage: { backgroundColor: c.accentGreen },
    markFruit: { backgroundColor: "#B8322A" },
    still: { width: 120, height: 120 },
    links: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  });
}
