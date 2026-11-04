import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TextInput, Alert, Platform, AppState } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip } from "@/components/ui";
import MediaPlayer from "@/components/MediaPlayer";
import Countdown from "@/components/evaluation/Countdown";
import { FAIRNESS_GUIDE, RESPONSIBILITY_REMINDER, SERVICE_SCRIPTURES } from "@/constants/evaluationGuidance";
import {
  getEvaluation, openDiscussion, reportUnable, saveDraft, submitEvaluation,
  DIFFERENCE_LABEL, OUTCOME_LABEL, QUESTION_STATUS_LABEL, UNABLE_LABEL,
  type DifferenceKind, type FeedbackDetail, type Outcome, type QuestionStatus, type UnableCategory, type WorkspaceView,
} from "@/lib/peerEvaluationApi";

// The evaluation workspace (the accepted evaluator only). The check, the
// evaluatee's answers to THIS check (never journals, reflections or notes),
// the lesson's own questions as the criteria, question-level feedback and the
// overall response (A–H), an outcome that maps onto the existing learning
// model, a draft that saves itself, a confirmed submit, and "Report inability
// to complete" — which hands the evaluation back to P2P Global. There is no
// way to choose or transfer to anyone else. The deadline is the server's.

type Q = { status?: QuestionStatus; note?: string; kind?: DifferenceKind | null };
const OVERALL: { key: keyof Omit<FeedbackDetail, "questions">; title: string; hint: string; required?: boolean }[] = [
  { key: "understoodWell", title: "A. What they understood well", hint: "Start with what is right and good." },
  { key: "needsImprovement", title: "B. What needs improvement", hint: "Specific and kind." },
  { key: "misunderstandings", title: "C. Explaining misunderstandings", hint: "Show the lesson's teaching and why." },
  { key: "scriptures", title: "D. Scripture references", hint: "e.g. John 3:16; Romans 8:28" },
  { key: "recommendedLessons", title: "E. Lessons or materials to revisit", hint: "From this curriculum." },
  { key: "nextSteps", title: "F. Practical next steps", hint: "One or two things to do this week." },
  { key: "encouragement", title: "G. Encouragement", hint: "Required — a word of encouragement.", required: true },
  { key: "comments", title: "H. Anything else (optional)", hint: "" },
];

export default function ReviewWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<WorkspaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qs, setQs] = useState<Record<string, Q>>({});
  const [overall, setOverall] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [unable, setUnable] = useState<{ category: UnableCategory | null; note: string } | null>(null);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await getEvaluation(id);
      if (r.role !== "evaluator") { router.replace({ pathname: "/evaluation/[id]", params: { id } } as any); return; }
      setD(r); setError(null);
      if (!dirty.current) {
        const src = (r.submitted?.detail ?? r.draft ?? {}) as Partial<FeedbackDetail> & { outcome?: Outcome; questions?: FeedbackDetail["questions"] };
        setQs(Object.fromEntries((src.questions ?? []).map((q) => [q.questionId, { status: q.status, note: q.note, kind: q.kind }])));
        setOverall(Object.fromEntries(OVERALL.map((o) => [o.key, String((src as Record<string, unknown>)[o.key] ?? "")])));
        setOutcome(r.submitted?.outcome ?? src.outcome ?? null);
        setSaved(r.draftSavedAt);
      }
    } catch (e: any) { setError(e?.message ?? "This evaluation isn't available."); setD(null); }
  }, [id, router]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const sub = AppState.addEventListener("change", (st) => { if (st === "active") load(); }); return () => sub.remove(); }, [load]);

  const feedback = (): Partial<FeedbackDetail> & { outcome?: Outcome } => ({
    ...(overall as Record<string, string>),
    questions: Object.entries(qs).filter(([, q]) => q.status).map(([questionId, q]) => ({ questionId, status: q.status!, note: q.note ?? "", kind: q.kind ?? null })),
    outcome: outcome ?? undefined,
  });
  const active = d?.state === "in_progress" && !!d.assignmentId;
  // Save the draft a few seconds after each change (and when leaving).
  useEffect(() => {
    if (!active || !dirty.current) return;
    const t = setTimeout(async () => {
      try { const r = await saveDraft(d!.assignmentId!, feedback()); setSaved(r.savedAt); dirty.current = false; } catch { /* next change retries */ }
    }, 4000);
    return () => clearTimeout(t);
  }, [qs, overall, outcome]); // eslint-disable-line react-hooks/exhaustive-deps
  const touch = () => { dirty.current = true; };

  const confirm = (title: string, message: string, yes: string, onYes: () => void) => {
    if (Platform.OS === "web") { if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes(); return; }
    Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: yes, onPress: onYes }]);
  };
  async function submit() {
    if (!d || !outcome) return;
    setBusy("submit"); setError(null);
    try { await submitEvaluation(d.id, outcome, feedback()); dirty.current = false; await load(); }
    catch (e: any) { setError(e?.message ?? "Couldn't submit."); }
    finally { setBusy(null); }
  }

  if (!d) return <View style={[s.screen, s.center]}><Stack.Screen options={{ title: "Evaluation" }} />{error ? <Text style={s.body}>{error}</Text> : <ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" />}</View>;
  const readOnly = !active;
  const missingStatus = d.questions.some((q) => !qs[q.id]?.status);
  const canSubmit = active && !!outcome && !!overall.encouragement?.trim() && (!!overall.understoodWell?.trim() || !!overall.needsImprovement?.trim()) && !missingStatus;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: d.submitted ? "Your evaluation" : "Evaluation workspace" }} />
      <Text style={s.kicker}>{d.curriculum ?? "Lesson check"}</Text>
      <Text style={s.h1} accessibilityRole="header">{d.checkTitle ?? d.lessonTitle}</Text>
      <Text style={s.meta}>{d.evaluatee.name} · submitted {new Date(d.submittedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
      {active && d.deadlineAt ? <Countdown deadlineAt={d.deadlineAt} overdueNote="Time has ended — P2P Global is reassigning this evaluation." /> : null}
      {d.submitted ? <View style={s.done}><Text style={s.doneText}>Submitted · {OUTCOME_LABEL[d.submitted.outcome]}. Thank you for serving.</Text></View> : null}

      <View style={s.verse}>
        <Text style={s.body}>{RESPONSIBILITY_REMINDER}</Text>
        <Text style={s.quote}>“{SERVICE_SCRIPTURES[2].text}” — {SERVICE_SCRIPTURES[2].ref}</Text>
      </View>
      {d.instructions ? <View style={s.panel}><Text style={s.label}>The check's instructions</Text><Text style={s.body}>{d.instructions}</Text></View> : null}
      <Text style={s.fair}>{FAIRNESS_GUIDE}</Text>

      {d.questions.map((q, i) => {
        const v = qs[q.id] ?? {};
        return (
          <View key={q.id} style={s.panel}>
            <Text style={s.label}>Question {i + 1}</Text>
            <Text style={s.question}>{q.question}</Text>
            {q.answer ? (
              q.answer.type === "text" ? <Text style={s.answer} selectable>{q.answer.text}</Text> : q.answer.mediaUrl ? <MediaPlayer storagePath={q.answer.mediaUrl} submissionType={q.answer.type as any} /> : <Text style={s.meta}>Answer attached.</Text>
            ) : <Text style={s.meta}>No answer to this question.</Text>}
            <ChipRow accessibilityLabel={`How well was question ${i + 1} understood`} single>
              {(Object.keys(QUESTION_STATUS_LABEL) as QuestionStatus[]).map((st) => (
                <FilterChip key={st} label={QUESTION_STATUS_LABEL[st]} selected={v.status === st} selection="single" disabled={readOnly}
                  onPress={() => { touch(); setQs({ ...qs, [q.id]: { ...v, status: st } }); }} />
              ))}
            </ChipRow>
            {v.status && v.status !== "well_understood" ? (
              <ChipRow accessibilityLabel="What kind of difference is it" single>
                {(Object.keys(DIFFERENCE_LABEL) as DifferenceKind[]).map((k) => (
                  <FilterChip key={k} label={DIFFERENCE_LABEL[k]} selected={v.kind === k} selection="single" disabled={readOnly} onPress={() => { touch(); setQs({ ...qs, [q.id]: { ...v, kind: k } }); }} />
                ))}
              </ChipRow>
            ) : null}
            <TextInput style={s.input} value={v.note ?? ""} editable={!readOnly} multiline maxLength={2000} placeholder="Explain (optional)" placeholderTextColor={c.textMuted}
              onChangeText={(t) => { touch(); setQs({ ...qs, [q.id]: { ...v, note: t } }); }} accessibilityLabel={`Feedback on question ${i + 1}`} />
          </View>
        );
      })}
      {d.overallAnswer.length ? (
        <View style={s.panel}>
          <Text style={s.label}>Their submission</Text>
          {d.overallAnswer.map((a, i) => (a.type === "text" ? <Text key={i} style={s.answer} selectable>{a.text}</Text> : a.mediaUrl ? <MediaPlayer key={i} storagePath={a.mediaUrl} submissionType={a.type as any} /> : null))}
        </View>
      ) : null}

      <Text style={s.section} accessibilityRole="header">Your overall feedback</Text>
      {OVERALL.map((o) => (
        <View key={o.key} style={{ gap: 4 }}>
          <Text style={s.label}>{o.title}</Text>
          <TextInput style={s.input} value={overall[o.key] ?? ""} editable={!readOnly} multiline maxLength={3000} placeholder={o.hint} placeholderTextColor={c.textMuted}
            onChangeText={(t) => { touch(); setOverall({ ...overall, [o.key]: t }); }} accessibilityLabel={o.title} />
        </View>
      ))}

      <Text style={s.section} accessibilityRole="header">Overall outcome</Text>
      <ChipRow accessibilityLabel="Overall outcome" single>
        {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <FilterChip key={o} label={OUTCOME_LABEL[o]} selected={outcome === o} selection="single" disabled={readOnly} onPress={() => { touch(); setOutcome(o); }} />)}
      </ChipRow>
      <Text style={s.meta}>Passed (with or without recommendations) completes the lesson. The others ask for a revision and invite a conversation.</Text>

      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {active ? (
        <>
          <Text style={s.meta}>{saved ? `Draft saved ${new Date(saved).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Your draft saves automatically."}{missingStatus ? " · Mark how well each question was understood." : ""}</Text>
          <View style={s.row}>
            <AppButton label="Submit feedback" icon="send" disabled={!canSubmit} loading={busy === "submit"}
              onPress={() => confirm("Submit feedback", "Once submitted, your feedback goes to the evaluatee and can't be changed. Submit now?", "Submit", submit)} />
            <AppButton label="Save draft" variant="secondary" loading={busy === "draft"} onPress={async () => {
              setBusy("draft"); try { const r = await saveDraft(d.assignmentId!, feedback()); setSaved(r.savedAt); dirty.current = false; } catch (e: any) { setError(e?.message ?? "Couldn't save."); } finally { setBusy(null); }
            }} />
          </View>
        </>
      ) : null}
      <AppButton label="Discuss with the evaluatee" icon="chatbubbles-outline" variant="tertiary" loading={busy === "discuss"} onPress={async () => {
        setBusy("discuss"); try { const r = await openDiscussion(d.id); router.push(`/messages/${r.conversationId}` as any); } catch (e: any) { setError(e?.message ?? "Couldn't open the discussion."); } finally { setBusy(null); }
      }} />

      {active ? (unable ? (
        <View style={s.panel}>
          <Text style={s.title}>Report inability to complete</Text>
          <Text style={s.meta}>P2P Global will end your part and arrange another qualified evaluator automatically. The learner's work stays safe.</Text>
          <ChipRow accessibilityLabel="Reason" single>
            {(Object.keys(UNABLE_LABEL) as UnableCategory[]).map((k) => <FilterChip key={k} label={UNABLE_LABEL[k]} selected={unable.category === k} selection="single" onPress={() => setUnable({ ...unable, category: k })} />)}
          </ChipRow>
          <TextInput style={s.input} value={unable.note} onChangeText={(t) => setUnable({ ...unable, note: t })} multiline maxLength={1000} placeholder="Anything to add (optional, private)" placeholderTextColor={c.textMuted} accessibilityLabel="Optional explanation" />
          <View style={s.row}>
            <AppButton label="Report" variant="destructive" disabled={!unable.category} loading={busy === "unable"} onPress={() => confirm("Report inability", "You won't be able to continue this evaluation. P2P Global will reassign it.", "Report", async () => {
              setBusy("unable");
              try { await reportUnable(d.assignmentId!, unable.category!, unable.note.trim() || undefined); router.replace("/evaluation" as any); } catch (e: any) { setError(e?.message ?? "Couldn't report it."); } finally { setBusy(null); }
            })} />
            <AppButton label="Cancel" variant="tertiary" onPress={() => setUnable(null)} />
          </View>
        </View>
      ) : <AppButton label="Report inability to complete" icon="alert-circle-outline" variant="tertiary" onPress={() => setUnable({ category: null, note: "" })} />) : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", padding: 24 },
    content: { padding: 16, gap: 12, paddingBottom: 140, maxWidth: 860, width: "100%", alignSelf: "center" },
    kicker: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.8, textTransform: "uppercase" },
    h1: { fontSize: 22, lineHeight: 28, color: c.textDark, fontFamily: "Inter_700Bold" },
    title: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    section: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 8 },
    label: { fontSize: 12.5, color: c.textMid, fontFamily: "Inter_700Bold" },
    question: { fontSize: 15, lineHeight: 21, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    answer: { fontSize: 14.5, lineHeight: 22, color: c.textDark, fontFamily: "Inter_400Regular", padding: 12, borderRadius: 12, backgroundColor: c.lightCream },
    body: { fontSize: 14.5, lineHeight: 21, color: c.textDark, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    fair: { fontSize: 13, lineHeight: 19, color: c.textMid, fontFamily: "Inter_400Regular", fontStyle: "italic" },
    quote: { fontSize: 14, lineHeight: 21, color: c.textMid, fontFamily: "Inter_400Regular", fontStyle: "italic" },
    error: { color: "#C0392B", fontFamily: "Inter_500Medium", fontSize: 13 },
    panel: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.card },
    verse: { gap: 8, padding: 14, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: c.accentGreen, backgroundColor: c.card },
    done: { padding: 14, borderRadius: 16, backgroundColor: `${c.accentGreen}22` },
    doneText: { fontSize: 14.5, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    input: { minHeight: 64, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.lightCream, fontFamily: "Inter_400Regular", fontSize: 14.5, textAlignVertical: "top" },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  });
}
