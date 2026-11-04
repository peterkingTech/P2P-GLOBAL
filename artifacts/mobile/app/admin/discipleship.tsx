import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator } from "react-native";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";
import { apiRequest } from "@/lib/apiClient";
import { confirmAction } from "@/lib/alerts";

// ADMIN — DISCIPLESHIP & GROWTH. The milestone matrix behind the personal
// growth stages (migration 235), approving it and switching promotions on —
// each with a written reason, recorded in the audit — and controlled
// corrections to discipleship relationships (ended with a reason, never
// deleted). Every action is checked on the server (growth.view,
// growth.approve_matrix, genealogy.view_named, genealogy.correct).

interface Req { stage: number; stageName: string; dimension: string; label: string; min_value: number; data_source: string }
interface Growth { settings: { thresholds_status: string; promotions_enabled: boolean; approved_at: string | null } | null; requirements: Req[] }
interface Rel { id: string; mentorName?: string; discipleName?: string; status: string; is_primary: boolean; started_at: string | null; ended_at: string | null; end_reason: string | null }
const DIM: Record<string, string> = { consistency: "Consistency", learning: "Learning", fruit: "Spiritual fruit", discipleship: "Discipleship" };

export default function AdminDiscipleship() {
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [rels, setRels] = useState<{ person: { name: string }; relationships: Rel[] } | null>(null);
  const [fixReason, setFixReason] = useState("");

  const load = useCallback(async () => {
    try { setGrowth(await apiRequest<Growth>("/admin-centre/growth")); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
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
          <Text style={s.meta}>Matrix: {st?.thresholds_status === "approved" ? `approved${st.approved_at ? ` ${new Date(st.approved_at).toLocaleDateString()}` : ""}` : "DRAFT"} · Promotions: {st?.promotions_enabled ? "ON" : "off"}</Text>
          <Text style={s.meta}>Forest Builder is the highest personal stage. Every requirement of a stage must be met; one dimension never makes up for another.</Text>
          {[2, 3, 4, 5].map((n) => {
            const rows = growth.requirements.filter((r) => r.stage === n);
            return (
              <View key={n} style={s.stage}>
                <Text style={s.stageName}>{rows[0]?.stageName ?? `Stage ${n}`}</Text>
                {rows.map((r) => (
                  <Text key={r.label} style={s.req}>• {DIM[r.dimension] ?? r.dimension}: {r.label} <Text style={s.src}>({r.data_source})</Text></Text>
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
