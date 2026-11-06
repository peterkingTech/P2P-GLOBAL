import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, AppState } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, SegmentedControl } from "@/components/ui";
import Countdown from "@/components/evaluation/Countdown";
import { getEvaluationStatus, getEvaluatorProfile, myEvaluations, reviewing, STAGE_LABEL, type EvaluationStatus, type EvaluatorProfile, type MyEvaluation, type ReviewCard, type Stage } from "@/lib/peerEvaluationApi";

// My Evaluations (Learning Centre): my submissions' evaluations, and — for
// evaluators — invitations and evaluations I'm serving in. P2P Global
// arranges evaluators automatically; nobody here chooses or transfers one.
// Times come from the server, so countdowns stay right whatever the phone's
// clock says; the list refreshes whenever the app comes back to the front.

type Tab = "mine" | "serving";
const GROUPS: { title: string; stages: Stage[]; icon: string }[] = [
  { title: "Awaiting evaluator", stages: ["arranging"], icon: "hourglass-outline" },
  { title: "Waiting for evaluator acceptance", stages: ["invitation_pending"], icon: "mail-unread-outline" },
  { title: "Evaluation in progress", stages: ["in_progress", "overdue_reassigning"], icon: "time-outline" },
  { title: "Feedback received", stages: ["feedback_ready"], icon: "chatbubble-ellipses-outline" },
  { title: "Revision requested", stages: ["revision_required"], icon: "create-outline" },
  { title: "Completed", stages: ["completed"], icon: "checkmark-done-outline" },
];

export default function MyEvaluations() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { profile } = useAuth();
  // Evaluations assigned directly (the original path, used while the engine is off) are reviewed on the Review screen.
  const { pendingEvaluations } = useData();
  const params = useLocalSearchParams<{ tab?: string }>();
  const s = useMemo(() => makeStyles(c), [c]);
  const [tab, setTab] = useState<Tab>(params.tab === "serving" ? "serving" : "mine");
  const [mine, setMine] = useState<MyEvaluation[] | null>(null);
  const [serving, setServing] = useState<{ invitations: ReviewCard[]; inProgress: ReviewCard[]; history: ReviewCard[] } | null>(null);
  const [me, setMe] = useState<EvaluatorProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const isAdmin = ["super_admin", "admin_supervisor"].includes(String((profile as { role?: string } | null)?.role ?? ""));

  // Whether the service is running — shown apart from "no invitations" (null while unknown).
  const [service, setService] = useState<EvaluationStatus | "error" | null>(null);

  const load = useCallback(async () => {
    const [a, b, p, st] = await Promise.allSettled([myEvaluations(), reviewing(), getEvaluatorProfile(), getEvaluationStatus()]);
    setService(st.status === "fulfilled" ? st.value : "error");
    if (a.status === "fulfilled") setMine(a.value.items); else { setMine((x) => x ?? []); setError((a.reason as Error)?.message ?? "Couldn't load your evaluations."); }
    if (b.status === "fulfilled") setServing(b.value);
    if (p.status === "fulfilled") setMe(p.value);
    if (a.status === "fulfilled") setError(null);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Refresh when the app returns to the front (server time and states).
  useEffect(() => { const sub = AppState.addEventListener("change", (st) => { if (st === "active") load(); }); return () => sub.remove(); }, [load]);

  const invites = (serving?.invitations.length ?? 0) + pendingEvaluations.length;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: "My Evaluations" }} />
      <SegmentedControl accessibilityLabel="Show" value={tab} onChange={(v) => setTab(v as Tab)}
        options={[{ value: "mine", label: "My submissions" }, { value: "serving", label: invites ? `Evaluating · ${invites} new` : "Evaluating" }]} />
      {error ? <Text style={s.error}>{error}</Text> : null}

      {tab === "mine" ? (
        !mine ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 24 }} accessibilityLabel="Loading" /> :
        !mine.length ? (
          <View style={s.empty}><Ionicons name="school-outline" size={28} color={c.accentGreen} /><Text style={s.emptyText}>When you submit a lesson check, its evaluation appears here — from the moment it's received to the feedback.</Text></View>
        ) : GROUPS.map((g) => {
          const list = mine.filter((m) => g.stages.includes(m.stage));
          if (!list.length) return null;
          return (
            <View key={g.title} style={{ gap: 8 }}>
              <Text style={s.section} accessibilityRole="header">{g.title}</Text>
              {list.map((m) => (
                <Pressable key={m.id} style={s.card} onPress={() => router.push({ pathname: "/evaluation/[id]", params: { id: m.id } } as any)} accessibilityRole="button"
                  accessibilityLabel={`${m.lessonTitle}. ${STAGE_LABEL[m.stage]}${m.evaluator ? `. Evaluator ${m.evaluator.name}` : ""}`}>
                  <Ionicons name={g.icon as any} size={20} color={c.accentGreen} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.title} numberOfLines={2}>{m.lessonTitle}</Text>
                    <Text style={s.meta}>{STAGE_LABEL[m.stage]}{m.evaluator ? ` · ${m.evaluator.name}` : ""} · submitted {new Date(m.submittedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Text>
                    {m.stage === "in_progress" && m.deadlineAt ? <Countdown deadlineAt={m.deadlineAt} compact /> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
                </Pressable>
              ))}
            </View>
          );
        })
      ) : (
        <>
          {service === "error" || service?.state === "unavailable" ? (
            <View style={[s.panel, s.panelWarn]} accessibilityRole="alert">
              <View style={s.stateRow}>
                <Ionicons name="cloud-offline-outline" size={18} color={c.amber} />
                <Text style={s.title}>Peer evaluation is temporarily unavailable</Text>
              </View>
              <Text style={s.meta}>{service === "error" ? "We couldn't reach the evaluation service just now. Pull down to try again." : service.message} This isn't about you — it doesn't mean you have no invitations.</Text>
            </View>
          ) : null}
          {me ? (
            <View style={s.panel}>
              <Text style={s.title}>How you're invited to evaluate</Text>
              <Text style={s.meta}>{me.howInvited ?? "When you pass a lesson, story chapter or plan session through an independent evaluation, P2P Global may invite you to evaluate that same one."} No sign-up is needed.</Text>
              {(() => {
                const qualified = me.qualified ?? [];
                const count = Math.max(me.qualifiedResources ?? 0, qualified.length);
                const state = invites ? "invited" : count ? "qualified" : "not_qualified";
                return (
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <View style={s.stateRow}>
                      <Ionicons name={state === "invited" ? "mail-unread" : state === "qualified" ? "ribbon-outline" : "school-outline"} size={18}
                        color={state === "not_qualified" ? c.textMuted : state === "invited" ? c.amber : c.accentGreen} />
                      <Text style={s.stateTitle}>
                        {state === "invited" ? (invites === 1 ? "You have an invitation" : `You have ${invites} invitations`)
                          : state === "qualified" ? "You're qualified to evaluate" : "Not yet qualified"}
                      </Text>
                    </View>
                    {state === "not_qualified" ? (
                      <Text style={s.meta}>Pass a lesson, story chapter or plan session through its independent evaluation, and you'll be able to evaluate others on that same one.</Text>
                    ) : (
                      <>
                        <Text style={s.meta}>{count === 1 ? "You can be invited for the 1 resource you passed:" : `You can be invited for the ${count} resources you passed:`}</Text>
                        {qualified.slice(0, 8).map((q) => (
                          <Text key={q.resourceId} style={s.qualifiedItem} numberOfLines={1}>• {q.title}{q.within ? ` — ${q.within}` : ""}</Text>
                        ))}
                        {count > Math.min(8, qualified.length) ? <Text style={s.meta}>{qualified.length ? `and ${count - Math.min(8, qualified.length)} more` : "(group work and other resources)"}</Text> : null}
                        {state === "qualified" ? (
                          <Text style={s.meta}>No invitation for you right now. Invitations come only when someone submits work on a resource you passed, so there can be a while between them.</Text>
                        ) : null}
                      </>
                    )}
                  </View>
                );
              })()}
            </View>
          ) : null}
          {me ? (
            <Pressable style={s.card} onPress={() => router.push("/evaluation/orientation" as any)} accessibilityRole="button" accessibilityLabel="Evaluator guide, your availability and service record">
              <Ionicons name={me.available ? "checkmark-circle" : "pause-circle"} size={20} color={me.available ? c.accentGreen : c.amber} />
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{me.standing === "restricted" ? "Evaluating is paused" : me.available ? "You're open to invitations" : "You've paused new invitations"}</Text>
                <Text style={s.meta}>Up to {me.capacity} at a time · {me.record.completed} completed{me.recognitions.length ? ` · ${me.recognitions.map((r) => r.title).join(", ")}` : ""}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
            </Pressable>
          ) : null}

          {pendingEvaluations.length ? (
            <Pressable style={s.card} onPress={() => router.push("/evaluations" as any)} accessibilityRole="button"
              accessibilityLabel={`${pendingEvaluations.length} submissions assigned to you to review`}>
              <Ionicons name="people-circle" size={20} color={c.amber} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.title}>{pendingEvaluations.length === 1 ? "1 submission assigned to you" : `${pendingEvaluations.length} submissions assigned to you`}</Text>
                <Text style={s.meta}>Review and give feedback</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
            </Pressable>
          ) : null}

          <Text style={s.section} accessibilityRole="header">New invitations</Text>
          {!serving?.invitations.length ? <Text style={s.meta}>{serving ? "No current invitation." : "Couldn't load invitations — pull down to try again."}</Text> : serving.invitations.map((x) => (
            <Pressable key={x.assignmentId} style={s.card} onPress={() => router.push({ pathname: "/evaluation/invitation/[assignmentId]", params: { assignmentId: x.assignmentId } } as any)}
              accessibilityRole="button" accessibilityLabel={`Invitation: ${x.lessonTitle}`}>
              <Ionicons name="mail-unread" size={20} color={c.amber} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.title}>{x.lessonTitle}</Text>
                <Text style={s.meta}>Please answer by {new Date(x.inviteExpiresAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
            </Pressable>
          ))}

          <Text style={s.section} accessibilityRole="header">In progress</Text>
          {!serving?.inProgress.length ? <Text style={s.meta}>Nothing in progress.</Text> : serving.inProgress.map((x) => (
            <Pressable key={x.assignmentId} style={s.card} onPress={() => router.push({ pathname: "/evaluation/review/[id]", params: { id: x.evaluationId } } as any)}
              accessibilityRole="button" accessibilityLabel={`Evaluate ${x.evaluateeName ?? "a fellow disciple"}'s work on ${x.lessonTitle}`}>
              <Ionicons name="create-outline" size={20} color={c.accentGreen} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.title}>{x.lessonTitle}</Text>
                <Text style={s.meta}>{x.evaluateeName ?? "A fellow disciple"}</Text>
                {x.deadlineAt ? <Countdown deadlineAt={x.deadlineAt} compact /> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
            </Pressable>
          ))}

          <Text style={s.section} accessibilityRole="header">History</Text>
          {!serving?.history.length ? <Text style={s.meta}>Your past evaluations will appear here.</Text> : serving.history.slice(0, 50).map((x) => (
            <View key={x.assignmentId} style={s.histRow}>
              <Text style={[s.meta, { flex: 1 }]} numberOfLines={1}>{x.lessonTitle}</Text>
              <Text style={s.meta}>{({ completed: "Completed", declined: "Declined", expired: "Not answered", unable: "Reported unable", overdue: "Time ended", removed: "Reassigned", unavailable: "Reassigned", cancelled: "Cancelled" } as Record<string, string>)[x.status] ?? x.status}</Text>
            </View>
          ))}
        </>
      )}
      {isAdmin ? <AppButton label="Evaluation oversight" icon="shield-checkmark-outline" variant="tertiary" onPress={() => router.push("/evaluation/admin" as any)} style={{ marginTop: 16 }} /> : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 12, paddingBottom: 120 },
    error: { color: "#C0392B", fontFamily: "Inter_500Medium", fontSize: 13 },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 8 },
    card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: c.card, minHeight: 64 },
    panel: { gap: 10, padding: 16, borderRadius: 16, backgroundColor: c.card },
    panelWarn: { borderWidth: 1, borderColor: c.amber },
    stateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    stateTitle: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    qualifiedItem: { fontSize: 13, lineHeight: 18, color: c.textDark, fontFamily: "Inter_400Regular", paddingLeft: 4 },
    title: { fontSize: 15, lineHeight: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 13, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    histRow: { flexDirection: "row", gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    empty: { alignItems: "center", gap: 10, padding: 22, borderRadius: 18, backgroundColor: c.card },
    emptyText: { fontSize: 13.5, lineHeight: 19, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  });
}
