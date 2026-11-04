import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, TextInput, AppState, Switch } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import Countdown from "@/components/evaluation/Countdown";
import {
  getEvaluation, openDiscussion, rateEvaluation, OUTCOME_LABEL, QUESTION_STATUS_LABEL, DIFFERENCE_LABEL, STAGE_LABEL,
  type EvaluateeView,
} from "@/lib/peerEvaluationApi";

// One of my evaluations (the evaluatee). What I see: the check, when I
// submitted, where it stands, my evaluator — only once they've ACCEPTED — the
// live countdown, a simple history (no names of invited or previous
// evaluators), my feedback when it's ready, the discussion and a short
// "how was this evaluation?" for me to share. My submission is always safe;
// a reassignment never asks me to submit again.

const STATUS_TEXT: Record<string, string> = {
  arranging: "Your submission was received. P2P Global is arranging a qualified evaluator — we'll let you know when someone accepts.",
  invitation_pending: "An evaluator has been invited. You'll see who it is once they accept responsibility.",
  in_progress: "Your evaluator has accepted and is reviewing your work.",
  overdue_reassigning: "The evaluation time has ended, so P2P Global is reassigning your evaluation to another qualified evaluator. Your original submission and progress are safe.",
  feedback_ready: "Your feedback is ready.",
  revision_required: "Your evaluator has asked for a revision. Read the feedback, then resubmit from the lesson when you're ready.",
  completed: "This evaluation is complete.",
};

export default function EvaluationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [d, setD] = useState<EvaluateeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await getEvaluation(id);
      if (r.role === "evaluator") { router.replace({ pathname: "/evaluation/review/[id]", params: { id } } as any); return; }
      setD(r); setError(null);
    } catch (e: any) { setError(e?.message ?? "Couldn't load this evaluation."); }
  }, [id, router]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const sub = AppState.addEventListener("change", (st) => { if (st === "active") load(); }); return () => sub.remove(); }, [load]);

  async function discuss() {
    if (!d) return;
    setBusy("discuss");
    try { const r = await openDiscussion(d.id); router.push(`/messages/${r.conversationId}` as any); }
    catch (e: any) { setError(e?.message ?? "Couldn't open the discussion."); }
    finally { setBusy(null); }
  }

  if (!d) return <View style={[s.screen, s.center]}><Stack.Screen options={{ title: "Evaluation" }} />{error ? <Text style={s.meta}>{error}</Text> : <ActivityIndicator color={c.accentGreen} accessibilityLabel="Loading" />}</View>;
  const fb = d.feedback;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: "Evaluation" }} />
      <Text style={s.kicker}>{d.curriculum ?? "Lesson check"}</Text>
      <Text style={s.h1} accessibilityRole="header">{d.checkTitle ?? d.lessonTitle}</Text>
      <Text style={s.meta}>{d.lessonTitle} · submitted {new Date(d.submittedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>

      <View style={s.status}>
        <Text style={s.statusTitle}>{STAGE_LABEL[d.stage]}</Text>
        <Text style={s.body}>{STATUS_TEXT[d.stage]}</Text>
      </View>

      {d.evaluator ? (
        <View style={s.person}>
          <Avatar photoUrl={d.evaluator.photoUrl} name={d.evaluator.name} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{d.evaluator.name}</Text>
            <Text style={s.meta}>Your evaluator{d.acceptedAt ? ` · accepted ${new Date(d.acceptedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}</Text>
          </View>
        </View>
      ) : null}
      {(d.stage === "in_progress" || d.stage === "overdue_reassigning") && d.deadlineAt ? (
        <Countdown deadlineAt={d.deadlineAt} overdueNote="P2P Global reassigns automatically when time runs out — you don't need to do anything." />
      ) : null}
      {d.canDiscuss ? <AppButton label="Discuss this evaluation" icon="chatbubbles-outline" variant="secondary" onPress={discuss} loading={busy === "discuss"} /> : null}

      {fb ? (
        <View style={s.panel}>
          <Text style={s.section} accessibilityRole="header">Feedback · {OUTCOME_LABEL[fb.outcome]}</Text>
          {fb.detail ? (
            <>
              {fb.detail.understoodWell ? <Block s={s} title="What you understood well" text={fb.detail.understoodWell} /> : null}
              {fb.detail.needsImprovement ? <Block s={s} title="What needs improvement" text={fb.detail.needsImprovement} /> : null}
              {fb.detail.misunderstandings ? <Block s={s} title="Clearing up misunderstandings" text={fb.detail.misunderstandings} /> : null}
              {fb.detail.questions?.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={s.blockTitle}>Question by question</Text>
                  {fb.detail.questions.map((q) => (
                    <View key={q.questionId} style={s.q}>
                      <Text style={s.body}>{fb.questions.find((x) => x.id === q.questionId)?.question ?? "Question"}</Text>
                      <Text style={s.qStatus}>{QUESTION_STATUS_LABEL[q.status]}{q.kind ? ` · ${DIFFERENCE_LABEL[q.kind]}` : ""}</Text>
                      {q.note ? <Text style={s.body}>{q.note}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : null}
              {fb.detail.scriptures ? <Block s={s} title="Scripture to read" text={fb.detail.scriptures} /> : null}
              {fb.detail.recommendedLessons ? <Block s={s} title="Recommended lessons" text={fb.detail.recommendedLessons} /> : null}
              {fb.detail.nextSteps ? <Block s={s} title="Practical next steps" text={fb.detail.nextSteps} /> : null}
              {fb.detail.encouragement ? <Block s={s} title="Encouragement" text={fb.detail.encouragement} /> : null}
              {fb.detail.comments ? <Block s={s} title="More" text={fb.detail.comments} /> : null}
            </>
          ) : fb.summary ? <Text style={s.body}>{fb.summary}</Text> : <Text style={s.meta}>Your evaluator didn't add written feedback.</Text>}
          <Text style={s.meta}>Questions about the feedback? Use “Discuss this evaluation” — asking for clarification is always welcome.</Text>
        </View>
      ) : null}

      {d.canRate ? <QualityForm id={d.id} s={s} c={c} onDone={load} /> : null}

      {d.history.length ? (
        <View style={s.panel}>
          <Text style={s.section} accessibilityRole="header">What has happened</Text>
          {d.history.map((h, i) => (
            <View key={i} style={s.hist}>
              <Ionicons name="ellipse" size={8} color={c.accentGreen} style={{ marginTop: 6 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.body}>{h.text}</Text>
                <Text style={s.meta}>{new Date(h.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
              </View>
            </View>
          ))}
          <Text style={s.meta}>Your original submission and progress are always kept, whatever happens.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Block({ s, title, text }: { s: Styles; title: string; text: string }) {
  return <View style={{ gap: 4 }}><Text style={s.blockTitle}>{title}</Text><Text style={s.body}>{text}</Text></View>;
}

const QUESTIONS: { key: "helpfulness" | "clarity" | "respectfulness" | "encouragement" | "relevance"; label: string }[] = [
  { key: "helpfulness", label: "Helpful" }, { key: "clarity", label: "Clear" }, { key: "respectfulness", label: "Respectful" },
  { key: "encouragement", label: "Encouraging" }, { key: "relevance", label: "Relevant to the lesson" },
];
function QualityForm({ id, s, c, onDone }: { id: string; s: Styles; c: AppColors; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, number>>({});
  const [helped, setHelped] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [concern, setConcern] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ready = QUESTIONS.every((q) => vals[q.key]) && helped !== null;
  return (
    <View style={s.panel}>
      <Text style={s.section} accessibilityRole="header">How was this evaluation?</Text>
      <Text style={s.meta}>Private — it helps evaluators grow in their service. Please be kind and honest.</Text>
      {QUESTIONS.map((q) => (
        <View key={q.key} style={{ gap: 4 }}>
          <Text style={s.body}>{q.label}</Text>
          <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={q.label}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setVals({ ...vals, [q.key]: n })} style={[s.dot, vals[q.key] === n && { backgroundColor: c.accentGreen, borderColor: c.accentGreen }]}
                accessibilityRole="radio" accessibilityState={{ checked: vals[q.key] === n }} accessibilityLabel={`${q.label}: ${n} of 5`}>
                <Text style={[s.dotText, vals[q.key] === n && { color: "#fff" }]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Text style={[s.body, { flex: 1 }]}>Did the feedback help you understand?</Text>
        <AppButton label="Yes" size="sm" variant={helped === true ? "primary" : "tertiary"} onPress={() => setHelped(true)} />
        <AppButton label="Not really" size="sm" variant={helped === false ? "primary" : "tertiary"} onPress={() => setHelped(false)} />
      </View>
      <TextInput style={s.input} value={comment} onChangeText={setComment} placeholder="Anything to add? (optional)" placeholderTextColor={c.textMuted} multiline maxLength={1000} accessibilityLabel="Optional comment" />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={[s.meta, { flex: 1 }]}>Raise a concern privately with the coordinators (for example, if something was disrespectful)</Text>
        <Switch value={concern} onValueChange={setConcern} accessibilityLabel="Raise a private concern" trackColor={{ true: c.amber, false: c.borderBeige }} thumbColor="#fff" />
      </View>
      {msg ? <Text style={s.meta} accessibilityLiveRegion="polite">{msg}</Text> : null}
      <AppButton label="Share" onPress={async () => {
        setBusy(true);
        try { await rateEvaluation(id, { helpfulness: vals.helpfulness, clarity: vals.clarity, respectfulness: vals.respectfulness, encouragement: vals.encouragement, relevance: vals.relevance, helpedUnderstand: !!helped, comment: comment.trim() || undefined, concern }); setMsg("Thank you."); onDone(); }
        catch (e: any) { setMsg(e?.message ?? "Couldn't share it."); } finally { setBusy(false); }
      }} disabled={!ready} loading={busy} />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;
function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", padding: 24 },
    content: { padding: 16, gap: 12, paddingBottom: 120, maxWidth: 820, width: "100%", alignSelf: "center" },
    kicker: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.8, textTransform: "uppercase" },
    h1: { fontSize: 22, lineHeight: 28, color: c.textDark, fontFamily: "Inter_700Bold" },
    title: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    blockTitle: { fontSize: 13, color: c.textMid, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14.5, lineHeight: 21, color: c.textDark, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12.5, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    status: { gap: 4, padding: 14, borderRadius: 16, backgroundColor: c.card, borderLeftWidth: 4, borderLeftColor: c.accentGreen },
    statusTitle: { fontSize: 15, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    person: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.card },
    panel: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.card },
    q: { gap: 4, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    qStatus: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    hist: { flexDirection: "row", gap: 8 },
    dot: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    dotText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    input: { minHeight: 64, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, backgroundColor: c.lightCream, fontFamily: "Inter_400Regular", fontSize: 14.5, textAlignVertical: "top" },
  });
}
