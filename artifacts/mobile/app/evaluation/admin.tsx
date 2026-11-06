import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TextInput, Switch, Alert, Platform } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, SegmentedControl } from "@/components/ui";
import {
  adminConcerns, adminCoverage, adminEvaluators, adminHistory, adminIntegrity, adminIntegrityReview, adminOperations, adminOverview, adminReassign, adminRecordRevision,
  adminReadiness, adminReviewConcern, adminSetStanding, adminSettings, adminSweep, type EvaluationReadiness,
} from "@/lib/peerEvaluationApi";

// Evaluation oversight (super admins / supervisors only — the server checks).
// See what's waiting, due, overdue, reassigned or without an evaluator; the
// sweep's health; which resources have nobody qualified yet (240: only people
// who passed THAT resource independently are invited); evaluators' records
// (human review, never automatic punishment); concerns raised by evaluatees;
// and the owner's switches. A reassignment here still lets the SYSTEM choose who is next.

type Tab = "overview" | "evaluators" | "concerns" | "settings";

export default function EvaluationAdmin() {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [tab, setTab] = useState<Tab>("overview");
  const [ov, setOv] = useState<Record<string, any> | null>(null);
  const [evs, setEvs] = useState<Record<string, any>[] | null>(null);
  const [concerns, setConcerns] = useState<Record<string, any>[] | null>(null);
  const [coverage, setCoverage] = useState<{ title: string; context: string | null; waiting: number; hasQualifiedPeople: boolean }[] | null>(null);
  const [ops, setOps] = useState<Awaited<ReturnType<typeof adminOperations>> | null>(null);
  const [pairs, setPairs] = useState<Awaited<ReturnType<typeof adminIntegrity>>["items"] | null>(null);
  const [history, setHistory] = useState<Record<string, any> | null>(null);
  const [ready, setReady] = useState<EvaluationReadiness | "error" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, e, cc, cv, op, ip, rd] = await Promise.all([adminOverview(), adminEvaluators(), adminConcerns(), adminCoverage().catch(() => ({ items: [] })),
        adminOperations().catch(() => null), adminIntegrity().catch(() => ({ items: [] })), adminReadiness().catch(() => "error" as const)]);
      setOv(o); setEvs(e.items); setConcerns(cc.items); setCoverage(cv.items); setOps(op); setPairs(ip.items); setReady(rd); setError(null);
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
          {/* Readiness: is the platform able to run peer evaluation right now (counts only — no answers). */}
          <View style={[s.panel, (ready === "error" || ready?.state !== "ready") && { borderLeftWidth: 4, borderLeftColor: c.amber }]}>
            <Text style={s.section}>Readiness</Text>
            {ready === null ? <ActivityIndicator color={c.accentGreen} accessibilityLabel="Checking readiness" />
              : ready === "error" ? <Text style={s.body}>Couldn't check readiness — the evaluation service didn't answer.</Text> : (
              <>
                <Text style={s.body}>{ready.state === "ready" ? "Ready — automatic invitations are running." : ready.state === "coordinators" ? "Running the earlier way — the engine is off, so coordinators arrange evaluations." : "Unavailable — participants are being told, and admins alerted."}</Text>
                {ready.checks.map((k) => (
                  <Text key={k.key} style={s.meta}>{k.ok === true ? "✓" : k.ok === false ? "✗" : "–"} {k.label} — {k.detail}</Text>
                ))}
                <Text style={s.meta}>
                  {ready.counts.qualifiedEvaluators} qualified evaluators · {ready.counts.pending} pending · {ready.counts.matchingFailures} waiting with nobody qualified · {ready.counts.undeliveredInvitations} undelivered invitations · {ready.counts.expired30d} expired / {ready.counts.reassigned30d} reassigned (30 days)
                </Text>
                {ready.coverageGaps.length ? (
                  <Text style={s.meta}>Coverage gaps: {ready.coverageGaps.slice(0, 10).map((g) => `${g.title} (${g.waiting})`).join(" · ")}{ready.coverageGaps.length > 10 ? ` · and ${ready.coverageGaps.length - 10} more` : ""}</Text>
                ) : <Text style={s.meta}>No coverage gaps.</Text>}
              </>
            )}
          </View>
          <View style={[s.panel, ov.health?.sweepLate && { borderLeftWidth: 4, borderLeftColor: c.amber }]}>
            <Text style={s.section}>System health</Text>
            <Text style={s.body}>Last sweep: {ov.health?.lastSweepAt ? new Date(ov.health.lastSweepAt).toLocaleString() : "never"}{ov.health?.sweepLate ? " — LATE (expected every 5 minutes)" : ""}</Text>
            {ov.health?.lastSweep ? <Text style={s.meta}>{Object.entries(ov.health.lastSweep).map(([k, v]) => `${k} ${v}`).join(" · ")}</Text> : null}
            {ov.health?.stuck?.length ? <><Text style={s.title}>Stuck</Text>{ov.health.stuck.map(item)}</> : <Text style={s.meta}>Nothing stuck.</Text>}
            <AppButton label="Run the sweep now" size="sm" variant="secondary" onPress={() => act(adminSweep, "Sweep run.")} />
          </View>
          {ops ? (
            <View style={s.panel}>
              <Text style={s.section}>Evaluator operations</Text>
              <Text style={s.body}>{ops.qualifiedEvaluators} qualified evaluator{ops.qualifiedEvaluators === 1 ? "" : "s"} across {ops.resourcesWithQualifiedPeople} resource{ops.resourcesWithQualifiedPeople === 1 ? "" : "s"} · {ops.pending} pending · {ops.unassigned} without an evaluator</Text>
              <Text style={s.meta}>Last 30 days: {ops.expired30d} invitations expired · {ops.reassigned30d} reassigned · median {ops.medianHoursToAccept ?? "—"} h to accept, {ops.medianHoursToComplete ?? "—"} h to complete</Text>
              <Text style={s.meta}>Workload now: {ops.workload.length ? ops.workload.map((w) => `${w.people} with ${w.activeEvaluations}`).join(" · ") : "nobody has an open evaluation"}</Text>
            </View>
          ) : null}
          {pairs?.length ? (
            <View style={[s.panel, pairs.some((p) => p.needsReview) && { borderLeftWidth: 4, borderLeftColor: c.amber }]}>
              <Text style={s.section}>Approval patterns to review</Text>
              <Text style={s.meta}>People who approved each other's work. A human decides — nothing happens automatically. Every decision is kept.</Text>
              {pairs.map((p) => (
                <View key={p.pairKey} style={s.item}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.title}>{p.people.join(" ↔ ")}</Text>
                    <Text style={s.meta}>{p.approvals[0]} and {p.approvals[1]} approvals · latest {new Date(p.lastAt).toLocaleDateString()}{p.review ? ` · reviewed: ${p.review.decision.replace(/_/g, " ")}` : ""}</Text>
                  </View>
                  {p.needsReview ? <AppButton label="No concern" size="sm" variant="tertiary" disabled={reason.trim().length < 5}
                    onPress={() => act(() => adminIntegrityReview(p.pairKey, "no_concern", reason.trim()), "Recorded.")} /> : null}
                  {p.needsReview ? <AppButton label="Concern" size="sm" variant="secondary" disabled={reason.trim().length < 5}
                    onPress={() => act(() => adminIntegrityReview(p.pairKey, "concern_raised", reason.trim()), "Recorded.")} /> : null}
                </View>
              ))}
              <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Note for your decision (required)" placeholderTextColor={c.textMuted} accessibilityLabel="Note for the review decision" />
            </View>
          ) : null}
          <View style={s.panel}>
            <Text style={s.section}>Who can evaluate what</Text>
            <Text style={s.meta}>Only people who passed a resource through an independent evaluation are invited for that same resource. These are waiting:</Text>
            {coverage?.length ? coverage.map((r, i) => (
              <Text key={i} style={s.body}>{r.hasQualifiedPeople ? "●" : "○"} {r.title}{r.context ? ` · ${r.context.replace(/_/g, " ")}` : ""} — {r.waiting} waiting{r.hasQualifiedPeople ? "" : " · nobody has passed it yet"}</Text>
            )) : <Text style={s.meta}>Nothing waiting.</Text>}
          </View>
          <View style={s.panel}><Text style={s.section}>No evaluator available</Text>{ov.noEvaluator?.length ? ov.noEvaluator.map(item) : <Text style={s.meta}>None.</Text>}</View>
          <View style={s.panel}><Text style={s.section}>Due soon / overdue</Text>{ov.dueSoon?.length ? ov.dueSoon.map(item) : <Text style={s.meta}>None.</Text>}</View>
          <View style={s.panel}><Text style={s.section}>Recently reassigned</Text>{ov.recentlyReassigned?.length ? ov.recentlyReassigned.map((r: any, i: number) => <Text key={i} style={s.meta}>{r.reason} · {new Date(r.at).toLocaleString()}</Text>) : <Text style={s.meta}>None.</Text>}</View>
          {history ? (
            <View style={s.panel}>
              <Text style={s.section}>{history.lessonTitle} — {history.evaluatee}</Text>
              {history.assignments.map((a: any) => <Text key={a.id} style={s.body}>#{a.attempt} {a.evaluatorName}: {a.status}{a.end_reason ? ` (${a.end_reason})` : ""}{a.actor_type === "admin" ? " · by an administrator" : ""}{a.match_detail?.basis === "bootstrap" ? " · cold-start reviewer" : ""}</Text>)}
              {history.nextCandidates?.length ? <Text style={s.meta}>Next in line: {history.nextCandidates.map((x: any) => `${x.name} (${x.reasons?.language === "same_content_language" ? "same language" : "other language"}${x.reasons?.stagesAhead > 0 ? `, ${x.reasons.stagesAhead} stage${x.reasons.stagesAhead === 1 ? "" : "s"} ahead` : ""}, ${x.reasons?.activeEvaluations ?? 0} active)`).join(" · ")}</Text> : <Text style={s.meta}>Nobody else qualifies yet.</Text>}
              <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Reason for reassigning (required)" placeholderTextColor={c.textMuted} accessibilityLabel="Reason for reassigning" />
              <AppButton label="Reassign (the system chooses who is next)" size="sm" variant="secondary" disabled={reason.trim().length < 3}
                onPress={() => confirm("Reassign", "End the current assignment and let P2P Global choose the next evaluator?", () => act(() => adminReassign(history.id, reason.trim()), "Reassigned by the system."))} />
              {history.resourceKind ? (
                <AppButton label="This assessment was materially revised" size="sm" variant="tertiary" disabled={reason.trim().length < 5}
                  onPress={() => confirm("Record a material revision", "Earlier passes keep their learning credit, but only people who pass the revised assessment will be invited to evaluate it. Use the reason box to describe what changed.",
                    () => act(async () => { const r = await adminRecordRevision(history.resourceKind, history.resourceId ?? history.lessonId, reason.trim()); setNotice(`Now version ${r.version}.`); }, "Revision recorded."))} />
              ) : null}
              <AppButton label="Close" size="sm" variant="tertiary" onPress={() => setHistory(null)} />
            </View>
          ) : null}
        </>
      ) : null}

      {tab === "evaluators" ? (evs ?? []).map((e) => (
        <View key={e.userId} style={[s.panel, e.needsReview && { borderLeftWidth: 4, borderLeftColor: c.amber }]}>
          <Text style={s.title}>{e.name} · {e.standing}{e.available ? "" : " · unavailable"}</Text>
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
              onValueChange={(v) => confirm(v ? "Turn the engine on" : "Turn the engine off", v ? "New submissions wait for someone who passed that same resource independently to accept." : "New submissions will use the previous direct assignment. Evaluations already in the engine continue.",
                () => act(() => adminSettings({ engineEnabled: v }), v ? "Engine on." : "Engine off."))}
              trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
          </View>
          <Text style={s.meta}>Invitation window: {ov.settings?.invitation_window_minutes} minutes · default capacity: {ov.settings?.default_capacity} · deadline: always 48 hours (no extensions)</Text>
          <View style={s.row}>
            <Text style={[s.body, { flex: 1 }]}>Family and Church assignments evaluated by members of the same group who passed the same assignment (the leader can still review)</Text>
            <Switch value={!!ov.settings?.group_assignments_enabled} accessibilityLabel="Group assignments in the engine"
              onValueChange={(v) => confirm(v ? "Include group assignments" : "Leader review only", v ? "New Family and Church assignment submissions will be offered to qualified members of the same group. The leader's own review still works and closes it." : "New group submissions will be reviewed by the leader only.",
                () => act(() => adminSettings({ groupAssignmentsEnabled: v }), "Saved."))}
              trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
          </View>
          <View style={s.row}>
            <Text style={[s.body, { flex: 1 }]}>Cold start: Peer Guides may evaluate a resource that NOBODY has passed independently yet (they step aside once someone has)</Text>
            <Switch value={(ov.settings?.bootstrap_roles ?? []).includes("peer_guide")} accessibilityLabel="Cold-start reviewers"
              onValueChange={(v) => confirm(v ? "Allow cold-start reviewers" : "Stop cold-start reviewers", v ? "Peer Guides may be invited only for resources nobody has passed independently yet. Recorded as cold-start reviews." : "Only people who passed a resource independently will be invited.",
                () => act(() => adminSettings({ bootstrapRoles: v ? ["peer_guide"] : [] }), "Saved."))}
              trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
          </View>
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
