import React, { useCallback, useState } from "react";
import CustomLessonSection from "@/components/study/CustomLessonSection";
import type { CustomLesson, LessonApi } from "@/lib/customLessonModel";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import {
  getChurchStudy, updateChurchStudy, archiveChurchStudy, addChurchStudyLesson, updateChurchStudyLesson, removeChurchStudyLesson, setChurchStudyLessonStatus,
  type ChurchStudy, type ChurchStudyLesson, type CustomStudyStatus,
} from "@/lib/churchStudyApi";

import { useSheetWidth } from "@/hooks/useLayout";
import { AppButton } from "@/components/ui";
function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
function confirmAction(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) onConfirm(); }
  else Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Continue", style: "destructive", onPress: onConfirm }]);
}

// Church custom study: lessons are authored through the shared
// CustomLessonSection / CustomLessonEditor (also used by Family studies).
export default function ChurchStudyDetailScreen() {
  const sheetWidth = useSheetWidth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { studyId } = useLocalSearchParams<{ studyId: string }>();
  const { isChurchLeader } = useData();

  const [loading, setLoading] = useState(true);
  const [study, setStudy] = useState<ChurchStudy | null>(null);
  const [lessons, setLessons] = useState<ChurchStudyLesson[]>([]);
  const [savingStatus, setSavingStatus] = useState(false);
  // Leadership of THIS study's church, as the server decided it (a person may
  // belong to several churches; isChurchLeader describes the current one).
  const [canManage, setCanManage] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);


  const load = useCallback(async () => {
    if (!studyId) return;
    setLoading(true);
    try {
      const { study: s, lessons: l, canManage: manage } = await getChurchStudy(studyId);
      setStudy(s);
      setLessons(l);
      setCanManage(manage ?? isChurchLeader);
    } catch (e: any) {
      showAlert("Couldn't load this Study", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [studyId, isChurchLeader]);

  // Lesson authoring goes through the shared section (components/study/
  // CustomLessonSection.tsx); this adapter points it at this scope's API.
  const lessonApi: LessonApi = {
    add: (input) => addChurchStudyLesson(studyId as string, input as any) as Promise<CustomLesson>,
    update: (lessonId, input) => updateChurchStudyLesson(studyId as string, lessonId, input as any) as Promise<CustomLesson>,
    setStatus: (lessonId, status) => setChurchStudyLessonStatus(studyId as string, lessonId, status) as Promise<CustomLesson>,
    remove: (lessonId) => removeChurchStudyLesson(studyId as string, lessonId),
  };

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


  if (loading) {
    return <View style={[styles.container, styles.centerFill]}><ActivityIndicator color={colors.accentGreen} /></View>;
  }
  if (!study) {
    return <View style={[styles.container, styles.centerFill]}><Text style={styles.emptyText}>This study is not available.</Text></View>;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={10} onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{study.title}</Text>
        {canManage ? (
          <TouchableOpacity hitSlop={10} onPress={openEditStudy} accessibilityLabel="Edit study" accessibilityRole="button">
            <Ionicons name="create-outline" size={20} color={colors.textDark} />
          </TouchableOpacity>
        ) : <View style={{ width: 20 }} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        {!!study.description && <Text style={styles.description}>{study.description}</Text>}

        {canManage && (
          <View style={styles.statusRow}>
            {(["draft", "published"] as CustomStudyStatus[]).map((s) => (
              <TouchableOpacity accessibilityRole="button"
                key={s} disabled={savingStatus || study.status === "archived"}
                style={[styles.statusChip, study.status === s && styles.statusChipActive]}
                onPress={() => handleChangeStatus(s)}
              >
                <Text style={[styles.statusChipText, study.status === s && styles.statusChipTextActive]}>{s === "draft" ? "Draft" : "Published"}</Text>
              </TouchableOpacity>
            ))}
            {study.status !== "archived" && (
              <TouchableOpacity accessibilityRole="button" hitSlop={10} style={styles.archiveBtn} onPress={handleArchive} accessibilityLabel="Archive study">
                <Ionicons name="archive-outline" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}
        {study.status === "archived" && <Text style={styles.archivedNotice}>This study is archived.</Text>}

        <CustomLessonSection
          lessons={lessons}
          onLessonsChange={setLessons}
          canManage={canManage}
          api={lessonApi}
          onOpen={(lesson) => router.push({ pathname: "/church/studies/lesson/[lessonId]", params: { lessonId: lesson.id, studyId: study.id } } as any)}
        />
      </ScrollView>

      {/* Edit study title/description */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, sheetWidth, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Edit Study</Text>
            <Text style={styles.fieldLabel}>Study Title</Text>
            <TextInput style={styles.input} value={editTitle} onChangeText={setEditTitle} placeholderTextColor={colors.textMuted} />
            <Text style={styles.fieldLabel}>Study Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={editDescription} onChangeText={setEditDescription} multiline placeholderTextColor={colors.textMuted} />
            <View style={styles.sheetRow}>
              <AppButton label="Cancel" onPress={() => setEditOpen(false)} variant="outline" disabled={savingEdit} style={{ flex: 1 }} palette="fixedLight" />
              <AppButton label="Save" onPress={handleSaveEdit} disabled={savingEdit || !editTitle.trim()} loading={savingEdit} style={{ flex: 1 }} palette="fixedLight" />
            </View>
          </View>
        </View>
      </Modal>

      {/* Lesson editor */}
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
  lessonCard: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card,
    borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 8,
  },
  lessonNumber: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_700Bold", width: 20 },
  lessonTitle: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  lessonMeta: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 3 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, width: "100%", alignSelf: "center" },
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
  addQuestionText: { color: colors.accentGreen, fontSize: 12, fontFamily: "Inter_700Bold" },
  sheetRow: { flexDirection: "row", gap: 10, marginTop: 16 },
});
