import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import LessonPicker from "@/components/family/LessonPicker";
import {
  getChurchStudyPlan, updateChurchStudyPlan, publishChurchStudyPlan, archiveChurchStudyPlan,
  addChurchStudyPlanLesson, removeChurchStudyPlanLesson, reorderChurchStudyPlan,
  type ChurchStudyPlanDetail,
} from "@/lib/churchStudyPlanApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const STATUS_LABEL: Record<string, string> = { draft: "Draft", published: "Published", archived: "Archived" };

// A Custom Study Plan is an ORDERED ARRANGEMENT of EXISTING p2p_lessons —
// this screen never authors lesson content (that's Church Studies, a
// different feature — see app/church/studies/[studyId].tsx). Adding a
// lesson reuses the exact same read-only lesson browser
// (components/family/LessonPicker.tsx) Family Gathering already uses;
// selecting a lesson row here opens the real, existing Study Workspace
// (app/lesson/[id].tsx) — no second lesson renderer, no second progress
// table.
export default function ChurchStudyPlanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { isChurchLeader } = useData();

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ChurchStudyPlanDetail | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    try {
      setDetail(await getChurchStudyPlan(planId));
    } catch (e: any) {
      showAlert("Couldn't load this Custom Study Plan", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const canManage = isChurchLeader && detail?.plan.status !== "archived";

  function openEdit() {
    if (!detail) return;
    setTitle(detail.plan.title);
    setDescription(detail.plan.description ?? "");
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    if (!planId || !title.trim()) return;
    setBusy(true);
    try {
      await updateChurchStudyPlan(planId, { title: title.trim(), description: description.trim() || null });
      setEditOpen(false);
      await load();
    } catch (e: any) {
      showAlert("Couldn't save changes", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePickLesson(lessonId: string) {
    if (!planId) return;
    setPickerOpen(false);
    setBusy(true);
    try {
      await addChurchStudyPlanLesson(planId, lessonId);
      await load();
    } catch (e: any) {
      showAlert("Couldn't add that lesson", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(itemId: string) {
    if (!planId) return;
    setBusy(true);
    try {
      await removeChurchStudyPlanLesson(planId, itemId);
      await load();
    } catch (e: any) {
      showAlert("Couldn't remove that lesson", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    if (!planId || !detail) return;
    const items = [...detail.items];
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    setBusy(true);
    try {
      await reorderChurchStudyPlan(planId, items.map((i) => i.itemId));
      await load();
    } catch (e: any) {
      showAlert("Couldn't reorder the plan", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!planId) return;
    setBusy(true);
    try {
      await publishChurchStudyPlan(planId);
      await load();
    } catch (e: any) {
      showAlert("Couldn't publish this plan", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!planId) return;
    setBusy(true);
    try {
      await archiveChurchStudyPlan(planId);
      await load();
    } catch (e: any) {
      showAlert("Couldn't archive this plan", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function openLesson(lessonId: string) {
    router.push({ pathname: "/lesson/[id]", params: { id: lessonId } } as any);
  }

  if (loading && !detail) {
    return <View style={[styles.container, styles.centerFill]}><ActivityIndicator color={colors.accentGreen} /></View>;
  }
  if (!detail) {
    return <View style={[styles.container, styles.centerFill]}><Text style={styles.emptyText}>This Custom Study Plan is not available.</Text></View>;
  }

  const { plan, items, progress } = detail;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{plan.title}</Text>
        {canManage ? (
          <TouchableOpacity onPress={openEdit} accessibilityLabel="Edit plan" accessibilityRole="button">
            <Ionicons name="create-outline" size={20} color={colors.textDark} />
          </TouchableOpacity>
        ) : <View style={{ width: 20 }} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        {plan.status !== "published" && (
          <Text style={[styles.statusPill, plan.status === "archived" && styles.statusPillArchived]}>{STATUS_LABEL[plan.status]}</Text>
        )}
        {!!plan.description && <Text style={styles.description}>{plan.description}</Text>}

        {items.length > 0 && (
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${items.length ? (progress.completed / items.length) * 100 : 0}%` }]} />
            </View>
            <Text style={styles.progressText}>Progress: {progress.completed} of {items.length}</Text>
          </View>
        )}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>LESSONS</Text>
          {canManage && (
            <TouchableOpacity style={styles.createBtn} onPress={() => setPickerOpen(true)} disabled={busy}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.createBtnText}>Add Lesson</Text>
            </TouchableOpacity>
          )}
        </View>

        {items.length === 0 ? (
          <Text style={styles.emptyText}>{canManage ? "No lessons yet. Add one above." : "This plan has no lessons yet."}</Text>
        ) : (
          items.map((item, index) => {
            const isCurrent = item.itemId === progress.currentItemId;
            return (
              <View key={item.itemId} style={styles.lessonRow}>
                <TouchableOpacity style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }} onPress={() => openLesson(item.lessonId)}>
                  <Text style={styles.lessonNumber}>{String(index + 1).padStart(2, "0")}</Text>
                  <Text style={styles.lessonTitle} numberOfLines={2}>{item.lessonTitle}</Text>
                  {item.done ? (
                    <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />
                  ) : isCurrent ? (
                    <Ionicons name="arrow-forward-circle" size={18} color={colors.primaryGreen} />
                  ) : null}
                </TouchableOpacity>
                {canManage && (
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <TouchableOpacity onPress={() => handleMove(index, -1)} disabled={busy || index === 0} accessibilityLabel="Move up">
                      <Ionicons name="chevron-up" size={18} color={index === 0 ? colors.borderBeige : colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleMove(index, 1)} disabled={busy || index === items.length - 1} accessibilityLabel="Move down">
                      <Ionicons name="chevron-down" size={18} color={index === items.length - 1 ? colors.borderBeige : colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleRemove(item.itemId)} disabled={busy} accessibilityLabel="Remove lesson">
                      <Ionicons name="close-circle-outline" size={18} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}

        {items.length > 0 && (
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={() => openLesson((items.find((i) => i.itemId === progress.currentItemId) ?? items[0]).lessonId)}
          >
            <Text style={styles.continueBtnText}>{progress.currentItemId ? "Continue Study" : "Review Study"}</Text>
          </TouchableOpacity>
        )}

        {canManage && (
          <View style={styles.manageRow}>
            {plan.status === "draft" && (
              <TouchableOpacity style={styles.publishBtn} onPress={handlePublish} disabled={busy}>
                <Text style={styles.publishBtnText}>Publish</Text>
              </TouchableOpacity>
            )}
            {plan.status !== "archived" && (
              <TouchableOpacity style={styles.archiveBtn} onPress={handleArchive} disabled={busy}>
                <Text style={styles.archiveBtnText}>Archive</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      <LessonPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(lessonId) => handlePickLesson(lessonId)} />

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Edit Custom Study Plan</Text>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholderTextColor={colors.textMuted} />
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={description} onChangeText={setDescription} multiline placeholderTextColor={colors.textMuted} />
            <View style={styles.sheetRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditOpen(false)} disabled={busy}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEdit} disabled={busy || !title.trim()}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { alignItems: "center", justifyContent: "center", flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12, gap: 10 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  description: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", marginBottom: 14, lineHeight: 19 },
  progressRow: { marginBottom: 18 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.progressTrack, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.accentGreen },
  progressText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium", marginTop: 6 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sectionLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.accentGreen, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  createBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  lessonRow: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card,
    borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 12, marginBottom: 8,
  },
  lessonNumber: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_700Bold", width: 22 },
  lessonTitle: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_500Medium" },
  continueBtn: { backgroundColor: colors.primaryGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 6, marginBottom: 18 },
  continueBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  manageRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  publishBtn: { flex: 1, backgroundColor: colors.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  publishBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  archiveBtn: { flex: 1, borderWidth: 1.5, borderColor: "#DC2626", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  archiveBtnText: { color: "#DC2626", fontSize: 13, fontFamily: "Inter_700Bold" },
  statusPill: {
    alignSelf: "flex-start", marginBottom: 10, fontSize: 10, fontFamily: "Inter_700Bold", color: colors.accentGreen,
    backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
  },
  statusPillArchived: { color: colors.textMuted, backgroundColor: "rgba(0,0,0,0.06)" },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular",
  },
  sheetRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { color: colors.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
  saveBtn: { flex: 1, backgroundColor: colors.primaryGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
});
