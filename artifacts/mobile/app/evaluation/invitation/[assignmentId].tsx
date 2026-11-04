import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import Countdown from "@/components/evaluation/Countdown";
import { SERVICE_SCRIPTURES, RESPONSIBILITY_REMINDER } from "@/constants/evaluationGuidance";
import { acceptInvitation, declineInvitation, getInvitation, type Invitation } from "@/lib/peerEvaluationApi";

// An invitation to evaluate: what's needed to decide — the lesson, the kind
// of work, what's expected, the 48-hour policy, safeguarding — and nothing
// private (the evaluatee's name and answers appear only after accepting).
// Accept or Decline. Declining is fine: P2P Global invites someone else.

const DECLINE: { value: string; label: string }[] = [
  { value: "not_my_area", label: "Not my area" }, { value: "no_time", label: "No time right now" },
  { value: "conflict_of_interest", label: "Conflict of interest" }, { value: "other", label: "Another reason" },
];

export default function InvitationScreen() {
  const { assignmentId } = useLocalSearchParams<{ assignmentId: string }>();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [inv, setInv] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("not_my_area");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!assignmentId) return;
    try { setInv(await getInvitation(assignmentId)); setError(null); } catch (e: any) { setError(e?.message ?? "This invitation isn't available."); }
  }, [assignmentId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!inv) return <View style={[s.screen, s.center]}><Stack.Screen options={{ title: "Invitation" }} />{error ? <Text style={s.body}>{error}</Text> : <ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" />}</View>;
  const open = inv.status === "invited";
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Invitation to evaluate" }} />
      <Text style={s.kicker}>{inv.curriculum ?? inv.kind}</Text>
      <Text style={s.h1} accessibilityRole="header">{inv.lessonTitle}</Text>
      {inv.checkTitle ? <Text style={s.meta}>{inv.checkTitle}</Text> : null}
      {open ? <View style={{ gap: 4 }}><Text style={s.meta}>Please answer within:</Text><Countdown deadlineAt={inv.inviteExpiresAt} compact /></View> : <Text style={s.body}>This invitation is no longer open. Thank you.</Text>}

      <View style={s.panel}>
        <Row s={s} label="Kind of work" value={`${inv.kind} · ${inv.answerFormat === "text" ? "written answers" : inv.answerFormat}`} />
        <Row s={s} label="What's expected" value={inv.expectedWork} />
        <Row s={s} label="Who is asked" value={inv.competence} />
        <Row s={s} label="Time" value={inv.deadlinePolicy} />
        <Row s={s} label="Privacy" value={inv.safeguarding} />
      </View>

      <View style={s.verse}>
        <Text style={s.body}>{RESPONSIBILITY_REMINDER}</Text>
        <Text style={s.quote}>“{SERVICE_SCRIPTURES[0].text}” — {SERVICE_SCRIPTURES[0].ref}</Text>
      </View>

      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {open ? (declining ? (
        <View style={s.panel}>
          <Text style={s.title}>Why can't you take it? (helps P2P invite the right person)</Text>
          <ChipRow accessibilityLabel="Reason" single>
            {DECLINE.map((d) => <FilterChip key={d.value} label={d.label} selected={reason === d.value} selection="single" onPress={() => setReason(d.value)} />)}
          </ChipRow>
          <View style={s.row}>
            <AppButton label="Decline" variant="secondary" loading={busy === "decline"} onPress={async () => {
              setBusy("decline");
              try { await declineInvitation(inv.assignmentId, reason); router.back(); } catch (e: any) { setError(e?.message ?? "Couldn't decline."); load(); } finally { setBusy(null); }
            }} />
            <AppButton label="Back" variant="tertiary" onPress={() => setDeclining(false)} />
          </View>
        </View>
      ) : (
        <View style={s.row}>
          <AppButton label="Accept — I'll serve" icon="checkmark" loading={busy === "accept"} onPress={async () => {
            setBusy("accept");
            try { await acceptInvitation(inv.assignmentId); router.replace("/evaluation" as any); } catch (e: any) { setError(e?.message ?? "Couldn't accept."); load(); } finally { setBusy(null); }
          }} />
          <AppButton label="Decline" variant="tertiary" onPress={() => setDeclining(true)} />
        </View>
      )) : null}
      <Text style={s.meta}>Accepting starts the 48 hours. If something later stops you, report it from the evaluation — P2P Global arranges someone else.</Text>
    </ScrollView>
  );
}

function Row({ s, label, value }: { s: ReturnType<typeof makeStyles>; label: string; value: string }) {
  return <View style={{ gap: 2 }}><Text style={s.label}>{label}</Text><Text style={s.body}>{value}</Text></View>;
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", padding: 24 },
    content: { padding: 16, gap: 12, paddingBottom: 120 },
    kicker: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.8, textTransform: "uppercase" },
    h1: { fontSize: 22, lineHeight: 28, color: c.textDark, fontFamily: "Inter_700Bold" },
    title: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    label: { fontSize: 12, color: c.textMid, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14.5, lineHeight: 21, color: c.textDark, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    quote: { fontSize: 14, lineHeight: 21, color: c.textMid, fontFamily: "Inter_400Regular", fontStyle: "italic" },
    error: { color: "#C0392B", fontFamily: "Inter_500Medium", fontSize: 13 },
    panel: { gap: 12, padding: 14, borderRadius: 16, backgroundColor: c.card },
    verse: { gap: 8, padding: 14, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: c.accentGreen, backgroundColor: c.card },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  });
}
