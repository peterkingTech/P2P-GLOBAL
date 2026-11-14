import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import { getMyPlans, getPlans, type FocusType, type MyPlans, type PlanCard, type RunItem } from "@/lib/studyPlansApi";
import { FOCUS_TYPES, dueKey, filterPlans, shelves, todayIso } from "@/lib/studyPlansUi";

// P2P PLANS — HOME (owner brief 2026-11-14). One plan system: continue your plans, explore (search, focus
// filter, discovery collections — shelves, not separate systems), and My Plans (active, paused, completed,
// created by me, saved, together). The Learning Centre's topic plans keep their own browser
// (/plans/learning, unchanged). No streaks, no "late", no points.
type MineTab = "active" | "paused" | "completed" | "created" | "saved" | "together";
const MINE_TABS: MineTab[] = ["active", "paused", "completed", "created", "saved", "together"];

function PlansHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [plans, setPlans] = useState<PlanCard[] | null>(null);
  const [mine, setMine] = useState<MyPlans | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<FocusType | null>(null);
  const [together, setTogether] = useState(false);
  const [tab, setTab] = useState<MineTab>("active");
  const load = useCallback(() => {
    setError(null);
    Promise.all([getPlans(), getMyPlans()]).then(([p, m]) => { setPlans(p.plans); setMine(m); }, (e) => setError(e?.status === 503 ? t("p2pPlans.notAvailable") : e?.message ?? t("p2pPlans.notAvailable")));
  }, [t]);
  useFocusEffect(load);
  const today = todayIso();
  const filtering = !!q.trim() || !!focus || together;
  const results = plans ? filterPlans(plans, { q, focus, together }) : [];
  const open = (id: string) => router.push({ pathname: "/study-plan/[id]", params: { id } } as any);
  const sessionsLabel = (p: PlanCard) => (p.derived ? t("p2pPlans.sessionsFollowCurriculum") : t("p2pPlans.sessions", { count: p.sessionCount ?? 0 }));
  const badge = (p: PlanCard) => (p.official ? t("p2pPlans.official") : t("p2pPlans.yourPlan"));

  const Card = ({ p }: { p: PlanCard }) => (
    <TouchableOpacity style={s.card} onPress={() => open(p.id)} accessibilityRole="button" accessibilityLabel={`${p.title}. ${t(`p2pPlans.focus.${p.focusType}`)}: ${p.focusLabel}. ${sessionsLabel(p)}. ${badge(p)}`}>
      <Text style={s.kicker}>{t(`p2pPlans.focus.${p.focusType}`)} · {p.focusLabel}</Text>
      <Text style={s.cardTitle}>{p.title}</Text>
      {p.description ? <Text style={s.small} numberOfLines={2}>{p.description}</Text> : null}
      <View style={s.metaRow}>
        <Text style={s.pill}>{sessionsLabel(p)}</Text>
        <Text style={[s.pill, p.official ? s.pillOfficial : null]}>{badge(p)}</Text>
        {p.saved ? <Text style={s.pill}>{t("p2pPlans.detail.saved")}</Text> : null}
      </View>
    </TouchableOpacity>
  );
  const RunCard = ({ i }: { i: RunItem }) => {
    const due = i.current ? dueKey(i.current.dueDate, today) : null;
    return (
      <TouchableOpacity style={s.card} onPress={() => open(i.plan.id)} accessibilityRole="button"
        accessibilityLabel={`${i.plan.title}. ${t("p2pPlans.progress", { completed: i.progress.completed, total: i.progress.total })}. ${t(`p2pPlans.mode.${i.run.mode}`)}`}>
        <View style={s.rowBetween}>
          <Text style={s.kicker}>{i.plan.focusLabel}</Text>
          <Text style={s.pill}>{t(`p2pPlans.mode.${i.run.mode}`)}</Text>
        </View>
        <Text style={s.cardTitle}>{i.plan.title}</Text>
        <Text style={s.progress}>{t("p2pPlans.progress", { completed: i.progress.completed, total: i.progress.total })} · {t(`p2pPlans.pace.${i.run.pace}`)}{i.run.status === "paused" ? ` · ${t("p2pPlans.status.paused")}` : ""}</Text>
        {i.current ? <Text style={s.body}>{t("p2pPlans.current", { title: i.current.title })}{due ? ` · ${t(`p2pPlans.${due.key}`, { date: due.date ? fmt(due.date) : "" })}` : ""}</Text> : null}
        {i.next ? <Text style={s.small}>{t("p2pPlans.next", { title: i.next.title })}</Text> : null}
      </TouchableOpacity>
    );
  };
  const mineList = (): (RunItem | PlanCard)[] => {
    if (!mine) return [];
    if (tab === "together") return [...mine.active, ...mine.paused, ...mine.completed].filter((i) => i.run.mode === "together");
    return mine[tab];
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("p2pPlans.back")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{t("p2pPlans.title")}</Text>
        <AppButton label={t("p2pPlans.create")} icon="add" size="sm" onPress={() => router.push("/plans/builder" as any)} />
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.body}>{t("p2pPlans.intro")}</Text>
        {error ? (
          <View style={[s.card, { alignItems: "center" }]}>
            <Text style={s.cardTitle}>{error}</Text>
            <AppButton label={t("p2pPlans.tryAgain")} size="sm" variant="secondary" onPress={load} />
          </View>
        ) : !plans || !mine ? <ActivityIndicator color={c.primaryGreen} accessibilityLabel={t("p2pPlans.loading")} /> : (
          <>
            <Text style={s.section} accessibilityRole="header">{t("p2pPlans.continue")}</Text>
            {mine.active.length || mine.paused.length ? [...mine.active, ...mine.paused].map((i) => <RunCard key={i.run.id} i={i} />) : <Text style={s.meta}>{t("p2pPlans.continueEmpty")}</Text>}

            <Text style={s.section} accessibilityRole="header">{t("p2pPlans.explore")}</Text>
            <TextInput value={q} onChangeText={setQ} placeholder={t("p2pPlans.searchPlaceholder")} placeholderTextColor={c.textMuted} style={s.input} accessibilityLabel={t("p2pPlans.search")} />
            <ChipRow accessibilityLabel={t("p2pPlans.explore")} single>
              <FilterChip label={t("p2pPlans.allFocus")} selected={!focus} selection="single" onPress={() => setFocus(null)} />
              {FOCUS_TYPES.map((f) => <FilterChip key={f} label={t(`p2pPlans.focus.${f}`)} selected={focus === f} selection="single" onPress={() => setFocus(focus === f ? null : f)} />)}
              <FilterChip label={t("p2pPlans.togetherOnly")} selected={together} onPress={() => setTogether(!together)} />
            </ChipRow>
            {filtering ? (results.length ? results.map((p) => <Card key={p.id} p={p} />) : <Text style={s.meta}>{t("p2pPlans.noMatch")}</Text>)
              : shelves(plans).map((sh) => (
                <View key={sh.collection} style={{ gap: 8 }}>
                  <Text style={s.group}>{t(`p2pPlans.collection.${sh.collection}`)}</Text>
                  {sh.plans.map((p) => <Card key={p.id} p={p} />)}
                </View>
              ))}
            <TouchableOpacity style={[s.card, s.learning]} onPress={() => router.push("/plans/learning" as any)} accessibilityRole="button" accessibilityLabel={t("p2pPlans.learningPlans")}>
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>{t("p2pPlans.learningPlans")}</Text>
                <Ionicons name="chevron-forward" size={18} color={c.textMid} />
              </View>
              <Text style={s.small}>{t("p2pPlans.learningPlansHint")}</Text>
            </TouchableOpacity>

            <Text style={s.section} accessibilityRole="header">{t("p2pPlans.myPlans")}</Text>
            <ChipRow accessibilityLabel={t("p2pPlans.myPlans")} single>
              {MINE_TABS.map((k) => <FilterChip key={k} label={t(`p2pPlans.mine.${k}`)} selected={tab === k} selection="single" onPress={() => setTab(k)} />)}
            </ChipRow>
            {mineList().length ? mineList().map((x) => ("run" in x ? <RunCard key={x.run.id} i={x} /> : <Card key={x.id} p={x} />)) : <Text style={s.meta}>{t("p2pPlans.mine.empty")}</Text>}
          </>
        )}
      </ScrollView>
    </View>
  );
}
const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export default withScreenBoundary(PlansHome, "P2P Plans");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, gap: 12, width: "100%", maxWidth: 900, alignSelf: "center" },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    section: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 10 },
    group: { fontSize: 12.5, letterSpacing: 0.6, fontFamily: "Inter_700Bold", color: c.textMuted, textTransform: "uppercase", marginTop: 6 },
    card: { padding: 14, gap: 5, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    learning: { backgroundColor: c.cardBeige },
    cardTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, flexShrink: 1 },
    progress: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
    metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
    pill: { fontSize: 11.5, color: c.textDark, fontFamily: "Inter_600SemiBold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: c.cardBeige, overflow: "hidden" },
    pillOfficial: { backgroundColor: "rgba(29,158,117,0.14)", color: c.primaryGreen },
    input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 12, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 14 },
  });
}
