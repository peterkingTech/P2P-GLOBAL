import React, { useCallback, useState } from "react";
import CustomLessonSection from "@/components/study/CustomLessonSection";
import type { CustomLesson, LessonApi } from "@/lib/customLessonModel";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import FamilyIcon from "@/components/family/FamilyIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { getFamilyDetail } from "@/lib/familyApi";
import {
  getFamilyStudy, updateFamilyStudy, archiveFamilyStudy, addFamilyStudyLesson, updateFamilyStudyLesson, removeFamilyStudyLesson, setFamilyStudyLessonStatus,
  type FamilyStudy, type FamilyStudyLesson, type CustomStudyStatus,
} from "@/lib/familyStudyApi";

import { useSheetWidth } from "@/hooks/useLayout";
function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
function confirmAction(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) onConfirm(); }
  else Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Continue", style: "destructive", onPress: onConfirm }]);
}



// Mirrors app/church/studies/[studyId].tsx exactly, scoped to Family
// authorization (Shepherd/Co-Shepherd) instead of church leadership.
export default function FamilyStudyDetailScreen() {
  const sheetWidth = useSheetWidth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { studyId, familyId } = useLocalSearchParams<{ studyId: string; familyId: string }>();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [study, setStudy] = useState<FamilyStudy | null>(null);
  const [lessons, setLessons] = useState<FamilyStudyLesson[]>([]);
  const [savingStatus, setSavingStatus] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);


  const load = useCallback(async () => {
    if (!studyId) return;
    setLoading(true);
    try {
      const { study: s, lessons: l } = await getFamilyStudy(studyId);
      setStudy(s);
      setLessons(l);
      if (familyId) {
        const detail = await getFamilyDetail(familyId);
        const myMembership = detail.members.find((m) => m.userId === profile?.id);
        setCanManage(detail.family.shepherdId === profile?.id || myMembership?.role === "co_shepherd");
      }
    } catch (e: any) {
      showAlert("Couldn't load this Study", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [studyId, familyId, profile?.id]);

  // Lesson authoring goes through the shared section (components/study/
  // CustomLessonSection.tsx); this adapter points it at this scope's API.
  const lessonApi: LessonApi = {
    add: (input) => addFamilyStudyLesson(studyId as string, input as any) as Promise<CustomLesson>,
    update: (lessonId, input) => updateFamilyStudyLesson(studyId as string, lessonId, input as any) as Promise<CustomLesson>,
    setStatus: (lessonId, status) => setFamilyStudyLessonStatus(studyId as string, lessonId, status) as Promise<CustomLesson>,
    remove: (lessonId) => removeFamilyStudyLesson(studyId as string, lessonId),
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleChangeStatus(status: CustomStudyStatus) {
    if (!study) return;
    setSavingStatus(true);
    try {
      setStudy(await updateFamilyStudy(study.id, { status }));
    } catch (e: any) {
      showAlert("Couldn't update the study", e.message ?? "Please try again.");
    } finally {
      setSavingStatus(false);
    }
  }

  function handleArchive() {
    if (!study) return;
    confirmAction("Archive this Study?", "It will no longer be shown to people in this Family Circle. This can be reviewed later.", async () => {
      try {
        setStudy(await archiveFamilyStudy(study.id));
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
      setStudy(await updateFamilyStudy(study.id, { title: editTitle.trim(), description: editDescription.trim() || null }));
      setEditOpen(false);
    } catch (e: any) {
      showAlert("Couldn't save changes", e.message ?? "Please try again.");
    } finally {
      setSavingEdit(false);
    }
  }


  if (loading) {
    return <View style={[styles.container, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  }
  if (!study) {
    return <View style={[styles.container, styles.centerFill]}><Text style={styles.emptyText}>This study is not available.</Text></View>;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{study.title}</Text>
        {canManage ? (
          <TouchableOpacity onPress={openEditStudy} accessibilityLabel="Edit study" accessibilityRole="button">
            <Ionicons name="create-outline" size={20} color={c.textDark} />
          </TouchableOpacity>
        ) : <View style={{ width: 20 }} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        {!!study.description && <Text style={styles.description}>{study.description}</Text>}

        {canManage && (
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
                <Ionicons name="archive-outline" size={16} color={c.textMuted} />
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
          onOpen={(lesson) => router.push({ pathname: "/family/studies/lesson/[lessonId]", params: { lessonId: lesson.id, studyId: study.id } } as any)}
        />
      </ScrollView>

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, sheetWidth, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Edit Study</Text>
            <Text style={styles.fieldLabel}>Study Title</Text>
            <TextInput style={styles.input} value={editTitle} onChangeText={setEditTitle} placeholderTextColor={c.textMuted} />
            <Text style={styles.fieldLabel}>Study Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={editDescription} onChangeText={setEditDescription} multiline placeholderTextColor={c.textMuted} />
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

    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, marginBottom: 8 },
    title: { flex: 1, fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    description: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", marginBottom: 14, lineHeight: 19 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 },
    statusChip: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: c.card },
    statusChipActive: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    statusChipText: { fontSize: 12, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    statusChipTextActive: { color: "#fff" },
    archiveBtn: { marginLeft: "auto", padding: 6 },
    archivedNotice: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium", marginBottom: 14, fontStyle: "italic" },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    sectionLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    createBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.accentGreen, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
    createBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
    lessonCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 8 },
    lessonNumber: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold", width: 20 },
    lessonTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    lessonMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
    lessonMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheetBox: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, width: "100%", alignSelf: "center" },
    lessonSheetBox: { maxHeight: "88%" },
    sheetTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    fieldLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 10 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 6,
    },
    scriptureRow: { flexDirection: "row", gap: 8 },
    scriptureBook: { flex: 2 },
    scriptureSmall: { flex: 1 },
    questionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
    addQuestionBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, alignSelf: "flex-start" },
    addQuestionText: { color: c.accentGreen, fontSize: 12, fontFamily: "Inter_700Bold" },
    sheetRow: { flexDirection: "row", gap: 10, marginTop: 16 },
    cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    cancelBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
    saveBtn: { flex: 1, backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
