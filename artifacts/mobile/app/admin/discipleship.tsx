import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator } from "react-native";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";
import { apiRequest } from "@/lib/apiClient";
import { confirmAction } from "@/lib/alerts";

// ADMIN — DISCIPLESHIP & GROWTH. The milestone matrix behind the personal
// growth stages (migrations 235/239), why a person qualifies or not, evidence
// review, the learning-unit/Core Curriculum audit, approving the matrix and switching promotions on —
// each with a written reason, recorded in the audit — and controlled
// corrections to discipleship relationships (ended with a reason, never
// deleted). Every action is checked on the server (growth.view,
// growth.approve_matrix, genealogy.view_named, genealogy.correct).

interface Req { stage: number; stageName: string; dimension: string; fact_key: string; label: string; min_value: number; param: number | null; data_source: string; explanation?: string }
interface Growth { settings: { thresholds_status: string; promotions_enabled: boolean; approved_at: string | null; calc_version?: number; legacy_formula_frozen?: boolean } | null; requirements: Req[] }
interface Rel { id: string; mentorName?: string; discipleName?: string; status: string; is_primary: boolean; started_at: string | null; ended_at: string | null; end_reason: string | null }
interface Item { label: string; met: boolean; have: number; need: number; missing: string | null }
interface Explain {
  person: { name: string };
  status: { stageName: string; verification: string; eligible_stage: number; evaluated_at: string | null; next: { dimension: string; label: string; items: Item[] }[] | null;
            verified: { learningUnits: number; practicalActions: number; contributions: number; activeWeeks: number; coreLessons: { passed: number; total: number } } } | null;
  provenance: Record<string, { counted: number; pending: number; rejected: number; withdrawn: number }>;
  guideHistory: { status: string; is_primary: boolean; started_at: string | null; ended_at: string | null }[];
  contributionNetwork: { support_months: number; developed: boolean; onward_months: number; learnerStillActive: boolean }[];
}
interface Pending { id: string; participant?: string; evidence_type: string; local_date: string; source_resource: string }
interface Units { core: { publishedLessons: number; expected: number; withAssessment: number }; byResource: Record<string, { units: number; withoutAssessment: number; practicalQuestions: number }> }
// The four independent dimensions (migration 239).
const DIM: Record<string, string> = { consistency: "Consistency", learning: "Learning", application: "Application", service: "Service & Contribution" };

export default function AdminDiscipleship() {
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [rels, setRels] = useState<{ person: { name: string }; relationships: Rel[] } | null>(null);
  const [fixReason, setFixReason] = useState("");
  const [who, setWho] = useState("");
  const [explain, setExplain] = useState<Explain | null>(null);
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [units, setUnits] = useState<Units | null>(null);

  const load = useCallback(async () => {
    try { setGrowth(await apiRequest<Growth>("/admin-centre/growth")); setError(null); } catch (e) { setError((e as Error).message); }
    // Each panel below needs its own permission; a panel this account can't use simply stays hidden.
    apiRequest<{ evidence: Pending[] }>("/admin-centre/growth/evidence/review").then((r) => setPending(r.evidence)).catch(() => setPending(null));
    apiRequest<Units>("/admin-centre/growth/learning-units").then(setUnits).catch(() => setUnits(null));
  }, []);
  const lookupWhy = async () => {
    setNotice(null); setExplain(null);
    try { setExplain(await apiRequest<Explain>(`/admin-centre/growth/person?username=${encodeURIComponent(who.trim())}`)); } catch (e) { setNotice((e as Error).message); }
  };
  const review = async (id: string, action: "approve" | "reject") => {
    if (reviewReason.trim().length < 5) { setNotice("Write the reason first — it is kept with the evidence."); return; }
    try { await apiRequest(`/admin-centre/growth/evidence/${id}/review`, { method: "POST", body: JSON.stringify({ action, reason: reviewReason.trim() }) }); setNotice(action === "approve" ? "Approved." : "Rejected."); setReviewReason(""); await load(); }
    catch (e) { setNotice((e as Error).message); }
  };
  const reconcile = () => confirmAction("Re-check legacy stages?", "Trusted history is recorded and everyone with a recognised (not yet verified) stage is re-checked. Nobody is raised or lowered.", async () => {
    try { const r = await apiRequest<{ result: { checked: number; still_unverified: number } }>("/admin-centre/growth/reconcile-legacy", { method: "POST" }); setNotice(`Re-checked ${r.result.checked}; ${r.result.still_unverified} still recognised but not yet verified.`); }
    catch (e) { setNotice((e as Error).message); }
  });
  useEffect(() => { load(); }, [load]);

  const change = async (body: Record<string, unknown>, done: string) => {
    if (!reason.trim()) { setNotice("Write the reason first — it is kept in the audit."); return; }
    setBusy(true); setNotice(null);
    try { await apiRequest("/admin-centre/growth", { method: "PUT", body: JSON.stringify({ ...body, reason: reason.trim() }) }); setNotice(done); setReason(""); await load(); }
    catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };
  const lookup = async () => {
    setNotice(null); setRels(null);
    try { setRels(await apiRequest(`/admin-centre/relationships?username=${encodeURIComponent(username.trim())}`)); } catch (e) { setNotice((e as Error).message); }
  };
  const endRel = (r: Rel) => confirmAction("End this relationship?", `${r.mentorName} → ${r.discipleName}. It stays in history with your reason. Both people's lineage changes.`, async () => {
    try { await apiRequest(`/admin-centre/relationships/${r.id}/end`, { method: "POST", body: JSON.stringify({ reason: fixReason.trim() }) }); setNotice("Ended, with your reason recorded."); setFixReason(""); await lookup(); }
    catch (e) { setNotice((e as Error).message); }
  }, { confirmLabel: "End relationship", destructive: true });

  const st = growth?.settings;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.h1} accessibilityRole="header">Discipleship & Growth</Text>
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text style={s.meta}>{error}</Text> : null}
      {!growth && !error ? <ActivityIndicator color={colors.accentGreen} /> : null}

      {growth ? (
        <View style={s.card}>
          <Text style={s.h2} accessibilityRole="header">Growth milestones</Text>
          <Text style={s.meta}>Matrix (calculation v{st?.calc_version ?? 2}): {st?.thresholds_status === "approved" ? `approved${st.approved_at ? ` ${new Date(st.approved_at).toLocaleDateString()}` : ""}` : "DRAFT"} · Promotions: {st?.promotions_enabled ? "ON" : "off"} · Previous formulas: {st?.legacy_formula_frozen === false ? "active" : "frozen"}</Text>
          <Text style={s.meta}>Forest Builder is the highest personal stage. Every requirement of all four dimensions must be met; one dimension never makes up for another. Milestones record participation and contribution — never a person's relationship with God.</Text>
          {[2, 3, 4, 5].map((n) => {
            const rows = growth.requirements.filter((r) => r.stage === n);
            return (
              <View key={n} style={s.stage}>
                <Text style={s.stageName}>{rows[0]?.stageName ?? `Stage ${n}`}</Text>
                {rows.map((r) => (
                  <Text key={r.fact_key ?? r.label} style={s.req}>• {DIM[r.dimension] ?? r.dimension}: {r.label} <Text style={s.src}>({r.explanation ?? r.data_source})</Text></Text>
                ))}
              </View>
            );
          })}
          <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Reason (kept in the audit)" placeholderTextColor={colors.textMuted} accessibilityLabel="Reason for the change" />
          <View style={s.row}>
            {st?.thresholds_status !== "approved" ? (
              <AppButton label="Approve this matrix" size="sm" loading={busy} onPress={() => confirmAction("Approve the milestone matrix?", "These requirements become the official rules for personal growth stages.", () => change({ approveMatrix: true }, "Matrix approved."))} />
            ) : null}
            {st?.promotions_enabled ? (
              <AppButton label="Pause promotions" size="sm" variant="secondary" loading={busy} onPress={() => change({ promotionsEnabled: false }, "Promotions paused. Nobody is lowered.")} />
            ) : (
              <AppButton label="Switch promotions on" size="sm" variant="secondary" disabled={st?.thresholds_status !== "approved"} loading={busy}
                onPress={() => confirmAction("Switch promotions on?", "Everyone is re-checked; people who meet a stage's milestones move up and are celebrated. Nobody is ever lowered.", () => change({ promotionsEnabled: true }, "Promotions on. Everyone is being re-checked."))} />
            )}
          </View>
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.h2} accessibilityRole="header">Why someone qualifies — or not yet</Text>
        <Text style={s.meta}>Counts, kinds and dates of verified evidence only — never reflections, journals, messages or answers. Looking someone up is recorded in the audit.</Text>
        <View style={s.row}>
          <TextInput style={[s.input, { flex: 1 }]} value={who} onChangeText={setWho} placeholder="@username" autoCapitalize="none" placeholderTextColor={colors.textMuted} accessibilityLabel="Username to explain" onSubmitEditing={lookupWhy} />
          <AppButton label="Explain" size="sm" variant="secondary" onPress={lookupWhy} disabled={!who.trim()} />
        </View>
        {explain?.status ? (
          <>
            <Text style={s.sub}>{explain.person.name} · {explain.status.stageName} ({explain.status.verification.replace("_", " ")})</Text>
            <Text style={s.meta}>Verified: {explain.status.verified.learningUnits} learning units · {explain.status.verified.practicalActions} practical actions · {explain.status.verified.contributions} contributions · {explain.status.verified.activeWeeks} active weeks · Core {explain.status.verified.coreLessons.passed}/{explain.status.verified.coreLessons.total}</Text>
            {(explain.status.next ?? []).map((d) => (
              <View key={d.dimension} style={s.stage}>
                <Text style={s.stageName}>{d.label}</Text>
                {d.items.map((i) => <Text key={i.label} style={s.req}>{i.met ? "✓" : "○"} {i.label}: {i.have} of {i.need}{i.missing ? ` — ${i.missing}` : ""}</Text>)}
              </View>
            ))}
            <Text style={s.sub}>Evidence by kind</Text>
            {Object.entries(explain.provenance).map(([k, v]) => <Text key={k} style={s.meta}>{k}: {v.counted} counted{v.pending ? ` · ${v.pending} awaiting review` : ""}{v.rejected ? ` · ${v.rejected} rejected` : ""}{v.withdrawn ? ` · ${v.withdrawn} withdrawn` : ""}</Text>)}
            <Text style={s.sub}>Guide relationships ({explain.guideHistory.length})</Text>
            {explain.guideHistory.slice(0, 10).map((g, i) => <Text key={i} style={s.meta}>{g.status}{g.is_primary ? " · primary" : ""}{g.started_at ? ` · from ${new Date(g.started_at).toLocaleDateString()}` : ""}{g.ended_at ? ` · to ${new Date(g.ended_at).toLocaleDateString()}` : ""}</Text>)}
            <Text style={s.sub}>People they helped (pseudonymous)</Text>
            {explain.contributionNetwork.length ? explain.contributionNetwork.map((n, i) => (
              <Text key={i} style={s.meta}>Learner {i + 1}: supported in {n.support_months} month{n.support_months === 1 ? "" : "s"} · {n.developed ? "developed afterwards" : "no development evidence yet"} · helping others in {n.onward_months} month{n.onward_months === 1 ? "" : "s"}{n.learnerStillActive ? "" : " · has left (last verified level kept)"}</Text>
            )) : <Text style={s.meta}>None recorded yet.</Text>}
          </>
        ) : null}
      </View>

      {pending ? (
        <View style={s.card}>
          <Text style={s.h2} accessibilityRole="header">Evidence awaiting review ({pending.length})</Text>
          <Text style={s.meta}>Only kinds of evidence set to need a review appear here. Approve or reject with a reason; nobody can review their own.</Text>
          {pending.length ? <TextInput style={s.input} value={reviewReason} onChangeText={setReviewReason} placeholder="Reason (kept with the evidence)" placeholderTextColor={colors.textMuted} accessibilityLabel="Reason for the review" /> : null}
          {pending.slice(0, 30).map((p) => (
            <View key={p.id} style={s.rel}>
              <Text style={s.req}>{p.participant ?? "A participant"} · {p.evidence_type} · {p.local_date}</Text>
              <View style={s.row}>
                <AppButton label="Approve" size="sm" variant="secondary" onPress={() => review(p.id, "approve")} />
                <AppButton label="Reject" size="sm" variant="tertiary" onPress={() => review(p.id, "reject")} />
              </View>
            </View>
          ))}
          <AppButton label="Re-check legacy stages" size="sm" variant="secondary" onPress={reconcile} />
        </View>
      ) : null}

      {units ? (
        <View style={s.card}>
          <Text style={s.h2} accessibilityRole="header">Learning units and assessments</Text>
          <Text style={s.meta}>A unit counts only when its assessment is passed and peer-reviewed. Core Curriculum: {units.core.publishedLessons} published lessons (expected {units.core.expected}), {units.core.withAssessment} with an assessment.</Text>
          {Object.entries(units.byResource).map(([k, v]) => <Text key={k} style={s.req}>• {k.replace(/_/g, " ")}: {v.units} units · {v.withoutAssessment} without an assessment · {v.practicalQuestions} practical questions</Text>)}
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.h2} accessibilityRole="header">Relationship corrections</Text>
        <Text style={s.meta}>For reported or invalid relationships only. Looking someone up is recorded in the audit. A correction ends the relationship with your reason; it is never deleted.</Text>
        <View style={s.row}>
          <TextInput style={[s.input, { flex: 1 }]} value={username} onChangeText={setUsername} placeholder="@username" autoCapitalize="none" placeholderTextColor={colors.textMuted} accessibilityLabel="Username to look up" onSubmitEditing={lookup} />
          <AppButton label="Look up" size="sm" variant="secondary" onPress={lookup} disabled={!username.trim()} />
        </View>
        {rels ? (
          <>
            <Text style={s.sub}>{rels.person.name}</Text>
            {!rels.relationships.length ? <Text style={s.meta}>No relationships.</Text> : rels.relationships.map((r) => (
              <View key={r.id} style={s.rel}>
                <Text style={s.req}>{r.mentorName} → {r.discipleName}{r.is_primary ? " (primary)" : ""}</Text>
                <Text style={s.meta}>{r.status}{r.started_at ? ` · since ${new Date(r.started_at).toLocaleDateString()}` : ""}{r.ended_at ? ` · ended ${new Date(r.ended_at).toLocaleDateString()}` : ""}{r.end_reason ? ` · ${r.end_reason}` : ""}</Text>
                {r.status === "active" || r.status === "paused" ? (
                  <View style={s.row}>
                    <TextInput style={[s.input, { flex: 1 }]} value={fixReason} onChangeText={setFixReason} placeholder="Why (required)" placeholderTextColor={colors.textMuted} accessibilityLabel="Reason for the correction" />
                    <AppButton label="End" size="sm" variant="tertiary" disabled={fixReason.trim().length < 5} onPress={() => endRel(r)} />
                  </View>
                ) : null}
              </View>
            ))}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  content: { padding: 16, gap: 14, paddingBottom: 80 },
  h1: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.textDark },
  h2: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.textDark },
  sub: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textDark, marginTop: 6 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMuted, lineHeight: 18 },
  notice: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.accentGreen },
  card: { padding: 14, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, gap: 8 },
  stage: { gap: 2, paddingTop: 4 },
  stageName: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
  req: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.textDark, lineHeight: 19 },
  src: { color: colors.textMuted, fontSize: 11 },
  input: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, paddingHorizontal: 10, color: colors.textDark, fontFamily: "Inter_400Regular", backgroundColor: colors.lightCream },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  rel: { gap: 4, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.borderBeige },
});
