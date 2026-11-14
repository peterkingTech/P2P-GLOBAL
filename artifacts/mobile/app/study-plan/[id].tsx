import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Switch } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import { archivePlan, getPlan, savePlan, startPlan, updateRun, type DurationKey, type Pace, type PlanDetail } from "@/lib/studyPlansApi";
import { DURATIONS, PACES, dueKey, estimate, passageText, todayIso } from "@/lib/studyPlansUi";
import { getStudyDestinations, startSharedStudy, type LedGroup, type StudyPerson } from "@/lib/studyTogetherApi";

// P2P PLANS — PLAN DETAILS (owner brief §11, §8, §9). What the plan is about, what you'll study, how long it
// takes and how to follow it — individually or together (Study Together: discussion there, each person's own
// progress here). Once started: your own progress, schedule, pause / resume / change / leave, and the sessions.
// Nothing here is an exam, and nothing awards Growth Matrix credit.
function PlanDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { id, together: inviteStudy } = useLocalSearchParams<{ id: string; together?: string }>();
  const [d, setD] = useState<PlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "individual" | "together" | "join" | "reschedule">(null);
  const [duration, setDuration] = useState<DurationKey>("monthly");
  const [pace, setPace] = useState<Pace>("daily");
  const [customDays, setCustomDays] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; suggestion: { durationKey: DurationKey; days: number } | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState<{ people: StudyPerson[]; groups: LedGroup[] } | null>(null);
  const [picked, setPicked] = useState<{ people: string[]; group: LedGroup | null }>({ people: [], group: null });

  const load = useCallback(() => {
    setError(null);
    getPlan(String(id)).then((x) => {
      setD(x);
      if (!x.me) { setPace(x.plan.suggestedPace); setDuration(x.plan.suggestedDays && x.plan.suggestedDays <= 7 ? "weekly" : x.plan.suggestedDays && x.plan.suggestedDays <= 31 ? "monthly" : x.plan.suggestedDays && x.plan.suggestedDays <= 100 ? "quarterly" : "half_year"); }
    }, (e) => setError(e?.status === 503 ? t("p2pPlans.notAvailable") : e?.message ?? t("p2pPlans.notAvailable")));
  }, [id, t]);
  useFocusEffect(load);
  // Arriving from a Study Together invitation to this plan: offer to join with your own schedule.
  React.useEffect(() => { if (inviteStudy && d && !d.me && panel === null) setPanel("join"); }, [inviteStudy, d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Centered s={s} c={c} text={error} onRetry={load} t={t} insets={insets} router={router} />;
  if (!d) return <View style={[s.screen, s.center]}><Stack.Screen options={{ headerShown: false }} /><ActivityIndicator color={c.primaryGreen} accessibilityLabel={t("p2pPlans.loading")} /></View>;
  const p = d.plan, me = d.me, today = todayIso();
  const est = estimate(me ? Math.max(1, me.progress.total - me.progress.completed) : d.sessions.length, duration, pace, Number(customDays) || null);
  const sample = d.sessions.find((x) => !x.derived && x.questions.length) ?? d.sessions[0];
  const fmt = (x: string) => new Date(x + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  async function submit(sharedStudyId?: string, accept = false) {
    setBusy(true); setProblem(null); setNotice(null);
    try {
      const body = { durationKey: duration, pace, ...(duration === "custom" ? { customDays: Number(customDays) || 0 } : {}), acceptSchedule: accept };
      if (panel === "reschedule" && me) await updateRun(me.run.id, body);
      else await startPlan(p.id, { ...body, mode: sharedStudyId ? "together" : "individual", startDate, ...(sharedStudyId ? { sharedStudyId } : {}) });
      setPanel(null); setNotice(t("p2pPlans.start.started")); load();
    } catch (e: any) {
      if (e?.status === 422) setProblem({ message: e.message, suggestion: e.suggestion ?? null });
      else setNotice(e?.message ?? t("p2pPlans.notAvailable"));
    } finally { setBusy(false); }
  }
  async function startTogether(accept = false) {
    setBusy(true); setProblem(null);
    try {
      // Together reuses Study Together: create (or reopen) the group's / peers' shared study of this plan,
      // then start MY own run linked to it. Each person who joins starts their own run.
      const r = await startSharedStudy(picked.group ? { contentType: "study_plan", contentId: p.id, destination: picked.group.type, groupId: picked.group.id }
        : { contentType: "study_plan", contentId: p.id, destination: "peer", userIds: picked.people });
      setBusy(false);
      await submit(r.id, accept);
    } catch (e: any) { setBusy(false); setNotice(e?.message ?? t("p2pPlans.notAvailable")); }
  }
  const openTogether = async () => {
    setPanel("together");
    if (!dest) getStudyDestinations().then((x) => setDest({ people: x.people, groups: x.groups }), () => setDest({ people: [], groups: [] }));
  };

  const SchedulePicker = (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{t("p2pPlans.start.duration")}</Text>
      <ChipRow accessibilityLabel={t("p2pPlans.start.duration")} single>
        {DURATIONS.map((k) => <FilterChip key={k} label={t(`p2pPlans.duration.${k}`)} selected={duration === k} selection="single" onPress={() => setDuration(k)} />)}
      </ChipRow>
      {duration === "custom" ? <TextInput value={customDays} onChangeText={(v) => setCustomDays(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder={t("p2pPlans.start.customDays")} placeholderTextColor={c.textMuted} style={s.input} accessibilityLabel={t("p2pPlans.start.customDays")} /> : null}
      <Text style={s.label}>{t("p2pPlans.start.pace")}</Text>
      <ChipRow accessibilityLabel={t("p2pPlans.start.pace")} single>
        {PACES.map((k) => <FilterChip key={k} label={t(`p2pPlans.pace.${k}`)} selected={pace === k} selection="single" onPress={() => setPace(k)} />)}
      </ChipRow>
      {panel !== "reschedule" ? (
        <>
          <Text style={s.label}>{t("p2pPlans.start.startDate")}</Text>
          <ChipRow accessibilityLabel={t("p2pPlans.start.startDate")} single>
            {[["today", today], ["tomorrow", addDays(today, 1)], ["nextMonday", nextMonday(today)]].map(([k, v]) => (
              <FilterChip key={k} label={`${t(`p2pPlans.start.${k}`)} · ${fmt(v)}`} selected={startDate === v} selection="single" onPress={() => setStartDate(v)} />
            ))}
          </ChipRow>
        </>
      ) : <Text style={s.small}>{t("p2pPlans.me.rescheduleHint")}</Text>}
      <Text style={[s.meta, est.tooMuch && s.warn]}>{pace === "flexible" ? t("p2pPlans.start.previewFlexible") : est.days && est.perDay ? t("p2pPlans.start.preview", { perDay: est.perDay, days: est.days }) : ""}</Text>
      {est.tooMuch ? <Text style={s.warn}>{t("p2pPlans.start.tooMuch")}</Text> : null}
      {problem ? (
        <View style={s.notice} accessibilityRole="alert">
          <Text style={s.body}>{problem.message}</Text>
          <View style={s.buttons}>
            {problem.suggestion ? <AppButton size="sm" label={t("p2pPlans.start.useSuggestion", { duration: t(`p2pPlans.duration.${problem.suggestion.durationKey}`) })}
              onPress={() => { setDuration(problem.suggestion!.durationKey); if (problem.suggestion!.durationKey === "custom") setCustomDays(String(problem.suggestion!.days)); setProblem(null); }} /> : null}
            <AppButton size="sm" variant="secondary" label={t("p2pPlans.start.keepAnyway")} onPress={() => (panel === "together" ? startTogether(true) : submit(panel === "join" ? String(inviteStudy) : undefined, true))} />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("p2pPlans.back")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">{p.title}</Text>
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.kicker}>{t(`p2pPlans.focus.${p.focusType}`)} · {p.focusLabel}</Text>
        <Text style={s.h1}>{p.title}</Text>
        <View style={s.buttons}>
          <Text style={[s.pill, p.official && s.pillOfficial]}>{p.official ? t("p2pPlans.official") : p.mine ? t("p2pPlans.yourPlan") : t("p2pPlans.participant")}</Text>
          {p.editorialStatus !== "published" && p.official ? <Text style={s.pill}>{t("p2pPlans.draft")} · {p.editorialStatus}</Text> : null}
        </View>
        {p.description ? <Text style={s.body}>{p.description}</Text> : null}
        {!p.official ? <Text style={s.small}>{t("p2pPlans.detail.notOfficial")}</Text> : null}
        {notice ? <Text style={s.noticeText} accessibilityRole="alert">{notice}</Text> : null}

        {/* ── My run ── */}
        {me ? (
          <View style={s.card}>
            <Text style={s.label}>{t("p2pPlans.me.yourProgress")}</Text>
            <Text style={s.big}>{t("p2pPlans.progress", { completed: me.progress.completed, total: me.progress.total })}</Text>
            <Text style={s.meta}>{t("p2pPlans.me.schedule", { pace: t(`p2pPlans.pace.${me.run.pace}`), duration: t(`p2pPlans.duration.${me.run.durationKey}`) })} · {t(`p2pPlans.mode.${me.run.mode}`)}</Text>
            {me.run.status === "paused" ? <Text style={s.body}>{t("p2pPlans.me.pausedNote")}</Text> : null}
            {me.run.status === "completed" || me.progress.finished ? <Text style={s.body}>✓ {t("p2pPlans.me.completedNote")}</Text> : null}
            {!p.derived && d.sessions.some((x) => x.questions.length) ? (
              <View style={s.rowBetween}>
                <Text style={s.body}>{t("p2pPlans.me.showQuestions")}</Text>
                <Switch value={me.run.showQuestions} accessibilityLabel={t("p2pPlans.me.showQuestions")}
                  onValueChange={(v) => updateRun(me.run.id, { showQuestions: v }).then(load, () => {})} />
              </View>
            ) : null}
            <View style={s.buttons}>
              {me.run.status === "active" ? <AppButton size="sm" variant="secondary" icon="pause" label={t("p2pPlans.me.pause")} onPress={() => updateRun(me.run.id, { action: "pause" }).then(load)} /> : null}
              {me.run.status === "paused" ? <AppButton size="sm" icon="play" label={t("p2pPlans.me.resume")} onPress={() => updateRun(me.run.id, { action: "resume" }).then(load)} /> : null}
              {me.run.status !== "completed" ? <AppButton size="sm" variant="secondary" icon="calendar-outline" label={t("p2pPlans.me.changeSchedule")} onPress={() => { setDuration(me.run.durationKey); setPace(me.run.pace); setPanel("reschedule"); }} /> : null}
              {me.run.sharedStudyId ? <AppButton size="sm" variant="secondary" icon="people-outline" label={t("p2pPlans.me.openTogether")} onPress={() => router.push({ pathname: "/study-together/[id]", params: { id: me.run.sharedStudyId! } } as any)} /> : null}
              <AppButton size="sm" variant="tertiary" label={t("p2pPlans.me.leave")} onPress={() => updateRun(me.run.id, { action: "leave" }).then(load)} />
            </View>
            {panel === "reschedule" ? <View style={s.panel}>{SchedulePicker}<View style={s.buttons}><AppButton label={t("p2pPlans.me.changeSchedule")} disabled={busy} onPress={() => submit()} /><AppButton variant="tertiary" label={t("p2pPlans.start.cancel")} onPress={() => setPanel(null)} /></View></View> : null}
          </View>
        ) : null}

        {/* ── About the plan ── */}
        <View style={s.card}>
          <Row s={s} label={t("p2pPlans.detail.mainFocus")} value={`${p.focusLabel} (${t(`p2pPlans.focus.${p.focusType}`)})`} />
          <Row s={s} label={t("p2pPlans.detail.primary")} value={(p.primaryKinds ?? []).map((k) => t(`p2pPlans.kind.${k}`)).join(", ")} />
          <Row s={s} label={t("p2pPlans.detail.supporting")} value={(p.supportingKinds ?? []).length ? (p.supportingKinds ?? []).map((k) => t(`p2pPlans.kind.${k}`)).join(", ") : t("p2pPlans.detail.noSupporting")} />
          <Row s={s} label={t("p2pPlans.detail.sessions")} value={t("p2pPlans.sessions", { count: d.sessions.length })} />
          <Row s={s} label={t("p2pPlans.detail.suggested")} value={p.suggestedDays && p.suggestedPace !== "flexible" ? t("p2pPlans.detail.suggestedValue", { pace: t(`p2pPlans.pace.${p.suggestedPace}`), days: p.suggestedDays }) : t("p2pPlans.detail.suggestedFlexible", { pace: t(`p2pPlans.pace.${p.suggestedPace}`) })} />
          <Row s={s} label={t("p2pPlans.detail.mode")} value={p.togetherSuitable ? t("p2pPlans.detail.modeBoth") : t("p2pPlans.detail.modeIndividual")} />
          {!p.derived ? <Row s={s} label={t("p2pPlans.detail.questions")} value={p.questionsIncluded ? t("p2pPlans.detail.questionsYes") : t("p2pPlans.detail.questionsNo")} /> : null}
          {p.objectives.length ? (
            <View style={{ gap: 2, marginTop: 4 }}>
              <Text style={s.label}>{t("p2pPlans.detail.objectives")}</Text>
              {p.objectives.map((o) => <Text key={o} style={s.body}>• {o}</Text>)}
            </View>
          ) : null}
          <Text style={s.small}>{p.derived ? t("p2pPlans.detail.derivedNote") : t("p2pPlans.detail.noExam")}</Text>
        </View>

        {/* ── Start ── */}
        {!me ? (
          <View style={{ gap: 10 }}>
            {panel === null ? (
              <View style={s.buttons}>
                <AppButton icon="person-outline" label={t("p2pPlans.detail.startIndividually")} onPress={() => setPanel("individual")} />
                {p.togetherSuitable ? <AppButton icon="people-outline" variant="secondary" label={t("p2pPlans.detail.startTogether")} onPress={openTogether} /> : null}
                <AppButton icon={p.saved ? "bookmark" : "bookmark-outline"} variant="tertiary" label={p.saved ? t("p2pPlans.detail.unsave") : t("p2pPlans.detail.save")} onPress={() => savePlan(p.id, !p.saved).then(load)} />
              </View>
            ) : (
              <View style={s.panel}>
                <Text style={s.cardTitle}>{panel === "join" ? t("p2pPlans.start.joinTogether") : panel === "together" ? t("p2pPlans.start.togetherTitle") : t("p2pPlans.start.title")}</Text>
                {panel === "join" ? <Text style={s.small}>{t("p2pPlans.start.joinHint")}</Text> : null}
                {panel === "together" ? (
                  <View style={{ gap: 6 }}>
                    <Text style={s.small}>{t("p2pPlans.start.togetherHint")}</Text>
                    {!dest ? <ActivityIndicator color={c.primaryGreen} /> : !dest.people.length && !dest.groups.length ? <Text style={s.meta}>{t("p2pPlans.start.noOne")}</Text> : (
                      <>
                        {dest.groups.length ? <Text style={s.label}>{t("p2pPlans.start.groups")}</Text> : null}
                        <ChipRow accessibilityLabel={t("p2pPlans.start.groups")} single>
                          {dest.groups.map((g) => <FilterChip key={g.id} label={g.name} selected={picked.group?.id === g.id} selection="single" onPress={() => setPicked({ people: [], group: picked.group?.id === g.id ? null : g })} />)}
                        </ChipRow>
                        {dest.people.length ? <Text style={s.label}>{t("p2pPlans.start.people")}</Text> : null}
                        <ChipRow accessibilityLabel={t("p2pPlans.start.people")}>
                          {dest.people.map((x) => <FilterChip key={x.id} label={x.name} selected={picked.people.includes(x.id)}
                            onPress={() => setPicked({ group: null, people: picked.people.includes(x.id) ? picked.people.filter((y) => y !== x.id) : [...picked.people, x.id].slice(0, 5) })} />)}
                        </ChipRow>
                      </>
                    )}
                  </View>
                ) : null}
                {SchedulePicker}
                <View style={s.buttons}>
                  <AppButton label={t("p2pPlans.start.confirm")} disabled={busy || (panel === "together" && !picked.group && !picked.people.length)}
                    onPress={() => (panel === "together" ? startTogether() : submit(panel === "join" ? String(inviteStudy) : undefined))} />
                  <AppButton variant="tertiary" label={t("p2pPlans.start.cancel")} onPress={() => { setPanel(null); setProblem(null); }} />
                </View>
              </View>
            )}
            {sample && !sample.derived ? (
              <View style={s.card}>
                <Text style={s.label}>{t("p2pPlans.detail.sample")}</Text>
                <Text style={s.cardTitle}>{sample.title}</Text>
                <Text style={s.meta}>{sample.passages.map((x) => x.display ?? passageText(x)).join("; ")}</Text>
                {sample.intro ? <Text style={s.body}>{sample.intro}</Text> : null}
                {sample.questions.slice(0, 2).map((q) => <Text key={q.text} style={s.body}>• {q.text}</Text>)}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Sessions ── */}
        <Text style={s.section} accessibilityRole="header">{t("p2pPlans.detail.whatYouStudy")}</Text>
        {d.sessions.map((x) => {
          const sch = me?.schedule.find((y) => y.id === x.id);
          const done = !!sch?.done;
          const due = me && !done ? dueKey(sch?.dueDate ?? null, today) : null;
          return (
            <TouchableOpacity key={x.id} style={[s.session, me?.progress.currentId === x.id && s.sessionCurrent]} accessibilityRole="button"
              accessibilityLabel={`${t("p2pPlans.session.label", { n: x.position })}: ${x.title}${done ? `. ${t("p2pPlans.session.done")}` : ""}`}
              onPress={() => router.push({ pathname: "/study-plan/session", params: { id: p.id, session: x.id } } as any)}>
              <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={20} color={done ? c.primaryGreen : c.textMuted} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={s.sessionTitle}>{x.position}. {x.title}</Text>
                <Text style={s.small}>{x.derived ? x.group ?? "" : x.passages.map((y) => y.display ?? passageText(y)).join("; ")}{due ? ` · ${t(`p2pPlans.${due.key}`, { date: due.date ? fmt(due.date) : "" })}` : ""}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textMid} />
            </TouchableOpacity>
          );
        })}
        <Text style={s.small}>{d.note}</Text>
        {p.canEdit && p.mine ? (
          <View style={s.buttons}>
            <AppButton size="sm" variant="secondary" icon="create-outline" label={t("p2pPlans.detail.edit")} onPress={() => router.push({ pathname: "/plans/builder", params: { id: p.id } } as any)} />
            <AppButton size="sm" variant="tertiary" label={t("p2pPlans.detail.archive")} onPress={() => archivePlan(p.id).then(() => { setNotice(t("p2pPlans.detail.archived")); router.back(); })} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
function Row({ s, label, value }: { s: ReturnType<typeof makeStyles>; label: string; value: string }) {
  return <View style={s.row} accessible accessibilityLabel={`${label}: ${value}`}><Text style={s.rowLabel}>{label}</Text><Text style={s.rowValue}>{value}</Text></View>;
}
function Centered({ s, c, text, onRetry, t, insets, router }: any) {
  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}><IconButton icon="chevron-back" accessibilityLabel={t("p2pPlans.back")} onPress={() => router.back()} color={c.textDark} /></View>
      <View style={[s.center, { padding: 24, gap: 10 }]}><Text style={s.cardTitle}>{text}</Text><AppButton size="sm" variant="secondary" label={t("p2pPlans.tryAgain")} onPress={onRetry} /></View>
    </View>
  );
}
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return todayIso(d); };
const nextMonday = (iso: string) => { const d = new Date(iso + "T12:00:00"); const add = ((8 - d.getDay()) % 7) || 7; return addDays(iso, add); };

export default withScreenBoundary(PlanDetailsScreen, "Plan");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", flex: 1 },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, gap: 12, width: "100%", maxWidth: 860, alignSelf: "center" },
    h1: { fontSize: 24, color: c.textDark, fontFamily: "Inter_700Bold" },
    big: { fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    warn: { color: c.amber, fontFamily: "Inter_600SemiBold", fontSize: 13 },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
    section: { fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 8 },
    card: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    panel: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: c.card, borderWidth: 2, borderColor: c.accentGreen },
    cardTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
    row: { flexDirection: "row", gap: 12, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    rowLabel: { width: 130, fontSize: 13, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    rowValue: { flex: 1, fontSize: 13.5, color: c.textDark, fontFamily: "Inter_400Regular" },
    pill: { fontSize: 11.5, color: c.textDark, fontFamily: "Inter_600SemiBold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: c.cardBeige, overflow: "hidden" },
    pillOfficial: { backgroundColor: "rgba(29,158,117,0.14)", color: c.primaryGreen },
    notice: { padding: 10, gap: 6, borderRadius: 10, backgroundColor: c.cardBeige },
    noticeText: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_600SemiBold", padding: 10, borderRadius: 10, backgroundColor: c.cardBeige },
    input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.lightCream, paddingHorizontal: 12, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 14 },
    session: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, padding: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    sessionCurrent: { borderColor: c.accentGreen, borderWidth: 2 },
    sessionTitle: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
