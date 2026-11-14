import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import GroupChooser, { type GroupChoice } from "@/components/plans/GroupChooser";
import { attachGroupPlan, createGroupFromPlan, getPlan, startPlan, type DurationKey, type Pace, type PlanDetail } from "@/lib/studyPlansApi";
import { DURATIONS, PACES, newClientKey, todayIso } from "@/lib/studyPlansUi";

// P2P PLANS — STUDY A PLAN TOGETHER (brief §11): choose a group you lead, or create a new private group from
// this plan (its title and description are filled in for you). The ACTUAL plan is attached — never a copy —
// with the group's own schedule; each member keeps their own progress. Retry-safe.
function TogetherScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const [d, setD] = useState<PlanDetail | null>(null);
  const [group, setGroup] = useState<GroupChoice | null>(null);
  const [duration, setDuration] = useState<DurationKey>("monthly");
  const [pace, setPace] = useState<Pace>("daily");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef({ group: newClientKey(), attach: newClientKey() });
  useEffect(() => { getPlan(String(planId)).then((x) => { setD(x); setPace(x.plan.suggestedPace); }, (e) => setError(e?.message ?? t("p2pPlans.notAvailable"))); }, [planId, t]);

  async function go() {
    if (!d || !group) return;
    setBusy(true); setError(null);
    const schedule = { durationKey: duration, pace, startDate: todayIso() };
    try {
      let type: string, id: string, studyId: string, fresh = false;
      if (group.kind === "existing") { const r = await attachGroupPlan(group.type, group.id, { planId: d.plan.id, schedule, clientKey: keys.current.attach }); type = group.type; id = group.id; studyId = r.studyId; }
      else { const r = await createGroupFromPlan(d.plan.id, { name: group.name.trim(), description: group.description.trim() || null, schedule, clientKey: keys.current.group }); type = r.groupType; id = r.groupId; studyId = r.studyId; fresh = !r.existing; }
      // Your own run in the group (skipped if you already follow this plan).
      await startPlan(d.plan.id, { mode: "together", sharedStudyId: studyId, durationKey: duration, pace, startDate: todayIso(), acceptSchedule: true }).catch(() => null);
      router.replace({ pathname: "/plans/group", params: { type, id, ...(fresh ? { invite: "1" } : {}) } } as any);
    } catch (e: any) { setError(e?.message ?? t("p2pPlans.notAvailable")); } finally { setBusy(false); }
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="close" accessibilityLabel={t("p2pPlans.builder.cancel")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{t("p2pPlans.together.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        {!d ? (error ? <Text style={s.error}>{error}</Text> : <ActivityIndicator color={c.primaryGreen} accessibilityLabel={t("p2pPlans.loading")} />) : (
          <>
            <Text style={s.kicker}>{d.plan.focusLabel}</Text>
            <Text style={s.h1}>{d.plan.title}</Text>
            <GroupChooser value={group} onChange={setGroup} defaultName={d.plan.title.slice(0, 80)} defaultDescription={d.plan.description ?? t("p2pPlans.together.defaultDescription", { focus: d.plan.focusLabel })} />
            <Text style={s.label}>{t("p2pPlans.group.groupSchedule")}</Text>
            <ChipRow accessibilityLabel={t("p2pPlans.builder.duration")} single>{DURATIONS.filter((k) => k !== "custom").map((k) => <FilterChip key={k} label={t(`p2pPlans.duration.${k}`)} selected={duration === k} selection="single" onPress={() => setDuration(k)} />)}</ChipRow>
            <ChipRow accessibilityLabel={t("p2pPlans.builder.pace")} single>{PACES.map((k) => <FilterChip key={k} label={t(`p2pPlans.pace.${k}`)} selected={pace === k} selection="single" onPress={() => setPace(k)} />)}</ChipRow>
            <Text style={s.small}>{t("p2pPlans.together.ownProgress")}</Text>
            {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
            <AppButton icon="people" label={group?.kind === "new" ? t("p2pPlans.together.createAndStart") : t("p2pPlans.together.attachAndStart")} onPress={go}
              disabled={busy || !group || (group.kind === "new" && !group.name.trim())} loading={busy} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default withScreenBoundary(TogetherScreen, "Study together");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, gap: 12, width: "100%", maxWidth: 760, alignSelf: "center" },
    h1: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6 },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    error: { fontSize: 13, color: c.amber, fontFamily: "Inter_600SemiBold" },
  });
}
