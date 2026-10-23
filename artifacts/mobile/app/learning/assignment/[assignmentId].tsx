import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert, Platform } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { useDraft, draftKey } from "@/lib/drafts";
import {
  getMyAttempts, submitAssignment, getSubmissionsForReview, reviewSubmission, updateAssignment,
  type Assignment, type Submission, type WorkScope,
} from "@/lib/lessonWorkApi";

function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
const STATUS_LABEL: Record<Submission["status"], string> = { submitted: "Submitted", reviewed: "Reviewed", returned: "Returned" };
type ReviewRow = Submission & { attempts: number; author: { id: string; name: string; photoUrl: string | null } };

// One assignment on a custom lesson. Members: instructions, their own
// attempts (never overwritten) with feedback, and the answer box (draft kept
// on this device and the writer's other devices until submitted). Reviewers (the group's leaders or the
// assignment's author): each member's latest attempt, Mark reviewed / Return
// with feedback. Leaders: Publish / Unpublish / Archive. The server enforces
// every one of these rules.
export default function AssignmentScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { profile } = useAuth();
  const { assignmentId, s } = useLocalSearchParams<{ assignmentId: string; s: string }>();
  const scope: WorkScope | null = s === "family" || s === "church" ? s : null;
  const draft = useDraft(profile?.id && scope && assignmentId ? draftKey(profile.id, `custom:${scope}:assignment:${assignmentId}`) : null);

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [attempts, setAttempts] = useState<Submission[]>([]);
  const [review, setReview] = useState<ReviewRow[] | null>(null); // null = not a reviewer
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!scope || !assignmentId) return;
    try {
      const mine = await getMyAttempts(scope, assignmentId);
      setAssignment(mine.assignment); setAttempts(mine.attempts); setError(null);
      try { setReview((await getSubmissionsForReview(scope, assignmentId)).submissions); } catch { setReview(null); }
    } catch (e: any) { setError(e?.status === 404 ? "This Comprehensive Check isn't available." : e?.message ?? "Couldn't load the Comprehensive Check."); }
    finally { setLoading(false); }
  }, [scope, assignmentId]);
  useEffect(() => { load(); }, [load]);

  const latest = attempts[attempts.length - 1] ?? null;
  const canSubmit = !!assignment && assignment.status === "published" && (!latest || latest.status === "returned" || assignment.allowResubmission);

  async function submit() {
    if (!scope || !assignmentId || !draft.text.trim() || busy) return;
    setBusy("submit");
    try { await submitAssignment(scope, assignmentId, draft.text); await draft.clear(); await load(); }
    catch (e: any) { notify("Couldn't submit", e?.message ?? "Please try again."); }
    finally { setBusy(null); }
  }
  async function doReview(row: ReviewRow, status: "reviewed" | "returned") {
    if (!scope) return;
    const fb = (feedback[row.id] ?? "").trim();
    if (status === "returned" && !fb) { notify("Add feedback", "Say what to change when returning work."); return; }
    setBusy(row.id);
    try { await reviewSubmission(scope, row.id, status, fb); setFeedback((f) => ({ ...f, [row.id]: "" })); await load(); }
    catch (e: any) { notify("Couldn't save the review", e?.message ?? "Please try again."); }
    finally { setBusy(null); }
  }
  async function setStatus(status: "draft" | "published" | "archived") {
    if (!scope || !assignmentId) return;
    setBusy(status);
    try { setAssignment(await updateAssignment(scope, assignmentId, { status })); }
    catch (e: any) { notify("Couldn't update", e?.message ?? "Please try again."); }
    finally { setBusy(null); }
  }

  if (!scope) return <View style={[styles.screen, styles.center]}><Stack.Screen options={{ title: "Comprehensive Check" }} /><Text style={styles.muted}>This page isn't available.</Text></View>;
  if (loading) return <View style={[styles.screen, styles.center]}><Stack.Screen options={{ title: "Comprehensive Check" }} /><ActivityIndicator color={c.primaryGreen} /></View>;
  if (error || !assignment) return <View style={[styles.screen, styles.center]}><Stack.Screen options={{ title: "Comprehensive Check" }} /><Text style={styles.muted}>{error ?? "This Comprehensive Check isn't available."}</Text></View>;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Comprehensive Check" }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{assignment.title}</Text>
        {assignment.dueAt ? <Text style={styles.meta}>Due {new Date(assignment.dueAt).toLocaleString()}</Text> : null}
        {assignment.status !== "published" && <Text style={styles.banner}>{assignment.status === "draft" ? "Draft — members can't see this yet" : "Archived — members can't see this"}</Text>}
        {assignment.instructions ? <Text style={styles.body}>{assignment.instructions}</Text> : null}

        {review !== null && (
          <View style={styles.row}>
            {assignment.status !== "published" && <SmallBtn styles={styles} label="Publish" busy={busy === "published"} onPress={() => setStatus("published")} />}
            {assignment.status === "published" && <SmallBtn styles={styles} label="Unpublish" busy={busy === "draft"} onPress={() => setStatus("draft")} />}
            {assignment.status !== "archived" && <SmallBtn styles={styles} label="Archive" busy={busy === "archived"} onPress={() => setStatus("archived")} />}
          </View>
        )}

        {/* My work */}
        {assignment.status === "published" && (
          <View style={styles.card}>
            <Text style={styles.heading}>Your answer</Text>
            {attempts.map((a) => (
              <View key={a.id} style={styles.attempt}>
                <Text style={styles.meta}>Attempt {a.attempt} · {STATUS_LABEL[a.status]} · {new Date(a.submittedAt).toLocaleDateString()}</Text>
                <Text style={styles.body}>{a.content}</Text>
                {a.feedback ? <Text style={styles.feedback}>Feedback: {a.feedback}</Text> : null}
              </View>
            ))}
            {canSubmit ? (
              <>
                <TextInput style={styles.input} multiline textAlignVertical="top" value={draft.text} onChangeText={draft.setText}
                  placeholder={latest ? "Write your new answer…" : "Write your answer…"} placeholderTextColor={c.textMuted} accessibilityLabel="Your answer" />
                <Text style={styles.meta}>{draft.text.trim() ? "Draft saved — it continues on your other devices" : "Reviewed by your group's leaders."}</Text>
                <TouchableOpacity style={[styles.primary, (!draft.text.trim() || busy === "submit") && { opacity: 0.5 }]} onPress={submit} disabled={!draft.text.trim() || busy === "submit"} accessibilityRole="button">
                  {busy === "submit" ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{latest ? "Submit again" : "Submit"}</Text>}
                </TouchableOpacity>
              </>
            ) : latest ? <Text style={styles.meta}>Submitted. {latest.status === "reviewed" ? "It has been reviewed." : "Waiting for review."}</Text> : null}
          </View>
        )}

        {/* Reviewing */}
        {review !== null && (
          <View style={styles.card}>
            <Text style={styles.heading}>Submissions ({review.length})</Text>
            {review.length === 0 ? <Text style={styles.muted}>Nobody has submitted yet.</Text> : review.map((r) => (
              <View key={r.id} style={styles.attempt}>
                <Text style={styles.author}>{r.author.name}</Text>
                <Text style={styles.meta}>Attempt {r.attempt}{r.attempts > 1 ? ` of ${r.attempts}` : ""} · {STATUS_LABEL[r.status]}</Text>
                <Text style={styles.body}>{r.content}</Text>
                {r.feedback ? <Text style={styles.feedback}>Your feedback: {r.feedback}</Text> : null}
                {r.status === "submitted" && (
                  <>
                    <TextInput style={[styles.input, { minHeight: 60 }]} multiline value={feedback[r.id] ?? ""} onChangeText={(v) => setFeedback((f) => ({ ...f, [r.id]: v }))}
                      placeholder="Feedback (needed to return work)" placeholderTextColor={c.textMuted} accessibilityLabel={`Feedback for ${r.author.name}`} />
                    <View style={styles.row}>
                      <SmallBtn styles={styles} label="Mark reviewed" busy={busy === r.id} onPress={() => doReview(r, "reviewed")} />
                      <SmallBtn styles={styles} label="Return with feedback" busy={busy === r.id} onPress={() => doReview(r, "returned")} />
                    </View>
                  </>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SmallBtn({ styles, label, busy, onPress }: { styles: ReturnType<typeof makeStyles>; label: string; busy: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.small} onPress={onPress} disabled={busy} accessibilityRole="button">
      {busy ? <ActivityIndicator size="small" /> : <Text style={styles.smallText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center", padding: 24 },
    scroll: { padding: 16, paddingBottom: 60, gap: 12 },
    title: { fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold" },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    muted: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    banner: { backgroundColor: "#FFF4DB", color: "#7A4B00", borderRadius: 10, padding: 10, fontSize: 13, fontFamily: "Inter_600SemiBold" },
    body: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
    heading: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 8 },
    attempt: { gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige, paddingTop: 8 },
    author: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    feedback: { fontSize: 13, color: c.primaryGreen, fontFamily: "Inter_500Medium" },
    input: { backgroundColor: c.lightCream, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, padding: 10, minHeight: 120, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular" },
    primary: { backgroundColor: c.primaryGreen, borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center" },
    primaryText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    small: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, justifyContent: "center", backgroundColor: c.card },
    smallText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
