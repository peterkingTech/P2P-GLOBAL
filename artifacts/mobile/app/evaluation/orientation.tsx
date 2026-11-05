import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Switch } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import { ORIENTATION_MESSAGE, ORIENTATION_SECTIONS, SERVICE_SCRIPTURES } from "@/constants/evaluationGuidance";
import { acknowledgeOrientation, getEvaluatorProfile, updateAvailability, type EvaluatorProfile } from "@/lib/peerEvaluationApi";

// Evaluator orientation, commitment and availability. Serving as an evaluator
// is an invitation, never an obligation: the orientation explains the purpose
// (with Scripture), how to give fair and encouraging feedback, privacy, the
// 48-hour responsibility and automatic reassignment. Since 240 this guide is
// optional: nobody signs up — people are invited only for a resource they
// passed independently, and the commitments are agreed when accepting an
// invitation (the commitment panel shows only for older server versions).
// Availability, pauses and how many at a time are always yours to set. The
// service record is private.

export default function Orientation() {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [p, setP] = useState<EvaluatorProfile | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => { try { setP(await getEvaluatorProfile()); setError(null); } catch (e: any) { setError(e?.message ?? "Couldn't load."); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const save = async (key: string, patch: Parameters<typeof updateAvailability>[0], done: string) => {
    setBusy(key); setNotice(null);
    try { await updateAvailability(patch); setNotice(done); await load(); } catch (e: any) { setNotice(e?.message ?? "Couldn't save."); } finally { setBusy(null); }
  };

  if (!p) return <View style={[s.screen, s.center]}><Stack.Screen options={{ title: "Serving as an evaluator" }} />{error ? <Text style={s.body}>{error}</Text> : <ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" />}</View>;
  const pausedUntil = p.unavailableUntil && Date.parse(p.unavailableUntil) > Date.now() ? new Date(p.unavailableUntil) : null;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Serving as an evaluator" }} />
      <Text style={s.h1} accessibilityRole="header">Serving one another</Text>
      <Text style={s.lead}>{ORIENTATION_MESSAGE}</Text>
      {SERVICE_SCRIPTURES.map((v) => (
        <View key={v.ref} style={s.verse}><Text style={s.quote}>“{v.text}”</Text><Text style={s.ref}>{v.ref} (WEB)</Text></View>
      ))}
      {ORIENTATION_SECTIONS.map((sec) => (
        <View key={sec.title} style={s.panel}>
          <Text style={s.section} accessibilityRole="header">{sec.title}</Text>
          {sec.points.map((pt) => <View key={pt} style={s.point}><Ionicons name="checkmark-circle-outline" size={18} color={c.accentGreen} /><Text style={[s.body, { flex: 1 }]}>{pt}</Text></View>)}
        </View>
      ))}

      {!p.oriented ? (
        <View style={s.panel}>
          <Text style={s.section} accessibilityRole="header">Your commitment</Text>
          {p.commitments.map((cm) => {
            const on = checked.has(cm.id);
            return (
              <Pressable key={cm.id} style={s.point} onPress={() => setChecked((cur) => { const n = new Set(cur); if (n.has(cm.id)) n.delete(cm.id); else n.add(cm.id); return n; })}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={cm.text}>
                <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? c.accentGreen : c.textMuted} />
                <Text style={[s.body, { flex: 1 }]}>{cm.text}</Text>
              </Pressable>
            );
          })}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <AppButton label="I commit to serve" icon="heart" disabled={checked.size < p.commitments.length} loading={busy === "commit"} onPress={async () => {
            setBusy("commit");
            try { await acknowledgeOrientation(p.commitments.map((x) => x.id)); await load(); setNotice("Thank you. You can be invited when you're available."); } catch (e: any) { setError(e?.message ?? "Couldn't save."); } finally { setBusy(null); }
          }} />
          <Text style={s.meta}>There's no pressure: you can pause or stop being invited at any time.</Text>
        </View>
      ) : (
        <>
          {p.standing === "restricted" ? (
            <View style={[s.panel, { borderLeftWidth: 4, borderLeftColor: c.amber }]}>
              <Text style={s.section}>Evaluating is paused for now</Text>
              <Text style={s.body}>{p.restrictionReason ?? "A coordinator has paused new evaluations."} A coordinator will talk with you about next steps.</Text>
            </View>
          ) : null}
          <View style={s.panel}>
            <Text style={s.section} accessibilityRole="header">Your availability</Text>
            <View style={s.switchRow}>
              <Text style={[s.body, { flex: 1 }]}>Available for new evaluations</Text>
              <Switch value={p.available} onValueChange={(v) => save("available", { available: v }, v ? "You're available again." : "You won't receive new invitations.")} accessibilityLabel="Available for new evaluations" trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
            </View>
            <Text style={s.meta}>{pausedUntil ? `Paused until ${pausedUntil.toLocaleDateString(undefined, { day: "numeric", month: "short" })}.` : "Need a break? Pause for a while — evaluations you've accepted aren't affected."}</Text>
            <View style={s.row}>
              <AppButton label="Pause 1 week" size="sm" variant="tertiary" onPress={() => save("pause", { unavailableUntil: new Date(Date.now() + 7 * 86_400_000).toISOString() }, "Paused for a week.")} />
              <AppButton label="Pause 1 month" size="sm" variant="tertiary" onPress={() => save("pause", { unavailableUntil: new Date(Date.now() + 30 * 86_400_000).toISOString() }, "Paused for a month.")} />
              {pausedUntil ? <AppButton label="End pause" size="sm" variant="tertiary" onPress={() => save("pause", { unavailableUntil: null }, "Pause ended.")} /> : null}
            </View>
            <Text style={s.body}>At most at a time</Text>
            <ChipRow accessibilityLabel="Evaluations at a time" single>
              {[1, 2, 3, 4, 5].map((n) => <FilterChip key={n} label={String(n)} selected={p.capacity === n} selection="single" onPress={() => save("cap", { capacity: n }, `Up to ${n} at a time.`)} />)}
            </ChipRow>
            {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
          </View>
          <View style={s.panel}>
            <Text style={s.section} accessibilityRole="header">Your service (private)</Text>
            <Text style={s.body}>{p.record.completed} completed · {p.record.onTime} on time · {p.record.declined} declined · {p.record.unableReports} handed back</Text>
            {p.record.missedDeadlines ? <Text style={s.meta}>{p.record.missedDeadlines} time{p.record.missedDeadlines === 1 ? "" : "s"} the 48 hours ran out. That's alright — P2P Global reassigned them. If something got in the way, you can always pause.</Text> : null}
            {p.recognitions.length ? p.recognitions.map((r) => (
              <View key={r.id} style={s.point}><Ionicons name="ribbon-outline" size={20} color={c.amber} /><View style={{ flex: 1 }}><Text style={s.title}>{r.title}</Text><Text style={s.meta}>{r.reason}</Text></View></View>
            )) : <Text style={s.meta}>Recognitions reflect faithful, encouraging and timely service — never how many you do. They're just for you.</Text>}
            <Text style={s.quote}>“{SERVICE_SCRIPTURES[0].text}” — {SERVICE_SCRIPTURES[0].ref}</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", padding: 24 },
    content: { padding: 16, gap: 12, paddingBottom: 120 },
    h1: { fontSize: 24, lineHeight: 30, color: c.textDark, fontFamily: "Inter_700Bold" },
    lead: { fontSize: 16, lineHeight: 24, color: c.textDark, fontFamily: "Inter_500Medium" },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    title: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14.5, lineHeight: 21, color: c.textDark, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    notice: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    error: { color: "#C0392B", fontFamily: "Inter_500Medium", fontSize: 13 },
    quote: { fontSize: 14.5, lineHeight: 22, color: c.textMid, fontFamily: "Inter_400Regular", fontStyle: "italic" },
    ref: { fontSize: 12.5, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    verse: { gap: 4, padding: 12, borderRadius: 14, borderLeftWidth: 4, borderLeftColor: c.accentGreen, backgroundColor: c.card },
    panel: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.card },
    point: { flexDirection: "row", gap: 10, alignItems: "flex-start", minHeight: 32 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    row: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  });
}
