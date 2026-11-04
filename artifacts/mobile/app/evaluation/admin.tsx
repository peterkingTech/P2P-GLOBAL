import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TextInput, Switch, Alert, Platform } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, SegmentedControl } from "@/components/ui";
import {
  adminConcerns, adminEvaluators, adminHistory, adminOverview, adminReassign, adminReviewConcern, adminSetStanding, adminSettings, adminSweep,
} from "@/lib/peerEvaluationApi";

// Evaluation oversight (super admins / supervisors only — the server checks).
// See what's waiting, due, overdue, reassigned or without an evaluator; the
// sweep's health; evaluators' records (human review, never automatic
// punishment); concerns raised by evaluatees; and the engine switch. A
// reassignment here still lets the SYSTEM choose who is next.

type Tab = "overview" | "evaluators" | "concerns" | "settings";

export default function EvaluationAdmin() {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [tab, setTab] = useState<Tab>("overview");
  const [ov, setOv] = useState<Record<string, any> | null>(null);
  const [evs, setEvs] = useState<Record<string, any>[] | null>(null);
  const [concerns, setConcerns] = useState<Record<string, any>[] | null>(null);
  const [history, setHistory] = useState<Record<string, any> | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, e, cc] = await Promise.all([adminOverview(), adminEvaluators(), adminConcerns()]);
      setOv(o); setEvs(e.items); setConcerns(cc.items); setError(null);
    } catch (e: any) { setError(e?.message ?? "Couldn't load."); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const act = async (fn: () => Promise<unknown>, done: string) => { setNotice(null); try { await fn(); setNotice(done); await load(); } catch (e: any) { setNotice(e?.message ?? "That didn't work."); } };
  const confirm = (title: string, message: string, onYes: () => void) => {
    if (Platform.OS === "web") { if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes(); return; }
    Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: onYes }]);
  };

  if (!ov) return <View style={[s.screen, s.center]}><Stack.Screen options={{ title: "Evaluation oversight" }} />{error ? <Text style={s.body}>{error}</Text> : <ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" />}</View>;
  const n = ov.counts ?? {};
  const item = (x: Record<string, any>) => (
    <View key={x.id} style={s.item}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{x.lessonTitle}</Text>
        <Text style={s.meta}>{x.state}{x.deadlineAt ? ` · due ${new Date(x.deadlineAt).toLocaleString()}` : ""}{x.queuedSince ? ` · waiting since ${new Date(x.queuedSince).toLocaleString()}` : ""}{x.attempts ? ` · ${x.attempts} attempts` : ""}</Text>
      </View>
      <AppButton label="History" size="sm" variant="tertiary" onPress={() => act(async () => setHistory(await adminHistory(x.id)), "")} />
    </View>
  );
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Evaluation oversight" }} />
      <SegmentedControl accessibilityLabel="Show" value={tab} onChange={(v) => setTab(v as Tab)}
        options={[{ value: "overview", label: "Overview" }, { value: "evaluators", label: "Evaluators" }, { value: "concerns", label: `Concerns${concerns?.length ? ` · ${concerns.length}` : ""}` }, { value: "settings", label: "Settings" }]} />
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}

      {tab === "overview" ? (
        <>
          <View style={s.stats}>
            {[["Arranging", n.arranging], ["Invitations", n.invitations], ["In progress", n.inProgress], ["Due < 6 h", n.dueSoon], ["Overdue", n.overdue]].map(([l, v]) => (
              <View key={String(l)} style={s.stat}><Text style={s.statN}>{v ?? 0}</Text><Text style={s.meta}>{l}</Text></View>
            ))}
          </View>
          <View style={[s.panel, ov.health?.sweepLate && { borderLeftWidth: 4, borderLeftColor: c.amber }]}>
            <Text style={s.section}>System health</Text>
            <Text style={s.body}>Last sweep: {ov.health?.lastSweepAt ? new Date(ov.health.lastSweepAt).toLocaleString() : "never"}{ov.health?.sweepLate ? " — LATE (expected every 5 minutes)" : ""}</Text>
            {ov.health?.lastSweep ? <Text style={s.meta}>{Object.entries(ov.health.lastSweep).map(([k, v]) => `${k} ${v}`).join(" · ")}</Text> : null}
            {ov.health?.stuck?.length ? <><Text style={s.title}>Stuck</Text>{ov.health.stuck.map(item)}</> : <Text style={s.meta}>Nothing stuck.</Text>}
            <AppButton label="Run the sweep now" size="sm" variant="secondary" onPress={() => act(adminSweep, "Sweep run.")} />
          </View>
          <View style={s.panel}><Text style={s.section}>No evaluator available</Text>{ov.noEvaluator?.length ? ov.noEvaluator.map(item) : <Text style={s.meta}>None.</Text>}</View>
          <View style={s.panel}><Text style={s.section}>Due soon / overdue</Text>{ov.dueSoon?.length ? ov.dueSoon.map(item) : <Text style={s.meta}>None.</Text>}</View>
          <View style={s.panel}><Text style={s.section}>Recently reassigned</Text>{ov.recentlyReassigned?.length ? ov.recentlyReassigned.map((r: any, i: number) => <Text key={i} style={s.meta}>{r.reason} · {new Date(r.at).toLocaleString()}</Text>) : <Text style={s.meta}>None.</Text>}</View>
          {history ? (
            <View style={s.panel}>
              <Text style={s.section}>{history.lessonTitle} — {history.evaluatee}</Text>
              {history.assignments.map((a: any) => <Text key={a.id} style={s.body}>#{a.attempt} {a.evaluatorName}: {a.status}{a.end_reason ? ` (${a.end_reason})` : ""}{a.actor_type === "admin" ? " · by an administrator" : ""}</Text>)}
              <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Reason for reassigning (required)" placeholderTextColor={c.textMuted} accessibilityLabel="Reason for reassigning" />
              <AppButton label="Reassign (the system chooses who is next)" size="sm" variant="secondary" disabled={reason.trim().length < 3}
                onPress={() => confirm("Reassign", "End the current assignment and let P2P Global choose the next evaluator?", () => act(() => adminReassign(history.id, reason.trim()), "Reassigned by the system."))} />
              <AppButton label="Close" size="sm" variant="tertiary" onPress={() => setHistory(null)} />
            </View>
          ) : null}
        </>
      ) : null}

      {tab === "evaluators" ? (evs ?? []).map((e) => (
        <View key={e.userId} style={[s.panel, e.needsReview && { borderLeftWidth: 4, borderLeftColor: c.amber }]}>
          <Text style={s.title}>{e.name} · {e.standing}{e.available ? "" : " · unavailable"}{e.oriented ? "" : " · not oriented"}</Text>
          <Text style={s.meta}>{e.record.completed} completed · {e.record.onTime} on time · {e.record.missedDeadlines} missed · {e.record.declined} declined · {e.record.unableReports} unable · {e.record.ratings} ratings{e.record.substantiatedConcerns ? ` · ${e.record.substantiatedConcerns} substantiated concerns` : ""}</Text>
          {e.needsReview ? <Text style={s.meta}>Suggested: a private, human review of this record.</Text> : null}
          <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Reason (required for any change of standing)" placeholderTextColor={c.textMuted} accessibilityLabel={`Reason for ${e.name}`} />
          <View style={s.row}>
            {e.standing !== "restricted" ? <AppButton label="Restrict" size="sm" variant="destructive" disabled={reason.trim().length < 5} onPress={() => confirm("Restrict", `Pause new evaluations for ${e.name}? They'll see your reason.`, () => act(() => adminSetStanding(e.userId, { standing: "restricted", reason: reason.trim() }), "Restricted."))} /> : null}
            {e.standing !== "good" ? <AppButton label="Reinstate" size="sm" variant="secondary" disabled={reason.trim().length < 5} onPress={() => act(() => adminSetStanding(e.userId, { standing: "good", reason: reason.trim() }), "Reinstated.")} /> : null}
            {e.standing === "good" ? <AppButton label="Under review" size="sm" variant="tertiary" disabled={reason.trim().length < 5} onPress={() => act(() => adminSetStanding(e.userId, { standing: "under_review", reason: reason.trim() }), "Marked for review.")} /> : null}
            {e.available ? <AppButton label="Mark unavailable" size="sm" variant="tertiary" onPress={() => act(() => adminSetStanding(e.userId, { available: false }), "Marked unavailable.")} /> : null}
          </View>
        </View>
      )) : null}

      {tab === "concerns" ? (concerns?.length ? concerns.map((q) => (
        <View key={q.evaluation_id} style={s.panel}>
          <Text style={s.title}>About {q.evaluatorName}</Text>
          <Text style={s.meta}>Helpful {q.helpfulness} · clear {q.clarity} · respectful {q.respectfulness} · encouraging {q.encouragement} · relevant {q.relevance}</Text>
          {q.comment ? <Text style={s.body}>{q.comment}</Text> : null}
          {q.reviewed_at ? <Text style={s.meta}>Reviewed — {q.substantiated ? "substantiated" : "not substantiated"}</Text> : (
            <View style={s.row}>
              <AppButton label="Substantiated" size="sm" variant="secondary" onPress={() => act(() => adminReviewConcern(q.evaluation_id, true), "Recorded.")} />
              <AppButton label="Not substantiated" size="sm" variant="tertiary" onPress={() => act(() => adminReviewConcern(q.evaluation_id, false), "Recorded.")} />
            </View>
          )}
        </View>
      )) : <Text style={s.meta}>No concerns raised.</Text>) : null}

      {tab === "settings" ? (
        <View style={s.panel}>
          <Text style={s.section}>Peer Evaluation Engine</Text>
          <View style={s.row}>
            <Text style={[s.body, { flex: 1 }]}>Engine on (new submissions are invited, accepted, 48-hour deadline, automatic reassignment)</Text>
            <Switch value={!!ov.settings?.engine_enabled} accessibilityLabel="Peer Evaluation Engine on"
              onValueChange={(v) => confirm(v ? "Turn the engine on" : "Turn the engine off", v ? "New submissions will wait for an oriented evaluator to accept. Make sure evaluators have completed the orientation first." : "New submissions will use the previous direct assignment. Evaluations already in the engine continue.",
                () => act(() => adminSettings({ engineEnabled: v }), v ? "Engine on." : "Engine off."))}
              trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
          </View>
          <Text style={s.meta}>Invitation window: {ov.settings?.invitation_window_minutes} minutes · default capacity: {ov.settings?.default_capacity} · deadline: always 48 hours (no extensions)</Text>
          <View style={s.row}>
            {[60, 180, 360].map((m) => <AppButton key={m} label={`${m / 60} h window`} size="sm" variant={ov.settings?.invitation_window_minutes === m ? "secondary" : "tertiary"} onPress={() => act(() => adminSettings({ invitationWindowMinutes: m }), "Saved.")} />)}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", padding: 24 },
    content: { padding: 16, gap: 12, paddingBottom: 120 },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    title: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14, lineHeight: 20, color: c.textDark, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    notice: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    panel: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: c.card },
    stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    stat: { flexGrow: 1, flexBasis: 100, alignItems: "center", padding: 12, borderRadius: 14, backgroundColor: c.card },
    statN: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    item: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.lightCream, fontFamily: "Inter_400Regular", fontSize: 14 },
    row: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  });
}
