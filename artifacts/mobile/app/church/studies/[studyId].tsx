import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import {
  getChurchStudy, updateChurchStudy, archiveChurchStudy, addChurchStudyLesson, updateChurchStudyLesson, removeChurchStudyLesson,
  type ChurchStudy, type ChurchStudyLesson, type CustomStudyStatus,
} from "@/lib/churchStudyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
function confirmAction(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) onConfirm(); }
  else Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Continue", style: "destructive", onPress: onConfirm }]);
}

interface ScriptureRef { book: string; chapter: string; startVerse: string; endVerse: string; translation: string }
const EMPTY_SCRIPTURE: ScriptureRef = { book: "", chapter: "", startVerse: "", endVerse: "", translation: "NIV" };

function lessonToFormState(lesson?: ChurchStudyLesson) {
  const ref = (lesson?.scriptureReferences?.[0] as Partial<ScriptureRef> & { book?: string; chapter?: number; startVerse?: number; endVerse?: number; translation?: string }) ?? {};
  return {
    title: lesson?.title ?? "",
    description: lesson?.description ?? "",
    teachingMaterial: lesson?.teachingMaterial ?? "",
    prayerFocus: lesson?.prayerFocus ?? "",
    questions: (lesson?.questions as string[] | undefined)?.length ? (lesson!.questions as string[]) : [""],
    mediaId: lesson?.media?.id ?? "",
    scripture: {
      book: ref.book ?? "", chapter: ref.chapter ? String(ref.chapter) : "",
      startVerse: ref.startVerse ? String(ref.startVerse) : "", endVerse: ref.endVerse ? String(ref.endVerse) : "",
      translation: ref.translation ?? "NIV",
    } as ScriptureRef,
  };
}

// Custom Study lesson editor — deliberately plain text fields for Scripture
// (book/chapter/start/end verse + translation) rather than a Bible picker,
// exactly matching Church Calls' Ministry Tools panel (app/call/church.tsx)
// and never touching/duplicating the real Scripture/Bible API. Media is a
// bare YouTube video ID, same as Church Calls' media attachment — no new
// media system, no change to YouTube embed/playback code anywhere.
export default function ChurchStudyDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { studyId } = useLocalSearchParams<{ studyId: string }>();
  const { isChurchLeader } = useData();

  const [loading, setLoading] = useState(true);
  const [study, setStudy] = useState<ChurchStudy | null>(null);
  const [lessons, setLessons] = useState<ChurchStudyLesson[]>([]);
  const [savingStatus, setSavingStatus] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [lessonEditor, setLessonEditor] = useState<{ lesson: ChurchStudyLesson | null; form: ReturnType<typeof lessonToFormState> } | null>(null);
  const [savingLesson, setSavingLesson] = useState(false);

  const load = useCallback(async () => {
    if (!studyId) return;
    setLoading(true);
    try {
      const { study: s, lessons: l } = await getChurchStudy(studyId);
      setStudy(s);
      setLessons(l);
    } catch (e: any) {
      showAlert("Couldn't load this Study", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [studyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleChangeStatus(status: CustomStudyStatus) {
    if (!study) return;
    setSavingStatus(true);
    try {
      setStudy(await updateChurchStudy(study.id, { status }));
    } catch (e: any) {
      showAlert("Couldn't update the study", e.message ?? "Please try again.");
    } finally {
      setSavingStatus(false);
    }
  }

  function handleArchive() {
    if (!study) return;
    confirmAction("Archive this Study?", "It will no longer be shown to church members. This can be reviewed later.", async () => {
      try {
        setStudy(await archiveChurchStudy(study.id));
      } catch (e: any) {
        showAlert("Couldn't archive the study", e.message ?? "Please try again.");
      }
    });
  }

  function openEditStudy() {
    if (!study) return;
    setEditTitle(study.title);
    setEditDescription(study.description ?? "");
    setEditOpen(true);
  }
  async function handleSaveEdit() {
    if (!study || !editTitle.trim()) return;
    setSavingEdit(true);
    try {
      setStudy(await updateChurchStudy(study.id, { title: editTitle.trim(), description: editDescription.trim() || null }));
      setEditOpen(false);
    } catch (e: any) {
      showAlert("Couldn't save changes", e.message ?? "Please try again.");
    } finally {
      setSavingEdit(false);
    }
  }

  function openAddLesson() {
    setLessonEditor({ lesson: null, form: lessonToFormState() });
  }
  function openEditLesson(lesson: ChurchStudyLesson) {
    setLessonEditor({ lesson, form: lessonToFormState(lesson) });
  }

  async function handleSaveLesson() {
    if (!study || !lessonEditor || !lessonEditor.form.title.trim()) return;
    const { form, lesson } = lessonEditor;
    const scriptureReferences = form.scripture.book.trim() && form.scripture.chapter.trim() && form.scripture.startVerse.trim()
      ? [{
          book: form.scripture.book.trim(), chapter: Number(form.scripture.chapter), startVerse: Number(form.scripture.startVerse),
          endVerse: form.scripture.endVerse.trim() ? Number(form.scripture.endVerse) : Number(form.scripture.startVerse),
          translation: form.scripture.translation.trim() || "NIV",
        }]
      : [];
    const questions = form.questions.map((q) => q.trim()).filter(Boolean);
    const payload = {
      title: form.title.trim(), description: form.description.trim() || null, teachingMaterial: form.teachingMaterial.trim() || null,
      prayerFocus: form.prayerFocus.trim() || null, scriptureReferences, questions,
      media: form.mediaId.trim() ? { provider: "youtube", id: form.mediaId.trim(), url: null } : null,
    };
    setSavingLesson(true);
    try {
      if (lesson) {
        const updated = await updateChurchStudyLesson(study.id, lesson.id, payload);
        setLessons((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      } else {
        const created = await addChurchStudyLesson(study.id, { ...payload, orderIndex: lessons.length });
        setLessons((prev) => [...prev, created]);
      }
      setLessonEditor(null);
    } catch (e: any) {
      showAlert("Couldn't save the lesson", e.message ?? "Please try again.");
    } finally {
      setSavingLesson(false);
    }
  }

  function handleRemoveLesson(lesson: ChurchStudyLesson) {
    if (!study) return;
    confirmAction("Remove this lesson?", lesson.title, async () => {
      try {
        await removeChurchStudyLesson(study.id, lesson.id);
        setLessons((prev) => prev.filter((l) => l.id !== lesson.id));
      } catch (e: any) {
        showAlert("Couldn't remove the lesson", e.message ?? "Please try again.");
      }
    });
  }

  function updateLessonForm(patch: Partial<ReturnType<typeof lessonToFormState>>) {
    setLessonEditor((prev) => (prev ? { ...prev, form: { ...prev.form, ...patch } } : prev));
  }
  function updateScripture(patch: Partial<ScriptureRef>) {
    setLessonEditor((prev) => (prev ? { ...prev, form: { ...prev.form, scripture: { ...prev.form.scripture, ...patch } } } : prev));
  }
  function updateQuestion(index: number, value: string) {
    setLessonEditor((prev) => {
      if (!prev) return prev;
      const questions = [...prev.form.questions];
      questions[index] = value;
      return { ...prev, form: { ...prev.form, questions } };
    });
  }
  function addQuestionField() {
    setLessonEditor((prev) => (prev ? { ...prev, form: { ...prev.form, questions: [...prev.form.questions, ""] } } : prev));
  }
  function removeQuestionField(index: number) {
    setLessonEditor((prev) => {
      if (!prev) return prev;
      const questions = prev.form.questions.filter((_, i) => i !== index);
      return { ...prev, form: { ...prev.form, questions: questions.length ? questions : [""] } };
    });
  }

  if (loading) {
    return <View style={[styles.container, styles.centerFill]}><ActivityIndicator color={colors.accentGreen} /></View>;
  }
  if (!study) {
    return <View style={[styles.container, styles.centerFill]}><Text style={styles.emptyText}>This study is not available.</Text></View>;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{study.title}</Text>
        {isChurchLeader ? (
          <TouchableOpacity onPress={openEditStudy} accessibilityLabel="Edit study" accessibilityRole="button">
            <Ionicons name="create-outline" size={20} color={colors.textDark} />
          </TouchableOpacity>
        ) : <View style={{ width: 20 }} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        {!!study.description && <Text style={styles.description}>{study.description}</Text>}

        {isChurchLeader && (
          <View style={styles.statusRow}>
            {(["draft", "published"] as CustomStudyStatus[]).map((s) => (
              <TouchableOpacity
                key={s} disabled={savingStatus || study.status === "archived"}
                style={[styles.statusChip, study.status === s && styles.statusChipActive]}
                onPress={() => handleChangeStatus(s)}
              >
                <Text style={[styles.statusChipText, study.status === s && styles.statusChipTextActive]}>{s === "draft" ? "Draft" : "Published"}</Text>
              </TouchableOpacity>
            ))}
            {study.status !== "archived" && (
              <TouchableOpacity style={styles.archiveBtn} onPress={handleArchive} accessibilityLabel="Archive study">
                <Ionicons name="archive-outline" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}
        {study.status === "archived" && <Text style={styles.archivedNotice}>This study is archived.</Text>}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>LESSONS</Text>
          {isChurchLeader && (
            <TouchableOpacity style={styles.createBtn} onPress={openAddLesson}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.createBtnText}>Add Lesson</Text>
            </TouchableOpacity>
          )}
        </View>

        {lessons.length === 0 ? (
          <Text style={styles.emptyText}>No lessons yet.</Text>
        ) : (
          lessons.map((lesson, i) => (
            <TouchableOpacity
              key={lesson.id} style={styles.lessonCard}
              onPress={() => router.push({ pathname: "/church/studies/lesson/[lessonId]", params: { lessonId: lesson.id, studyId: study.id } } as any)}
            >
              <Text style={styles.lessonNumber}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.lessonTitle}>{lesson.title}</Text>
                {!!lesson.scriptureReferences?.length && (
                  <Text style={styles.lessonMeta}>📖 {(lesson.scriptureReferences[0] as any).book} {(lesson.scriptureReferences[0] as any).chapter}</Text>
                )}
              </View>
              {isChurchLeader && (
                <>
                  <TouchableOpacity onPress={() => openEditLesson(lesson)} accessibilityLabel={`Edit ${lesson.title}`} style={{ marginRight: 4 }}>
                    <Ionicons name="create-outline" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRemoveLesson(lesson)} accessibilityLabel={`Remove ${lesson.title}`}>
                    <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </>
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Edit study title/description */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Edit Study</Text>
            <Text style={styles.fieldLabel}>Study Title</Text>
            <TextInput style={styles.input} value={editTitle} onChangeText={setEditTitle} placeholderTextColor={colors.textMuted} />
            <Text style={styles.fieldLabel}>Study Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={editDescription} onChangeText={setEditDescription} multiline placeholderTextColor={colors.textMuted} />
            <View style={styles.sheetRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditOpen(false)} disabled={savingEdit}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEdit} disabled={savingEdit || !editTitle.trim()}>
                {savingEdit ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Lesson editor */}
      <Modal visible={!!lessonEditor} transparent animationType="slide" onRequestClose={() => setLessonEditor(null)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, styles.lessonSheetBox, { paddingBottom: insets.bottom + 20 }]}>
            <ScrollView>
              <Text style={styles.sheetTitle}>{lessonEditor?.lesson ? "Edit Lesson" : "Add Lesson"}</Text>

              <Text style={styles.fieldLabel}>Lesson Title</Text>
              <TextInput style={styles.input} value={lessonEditor?.form.title} onChangeText={(v) => updateLessonForm({ title: v })} placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Description / Introduction</Text>
              <TextInput style={[styles.input, { minHeight: 60 }]} value={lessonEditor?.form.description} onChangeText={(v) => updateLessonForm({ description: v })} multiline placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Scripture (optional)</Text>
              <View style={styles.scriptureRow}>
                <TextInput style={[styles.input, styles.scriptureBook]} placeholder="Book" placeholderTextColor={colors.textMuted} value={lessonEditor?.form.scripture.book} onChangeText={(v) => updateScripture({ book: v })} />
                <TextInput style={[styles.input, styles.scriptureSmall]} placeholder="Ch" placeholderTextColor={colors.textMuted} keyboardType="number-pad" value={lessonEditor?.form.scripture.chapter} onChangeText={(v) => updateScripture({ chapter: v })} />
              </View>
              <View style={styles.scriptureRow}>
                <TextInput style={[styles.input, styles.scriptureSmall]} placeholder="Start v" placeholderTextColor={colors.textMuted} keyboardType="number-pad" value={lessonEditor?.form.scripture.startVerse} onChangeText={(v) => updateScripture({ startVerse: v })} />
                <TextInput style={[styles.input, styles.scriptureSmall]} placeholder="End v" placeholderTextColor={colors.textMuted} keyboardType="number-pad" value={lessonEditor?.form.scripture.endVerse} onChangeText={(v) => updateScripture({ endVerse: v })} />
                <TextInput style={[styles.input, styles.scriptureSmall]} placeholder="NIV" placeholderTextColor={colors.textMuted} value={lessonEditor?.form.scripture.translation} onChangeText={(v) => updateScripture({ translation: v })} />
              </View>

              <Text style={styles.fieldLabel}>Teaching / Study Material</Text>
              <TextInput style={[styles.input, { minHeight: 90 }]} value={lessonEditor?.form.teachingMaterial} onChangeText={(v) => updateLessonForm({ teachingMaterial: v })} multiline placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Discussion Questions</Text>
              {lessonEditor?.form.questions.map((q, i) => (
                <View key={i} style={styles.questionRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={q} onChangeText={(v) => updateQuestion(i, v)} placeholder={`Question ${i + 1}`} placeholderTextColor={colors.textMuted} />
                  <TouchableOpacity onPress={() => removeQuestionField(i)} accessibilityLabel="Remove question"><Ionicons name="close-circle" size={20} color={colors.textMuted} /></TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.addQuestionBtn} onPress={addQuestionField}>
                <Ionicons name="add" size={14} color={colors.accentGreen} />
                <Text style={styles.addQuestionText}>Add question</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Prayer Focus (optional)</Text>
              <TextInput style={[styles.input, { minHeight: 50 }]} value={lessonEditor?.form.prayerFocus} onChangeText={(v) => updateLessonForm({ prayerFocus: v })} multiline placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Media — YouTube video ID (optional)</Text>
              <TextInput style={styles.input} value={lessonEditor?.form.mediaId} onChangeText={(v) => updateLessonForm({ mediaId: v })} placeholderTextColor={colors.textMuted} autoCapitalize="none" />

              <View style={styles.sheetRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setLessonEditor(null)} disabled={savingLesson}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSaveLesson} disabled={savingLesson || !lessonEditor?.form.title.trim()}>
                  {savingLesson ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save Lesson</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, marginBottom: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  description: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", marginBottom: 14, lineHeight: 19 },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 },
  statusChip: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.card },
  statusChipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  statusChipText: { fontSize: 12, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  statusChipTextActive: { color: "#fff" },
  archiveBtn: { marginLeft: "auto", padding: 6 },
  archivedNotice: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium", marginBottom: 14, fontStyle: "italic" },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sectionLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.accentGreen, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  createBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  lessonCard: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card,
    borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 8,
  },
  lessonNumber: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_700Bold", width: 20 },
  lessonTitle: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  lessonMeta: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 3 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  lessonSheetBox: { maxHeight: "88%" },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 10 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular", marginTop: 6,
  },
  scriptureRow: { flexDirection: "row", gap: 8 },
  scriptureBook: { flex: 2 },
  scriptureSmall: { flex: 1 },
  questionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  addQuestionBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, alignSelf: "flex-start" },
  addQuestionText: { color: colors.accentGreen, fontSize: 12, fontFamily: "Inter_700Bold" },
  sheetRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { color: colors.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
  saveBtn: { flex: 1, backgroundColor: colors.primaryGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
});
