import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Modal, Switch, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { useDraft, draftKey, loadDraft } from "@/lib/drafts";
import { readQuestions } from "@/lib/customLessonModel";
import {
  getMyReflections, getSharedReflections, submitReflection, setReflectionVisibility, getAssignments, createAssignment, assignmentState,
  VISIBILITY_OPTIONS, type WorkScope, type MyReflection, type SharedReflection, type Assignment, type ReflectionVisibility,
} from "@/lib/lessonWorkApi";
import { AppButton } from "@/components/ui";

function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Under a custom lesson: your reflections (private by default — you choose if
// leaders or the group may read each one), reflections others chose to share
// with you, and the lesson's Comprehensive Checks. Drafts (this device + the writer's other devices, migration 213) are kept until
// submitted. Nothing here changes lesson completion or group progress.
export default function LessonWork({ scope, lessonId, questions }: { scope: WorkScope; lessonId: string; questions: unknown[] }) {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const reflectionQs = readQuestions(questions as unknown[]).filter((q) => q.kind === "reflection" && q.id);
  const [mine, setMine] = useState<MyReflection[]>([]);
  const [shared, setShared] = useState<SharedReflection[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, s, a] = await Promise.all([
        reflectionQs.length ? getMyReflections(scope, lessonId) : Promise.resolve({ reflections: [] as MyReflection[] }),
        reflectionQs.length ? getSharedReflections(scope, lessonId) : Promise.resolve({ reflections: [] as SharedReflection[] }),
        getAssignments(scope, lessonId),
      ]);
      setMine(m.reflections); setShared(s.reflections); setAssignments(a.assignments); setCanManage(a.canManage); setError(null);
    } catch (e: any) { setError(e?.message ?? "Couldn't load reflections and Comprehensive Checks."); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, lessonId, reflectionQs.length]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <ActivityIndicator color={c.accentGreen} style={{ marginTop: 20 }} />;
  if (error) {
    return (
      <View style={styles.block}>
        <Text style={styles.muted}>{error}</Text>
        <AppButton label="Try again" onPress={() => { setLoading(true); load(); }} variant="tertiary" style={{ alignSelf: "flex-start" }} />
      </View>
    );
  }

  return (
    <View style={{ gap: 18, marginTop: 24 }}>
      {reflectionQs.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.heading}>Your reflections</Text>
          <Text style={styles.muted}>Private unless you choose otherwise. Saved to your journal.</Text>
          {reflectionQs.map((q) => (
            <ReflectionCard key={q.id} scope={scope} lessonId={lessonId} questionId={q.id!} question={q.text}
              latest={mine.find((m) => m.questionId === q.id) ?? null} onSaved={load} styles={styles} c={c} />
          ))}
        </View>
      )}

      {shared.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.heading}>Shared with you</Text>
          <Text style={styles.muted}>Reflections members chose to share{canManage ? " with leaders or the group" : " with the group"}.</Text>
          {shared.map((r) => (
            <View key={r.id} style={styles.sharedCard}>
              <Text style={styles.sharedAuthor}>{r.author.name}</Text>
              <Text style={styles.sharedQ}>{r.question}</Text>
              <Text style={styles.body}>{r.content}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.block}>
        <View style={styles.rowBetween}>
          <Text style={styles.heading}>Comprehensive Checks</Text>
          {canManage && (
            <AppButton label="+ New" onPress={() => setCreating(true)} variant="tertiary" accessibilityLabel="New Comprehensive Check" style={{ alignSelf: "flex-start" }} />
          )}
        </View>
        {assignments.length === 0 ? <Text style={styles.muted}>No Comprehensive Checks for this lesson.</Text> : assignments.map((a) => (
          <AssignmentRow key={a.id} scope={scope} a={a} canManage={canManage} styles={styles} c={c} />
        ))}
      </View>

      <NewAssignmentModal visible={creating} onClose={() => setCreating(false)} styles={styles} c={c}
        onCreate={async (input) => { await createAssignment(scope, lessonId, input); setCreating(false); await load(); }} />
    </View>
  );
}

function ReflectionCard({ scope, lessonId, questionId, question, latest, onSaved, styles, c }: {
  scope: WorkScope; lessonId: string; questionId: string; question: string; latest: MyReflection | null; onSaved: () => Promise<void>;
  styles: ReturnType<typeof makeStyles>; c: AppColors;
}) {
  const { profile } = useAuth();
  const draft = useDraft(profile?.id ? draftKey(profile.id, `custom:${scope}:${lessonId}:reflection:${questionId}`) : null);
  const [visibility, setVisibility] = useState<ReflectionVisibility>(latest?.visibility ?? "private");
  const [editing, setEditing] = useState(!latest);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (draft.restored) setEditing(true); }, [draft.restored]);
  useEffect(() => { if (latest) setVisibility(latest.visibility); }, [latest]);

  async function submit() {
    if (!draft.text.trim() || busy) return;
    setBusy(true);
    try { await submitReflection(scope, lessonId, questionId, draft.text, visibility); await draft.clear(); setEditing(false); await onSaved(); }
    catch (e: any) { notify("Couldn't save your reflection", e?.message ?? "Please try again."); }
    finally { setBusy(false); }
  }
  async function changeVisibility(v: ReflectionVisibility) {
    setVisibility(v);
    if (!latest || editing) return;
    try { await setReflectionVisibility(latest.id, v); await onSaved(); }
    catch (e: any) { setVisibility(latest.visibility); notify("Couldn't change who can see it", e?.message ?? "Please try again."); }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.question}>{question}</Text>
      {latest && !editing ? (
        <>
          <Text style={styles.body}>{latest.content}</Text>
          <AppButton label="Write an update" onPress={() => setEditing(true)} variant="tertiary" style={{ alignSelf: "flex-start" }} />
        </>
      ) : (
        <>
          <TextInput style={styles.input} multiline value={draft.text} onChangeText={draft.setText} textAlignVertical="top"
            placeholder="Write your reflection…" placeholderTextColor={c.textMuted} accessibilityLabel={`Your reflection: ${question}`} />
          <Text style={styles.hint}>{draft.text.trim() ? "Draft saved — it continues on your other devices" : " "}</Text>
        </>
      )}
      <Text style={styles.label}>Who can see this?</Text>
      <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
        {VISIBILITY_OPTIONS.map((o) => (
          <TouchableOpacity key={o.value} style={[styles.option, visibility === o.value && styles.optionOn]} onPress={() => changeVisibility(o.value)}
            accessibilityRole="radio" accessibilityState={{ checked: visibility === o.value }} accessibilityLabel={`${o.label}. ${o.detail}`}>
            <Ionicons name={visibility === o.value ? "radio-button-on" : "radio-button-off"} size={18} color={visibility === o.value ? c.accentGreen : c.textMuted} />
            <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{o.label}</Text><Text style={styles.hint}>{o.detail}</Text></View>
          </TouchableOpacity>
        ))}
      </View>
      {(!latest || editing) && (
        <TouchableOpacity style={[styles.primary, (!draft.text.trim() || busy) && { opacity: 0.5 }]} onPress={submit} disabled={!draft.text.trim() || busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{latest ? "Save update" : "Save reflection"}</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

function AssignmentRow({ scope, a, canManage, styles, c }: { scope: WorkScope; a: Assignment; canManage: boolean; styles: ReturnType<typeof makeStyles>; c: AppColors }) {
  const router = useRouter();
  const { profile } = useAuth();
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => {
    if (!profile?.id) return;
    let live = true;
    void loadDraft(draftKey(profile.id, `custom:${scope}:assignment:${a.id}`)).then((t) => { if (live) setHasDraft(!!t.trim()); });
    return () => { live = false; };
  }, [profile?.id, scope, a.id]);
  const state = assignmentState(a, hasDraft);
  return (
    <TouchableOpacity style={styles.assignment} onPress={() => router.push({ pathname: "/learning/assignment/[assignmentId]", params: { assignmentId: a.id, s: scope } } as any)}
      accessibilityRole="button" accessibilityLabel={`${a.title}, ${canManage && a.status !== "published" ? a.status : state}`}>
      <Ionicons name="clipboard-outline" size={18} color={c.accentGreen} />
      <View style={{ flex: 1 }}>
        <Text style={styles.assignmentTitle}>{a.title}</Text>
        <Text style={styles.hint}>
          {a.dueAt ? `Due ${new Date(a.dueAt).toLocaleDateString()} · ` : ""}{canManage && a.status !== "published" ? (a.status === "draft" ? "Draft — members can't see it" : "Archived") : state}
          {canManage && a.status === "published" ? ` · ${a.submittedCount ?? 0} submitted` : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
    </TouchableOpacity>
  );
}

function NewAssignmentModal({ visible, onClose, onCreate, styles, c }: {
  visible: boolean; onClose: () => void; onCreate: (input: { title: string; instructions: string | null; dueAt: string | null; allowResubmission: boolean; status: "draft" | "published" }) => Promise<void>;
  styles: ReturnType<typeof makeStyles>; c: AppColors;
}) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [due, setDue] = useState("");
  const [allowResubmission, setAllow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (visible) { setTitle(""); setInstructions(""); setDue(""); setAllow(true); setProblem(null); } }, [visible]);

  async function save(status: "draft" | "published") {
    if (!title.trim()) { setProblem("Give the Comprehensive Check a title."); return; }
    let dueAt: string | null = null;
    if (due.trim()) {
      const m = due.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59) : null;
      if (!d || Number.isNaN(d.getTime())) { setProblem("Write the due date as YYYY-MM-DD, or leave it empty."); return; }
      dueAt = d.toISOString();
    }
    setBusy(true); setProblem(null);
    try { await onCreate({ title: title.trim(), instructions: instructions.trim() || null, dueAt, allowResubmission, status }); }
    catch (e: any) { setProblem(e?.message ?? "Couldn't create the Comprehensive Check."); }
    finally { setBusy(false); }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.heading}>New Comprehensive Check</Text>
          <TextInput style={[styles.input, { minHeight: 44 }]} value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={c.textMuted} maxLength={160} accessibilityLabel="Comprehensive Check title" />
          <TextInput style={styles.input} value={instructions} onChangeText={setInstructions} multiline textAlignVertical="top" placeholder="Instructions (optional)" placeholderTextColor={c.textMuted} maxLength={5000} accessibilityLabel="Instructions" />
          <TextInput style={[styles.input, { minHeight: 44 }]} value={due} onChangeText={setDue} placeholder="Due date YYYY-MM-DD (optional)" placeholderTextColor={c.textMuted} autoCapitalize="none" accessibilityLabel="Due date" />
          <View style={styles.rowBetween}>
            <Text style={styles.optionLabel}>Allow resubmitting</Text>
            <Switch value={allowResubmission} onValueChange={setAllow} accessibilityLabel="Allow resubmitting" />
          </View>
          <Text style={styles.hint}>Answers are written in the app. Returned work can always be resubmitted.</Text>
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          <View style={styles.row}>
            <AppButton label="Cancel" onPress={onClose} variant="outline" disabled={busy} />
            <AppButton label="Save draft" onPress={() => save("draft")} variant="outline" disabled={busy} />
            <AppButton label="Publish" onPress={() => save("published")} disabled={busy} loading={busy} style={{ flex: 1, marginTop: 0 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    block: { gap: 8 },
    heading: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    muted: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    hint: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    label: { fontSize: 12, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 6 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 6 },
    question: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    body: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
    input: { backgroundColor: c.lightCream, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, padding: 10, minHeight: 90, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular" },
    option: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige },
    optionOn: { borderColor: c.accentGreen },
    optionLabel: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    primary: { backgroundColor: c.primaryGreen, borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 6 },
    primaryText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    secondary: { minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    secondaryText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    linkBtn: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
    link: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    sharedCard: { borderLeftWidth: 3, borderLeftColor: c.accentGreen, paddingLeft: 10, gap: 2 },
    sharedAuthor: { fontSize: 13, color: c.textDark, fontFamily: "Inter_700Bold" },
    sharedQ: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    assignment: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, paddingHorizontal: 12 },
    assignmentTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, gap: 10 },
    problem: { fontSize: 13, color: "#B42318", fontFamily: "Inter_500Medium" },
  });
}
