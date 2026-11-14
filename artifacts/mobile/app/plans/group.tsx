import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import { attachGroupPlan, completeGroupPlan, getGroupPlans, getPlans, type DurationKey, type GroupPlanItem, type GroupPlans, type Pace, type PlanCard } from "@/lib/studyPlansApi";
import { getStudyDestinations, type StudyPerson } from "@/lib/studyTogetherApi";
import { invite } from "@/lib/groupsApi";
import { DURATIONS, PACES, newClientKey } from "@/lib/studyPlansUi";
import { confirmAction } from "@/lib/alerts";

// P2P PLANS — A GROUP'S PLANS (brief §11–12). The group and its plans have separate lives: one ACTIVE plan,
// the COMPLETED plans kept as history (members can revisit them), and — for the group's leaders — choosing
// another plan when they are ready. Nothing starts by itself. Members see their OWN progress and group-level
// counts only; reflections, answers and assessments stay private. Discussion and calls are the group's own
// chat (the existing messaging), never a second system.
function GroupPlansScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { type, id, invite: inviteParam } = useLocalSearchParams<{ type: string; id: string; invite?: string }>();
  const [data, setData] = useState<GroupPlans | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [catalogue, setCatalogue] = useState<PlanCard[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [duration, setDuration] = useState<DurationKey>("monthly");
  const [pace, setPace] = useState<Pace>("daily");
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<StudyPerson[] | null>(null);
  const [invitees, setInvitees] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [attachKey] = useState(newClientKey);
  const showInvite = inviteParam === "1" || type === "private_group";

  const load = useCallback(() => {
    setError(null);
    getGroupPlans(String(type), String(id)).then(setData, (e) => setError(e?.status === 404 ? t("p2pPlans.group.unavailable") : e?.message ?? t("p2pPlans.notAvailable")));
  }, [type, id, t]);
  useFocusEffect(load);
  const openChoose = () => { setChoosing(true); if (!catalogue) getPlans().then((r) => setCatalogue(r.plans.filter((p) => !p.draft)), () => setCatalogue([])); };
  const loadPeople = () => { if (!people) getStudyDestinations().then((r) => setPeople(r.people), () => setPeople([])); };
  const confirm = (msg: string, go: () => void) => confirmAction(t("p2pPlans.group.complete"), msg, go, { confirmLabel: t("p2pPlans.group.confirm"), cancelLabel: t("p2pPlans.builder.cancel") });
  async function complete(item: GroupPlanItem) {
    setBusy(true);
    try { await completeGroupPlan(String(type), String(id), item.studyId); setNotice(t("p2pPlans.group.completedNotice")); load(); }
    catch (e: any) { setError(e?.message ?? t("p2pPlans.notAvailable")); } finally { setBusy(false); }
  }
  async function attach() {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      await attachGroupPlan(String(type), String(id), { planId: picked, schedule: { durationKey: duration, pace }, clientKey: attachKey });
      setChoosing(false); setPicked(null); setNotice(t("p2pPlans.group.attachedNotice")); load();
    } catch (e: any) { setError(e?.message ?? t("p2pPlans.notAvailable")); } finally { setBusy(false); }
  }
  async function sendInvites() {
    setBusy(true);
    try { const r = await invite(String(id), [...invitees]); setNotice(t("p2pPlans.group.invited", { count: r.invited })); setInvitees(new Set()); }
    catch (e: any) { setError(e?.message ?? t("p2pPlans.notAvailable")); } finally { setBusy(false); }
  }
  const openPlan = (item: GroupPlanItem) => router.push({ pathname: "/study-plan/[id]", params: { id: item.plan.id, together: item.studyId } } as any);

  const PlanItem = ({ item, active }: { item: GroupPlanItem; active: boolean }) => (
    <View style={[s.card, active && s.activeCard]}>
      <View style={s.rowBetween}>
        <Text style={s.kicker}>{active ? t("p2pPlans.group.activePlan") : t("p2pPlans.group.completedOn", { date: item.completedAt ? fmt(item.completedAt) : "" })}</Text>
        {item.schedule ? <Text style={s.pill}>{t(`p2pPlans.duration.${item.schedule.durationKey}`)} · {t(`p2pPlans.pace.${item.schedule.pace}`)}</Text> : null}
      </View>
      <Text style={s.cardTitle}>{item.plan.title}</Text>
      {item.plan.focusLabel ? <Text style={s.small}>{t(`p2pPlans.focus.${item.plan.focusType}`)} · {item.plan.focusLabel}</Text> : null}
      <Text style={s.body}>{t("p2pPlans.group.overview", { following: item.overview.following, members: item.overview.members, finished: item.overview.finished })}</Text>
      <Text style={s.mine}>{item.mine ? (item.mine.finished ? t("p2pPlans.group.youFinished") : t("p2pPlans.progress", { completed: item.mine.completed, total: item.mine.total })) : active ? t("p2pPlans.group.notJoined") : t("p2pPlans.group.notInThisPlan")}</Text>
      <View style={s.buttons}>
        {!item.plan.unavailable ? <AppButton size="sm" icon="open-outline" label={active ? (item.mine ? t("p2pPlans.group.continue") : t("p2pPlans.group.join")) : t("p2pPlans.group.revisit")} onPress={() => openPlan(item)} /> : <Text style={s.small}>{t("p2pPlans.group.planUnavailable")}</Text>}
        {active && data?.canLead ? <AppButton size="sm" variant="secondary" icon="flag-outline" label={t("p2pPlans.group.complete")} disabled={busy}
          onPress={() => confirm(t("p2pPlans.group.completeConfirm"), () => complete(item))} /> : null}
      </View>
    </View>
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel={t("p2pPlans.back")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header" numberOfLines={1}>{data?.group.name ?? t("p2pPlans.group.title")}</Text>
        {type === "private_group" ? <IconButton icon="chatbubbles-outline" accessibilityLabel={t("p2pPlans.group.openChat")} onPress={() => router.push(`/messages/${id}` as any)} color={c.textDark} /> : null}
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
        {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
        {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
        {!data && !error ? <ActivityIndicator color={c.primaryGreen} accessibilityLabel={t("p2pPlans.loading")} /> : null}
        {data ? (
          <>
            <View style={s.groupHead}>
              <View style={s.avatar}><Ionicons name="people" size={22} color={c.accentGreen} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.h1}>{data.group.name ?? t("p2pPlans.group.title")}</Text>
                <Text style={s.small}>{t(`p2pPlans.together.kind.${data.group.type}`)} · {t("p2pPlans.together.members", { count: data.group.members })}</Text>
              </View>
            </View>
            {data.group.description ? <Text style={s.body}>{data.group.description}</Text> : null}
            <Text style={s.small}>{t("p2pPlans.group.privacy")}</Text>

            <Text style={s.section} accessibilityRole="header">{t("p2pPlans.group.activePlan")}</Text>
            {data.active ? <PlanItem item={data.active} active /> : (
              <View style={s.card}>
                <Text style={s.body}>{data.history.length ? t("p2pPlans.group.readyForNext") : t("p2pPlans.group.noPlanYet")}</Text>
                {data.canLead ? (
                  <View style={s.buttons}>
                    <AppButton size="sm" icon="albums-outline" label={t("p2pPlans.group.choosePrepared")} onPress={openChoose} />
                    <AppButton size="sm" variant="secondary" icon="sparkles-outline" label={t("p2pPlans.group.discoverTopic")} onPress={() => router.push({ pathname: "/plans/discover", params: { group: `${type}:${id}` } } as any)} />
                    <AppButton size="sm" variant="secondary" icon="construct-outline" label={t("p2pPlans.group.buildNew")} onPress={() => router.push({ pathname: "/plans/builder", params: { group: `${type}:${id}` } } as any)} />
                  </View>
                ) : <Text style={s.small}>{t("p2pPlans.group.leadersChoose")}</Text>}
              </View>
            )}

            {choosing && !data.active ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>{t("p2pPlans.group.choosePrepared")}</Text>
                {!catalogue ? <ActivityIndicator color={c.primaryGreen} /> : catalogue.length ? catalogue.map((p) => (
                  <TouchableOpacity key={p.id} style={[s.option, picked === p.id && s.optionOn]} onPress={() => setPicked(p.id)} accessibilityRole="radio" accessibilityState={{ selected: picked === p.id }} accessibilityLabel={p.title}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.optionTitle}>{p.title}</Text>
                      <Text style={s.small}>{p.official ? t("p2pPlans.official") : t("p2pPlans.yourPlan")} · {p.focusLabel}</Text>
                    </View>
                    {picked === p.id ? <Ionicons name="checkmark-circle" size={20} color={c.primaryGreen} /> : null}
                  </TouchableOpacity>
                )) : <Text style={s.meta}>{t("p2pPlans.group.noPlansToChoose")}</Text>}
                <Text style={s.label}>{t("p2pPlans.group.groupSchedule")}</Text>
                <ChipRow accessibilityLabel={t("p2pPlans.builder.duration")} single>{DURATIONS.filter((d) => d !== "custom").map((k) => <FilterChip key={k} label={t(`p2pPlans.duration.${k}`)} selected={duration === k} selection="single" onPress={() => setDuration(k)} />)}</ChipRow>
                <ChipRow accessibilityLabel={t("p2pPlans.builder.pace")} single>{PACES.map((k) => <FilterChip key={k} label={t(`p2pPlans.pace.${k}`)} selected={pace === k} selection="single" onPress={() => setPace(k)} />)}</ChipRow>
                <View style={s.buttons}>
                  <AppButton icon="checkmark" label={t("p2pPlans.group.startThis")} onPress={attach} disabled={!picked || busy} loading={busy} />
                  <AppButton variant="tertiary" label={t("p2pPlans.builder.cancel")} onPress={() => setChoosing(false)} />
                </View>
              </View>
            ) : null}

            <Text style={s.section} accessibilityRole="header">{t("p2pPlans.group.completedPlans")}</Text>
            {data.history.length ? data.history.map((h) => <PlanItem key={h.studyId} item={h} active={false} />) : <Text style={s.meta}>{t("p2pPlans.group.noHistory")}</Text>}

            {showInvite && data.canLead && type === "private_group" ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>{t("p2pPlans.group.inviteTitle")}</Text>
                <Text style={s.small}>{t("p2pPlans.group.inviteHint")}</Text>
                {!people ? <AppButton size="sm" variant="secondary" icon="person-add-outline" label={t("p2pPlans.group.invitePeople")} onPress={loadPeople} /> : people.length ? (
                  <>
                    <ChipRow accessibilityLabel={t("p2pPlans.group.invitePeople")}>
                      {people.map((p) => <FilterChip key={p.id} label={p.name} selected={invitees.has(p.id)} onPress={() => setInvitees((x) => { const n = new Set(x); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />)}
                    </ChipRow>
                    <AppButton size="sm" icon="send-outline" label={t("p2pPlans.group.sendInvites", { count: invitees.size })} disabled={!invitees.size || busy} onPress={sendInvites} />
                  </>
                ) : <Text style={s.meta}>{t("p2pPlans.group.noPeople")}</Text>}
                <Text style={s.small}>{t("p2pPlans.group.inviteLater")}</Text>
              </View>
            ) : null}
            <Text style={s.small}>{data.note}</Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default withScreenBoundary(GroupPlansScreen, "Group plans");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, gap: 12, width: "100%", maxWidth: 820, alignSelf: "center" },
    h1: { fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    groupHead: { flexDirection: "row", alignItems: "center", gap: 12 },
    avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: c.cardBeige },
    section: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 8 },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    mine: { fontSize: 13.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    error: { fontSize: 13, color: c.amber, fontFamily: "Inter_600SemiBold" },
    notice: { fontSize: 13, color: c.primaryGreen, fontFamily: "Inter_600SemiBold" },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, flexShrink: 1 },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
    card: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    activeCard: { borderColor: c.primaryGreen, borderWidth: 1.5 },
    cardTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
    pill: { fontSize: 11.5, color: c.textDark, fontFamily: "Inter_600SemiBold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: c.cardBeige, overflow: "hidden" },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    option: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    optionOn: { backgroundColor: c.cardBeige },
    optionTitle: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
