import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { getFamilyDetail } from "@/lib/familyApi";
import LessonPicker from "@/components/family/LessonPicker";
import { communityStudyPlanApi, type CommunityScope, type CommunityStudyPlanBase, type CommunityStudyPlanDetail } from "@/lib/communityStudyApi";
import { setFamilyStudySource } from "@/lib/familyStudyPlanApi";

import { useSheetWidth } from "@/hooks/useLayout";
import { AppButton, IconButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", published: "Published", archived: "Archived" };

// A Custom Study Plan of a Family Circle or Church — the shared screen behind
// app/family/study-plans/[planId].tsx and app/church/study-plans/[planId].tsx.
// A plan is an ORDERED ARRANGEMENT of EXISTING p2p_lessons — it never authors
// lesson content (that's the community's Studies, components/community/
// CommunityStudyScreen). Adding a lesson reuses the read-only lesson browser
// Gatherings use (components/family/LessonPicker.tsx); a lesson row opens the
// real Study Workspace (app/lesson/[id].tsx). "done" reflects the community's
// own coverage, not one member's personal progress.
// What differs by community is explicit: who may manage (Church — church
// leadership; Family — that family's Shepherd / Co-Shepherd) and, for a
// family, choosing the plan its Gatherings follow ("Set as Active Study
// Plan"). The server enforces every rule regardless of what is shown.
type PlanRecord = CommunityStudyPlanBase & { familyId?: string; churchId?: string };

export default function CommunityStudyPlanScreen({ scope }: { scope: CommunityScope }) {
  const sheetWidth = useSheetWidth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { planId, familyId } = useLocalSearchParams<{ planId: string; familyId?: string }>();
  const { profile } = useAuth();
  const { isChurchLeader } = useData();
  const api = useMemo(() => communityStudyPlanApi<PlanRecord>(scope), [scope]);

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CommunityStudyPlanDetail<PlanRecord> | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [isActivePlan, setIsActivePlan] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    try {
      const planDetail = await api.getPlan(planId);
      setDetail(planDetail);
      const fid = familyId ?? planDetail.plan.familyId;
      if (scope === "church") {
        setCanManage(isChurchLeader);
      } else if (fid) {
        const fam = await getFamilyDetail(fid);
        const myMembership = fam.members.find((m) => m.userId === profile?.id);
        setCanManage(fam.family.shepherdId === profile?.id || myMembership?.role === "co_shepherd");
        setIsActivePlan(fam.family.activeStudyPlanId === planDetail.plan.id);
      }
    } catch (e: any) {
      showAlert("Couldn't load this Custom Study Plan", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [api, scope, planId, familyId, profile?.id, isChurchLeader]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const manageable = canManage && detail?.plan.status !== "archived";

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
      await api.updatePlan(planId, { title: title.trim(), description: description.trim() || null });
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
      await api.addLesson(planId, lessonId);
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
      await api.removeLesson(planId, itemId);
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
      await api.reorder(planId, items.map((i) => i.itemId));
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
      await api.publishPlan(planId);
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
      await api.archivePlan(planId);
      await load();
    } catch (e: any) {
      showAlert("Couldn't archive this plan", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetActive() {
    const fid = familyId ?? detail?.plan.familyId;
    if (scope !== "family" || !fid || !planId) return;
    setBusy(true);
    try {
      await setFamilyStudySource(fid, { studySource: "custom_study_plan", activeStudyPlanId: planId });
      setIsActivePlan(true);
      showAlert("Study source updated", "This plan is now this Family Circle's active Custom Study Plan.");
    } catch (e: any) {
      showAlert("Couldn't set this as the active plan", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function openLesson(lessonId: string) {
    router.push({ pathname: "/lesson/[id]", params: { id: lessonId } } as any);
  }

  if (loading && !detail) {
    return <><Stack.Screen options={{ headerShown: false }} /><View style={[styles.container, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View></>;
  }
  if (!detail) {
    return <><Stack.Screen options={{ headerShown: false }} /><View style={[styles.container, styles.centerFill]}><Text style={styles.emptyText}>This Custom Study Plan is not available.</Text></View></>;
  }

  const { plan, items, progress } = detail;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <IconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="Back" color={c.textDark} />
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">{plan.title}</Text>
        {manageable
          ? <IconButton icon="create-outline" onPress={openEdit} accessibilityLabel="Edit plan" color={c.textDark} />
          : <View style={{ width: 44 }} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {plan.status !== "published" && (
            <Text style={[styles.statusPill, plan.status === "archived" && styles.statusPillArchived]}>{STATUS_LABEL[plan.status]}</Text>
          )}
          {isActivePlan && <Text style={styles.activePill}>Active Study Source</Text>}
        </View>
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
          {manageable && (
            <AppButton label="Add Lesson" onPress={() => setPickerOpen(true)} size="sm" icon="add" disabled={busy} />
          )}
        </View>

        {items.length === 0 ? (
          <Text style={styles.emptyText}>{manageable ? "No lessons yet. Add one above." : "This plan has no lessons yet."}</Text>
        ) : (
          items.map((item, index) => {
            const isCurrent = item.itemId === progress.currentItemId;
            return (
              <View key={item.itemId} style={styles.lessonRow}>
                <TouchableOpacity accessibilityRole="button" style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }} onPress={() => openLesson(item.lessonId)}>
                  <Text style={styles.lessonNumber}>{String(index + 1).padStart(2, "0")}</Text>
                  <Text style={styles.lessonTitle} numberOfLines={2}>{item.lessonTitle}</Text>
                  {item.done ? (
                    <Ionicons name="checkmark-circle" size={18} color={c.accentGreen} />
                  ) : isCurrent ? (
                    <Ionicons name="arrow-forward-circle" size={18} color={c.primaryGreen} />
                  ) : null}
                </TouchableOpacity>
                {manageable && (
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <TouchableOpacity accessibilityRole="button" hitSlop={10} onPress={() => handleMove(index, -1)} disabled={busy || index === 0} accessibilityLabel="Move up">
                      <Ionicons name="chevron-up" size={18} color={index === 0 ? c.borderBeige : c.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" hitSlop={10} onPress={() => handleMove(index, 1)} disabled={busy || index === items.length - 1} accessibilityLabel="Move down">
                      <Ionicons name="chevron-down" size={18} color={index === items.length - 1 ? c.borderBeige : c.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" hitSlop={10} onPress={() => handleRemove(item.itemId)} disabled={busy} accessibilityLabel="Remove lesson">
                      <Ionicons name="close-circle-outline" size={18} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}

        {items.length > 0 && (
          <AppButton label={progress.currentItemId ? "Continue Study" : "Review Study"} onPress={() => openLesson((items.find((i) => i.itemId === progress.currentItemId) ?? items[0]).lessonId)} style={{ marginTop: 6, marginBottom: 12 }} />
        )}

        {scope === "family" && manageable && plan.status === "published" && !isActivePlan && (
          <AppButton label="Set as Active Study Plan" onPress={handleSetActive} variant="outline" disabled={busy} style={{ marginBottom: 12 }} />
        )}

        {manageable && (
          <View style={styles.manageRow}>
            {plan.status === "draft" && (
              <AppButton label="Publish" onPress={handlePublish} disabled={busy} style={{ flex: 1 }} />
            )}
            {plan.status !== "archived" && (
              <AppButton label="Archive" onPress={handleArchive} variant="outline" disabled={busy} style={{ flex: 1 }} />
            )}
          </View>
        )}
      </ScrollView>

      <LessonPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(lessonId) => handlePickLesson(lessonId)} />

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, sheetWidth, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Edit Custom Study Plan</Text>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholderTextColor={c.textMuted} />
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={description} onChangeText={setDescription} multiline placeholderTextColor={c.textMuted} />
            <View style={styles.sheetRow}>
              <AppButton label="Cancel" onPress={() => setEditOpen(false)} variant="outline" disabled={busy} style={{ flex: 1 }} />
              <AppButton label="Save" onPress={handleSaveEdit} disabled={busy || !title.trim()} loading={busy} style={{ flex: 1 }} />
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
    centerFill: { alignItems: "center", justifyContent: "center", flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, marginBottom: 12, gap: 6 },
    headerTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    description: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", marginBottom: 14, lineHeight: 19, marginTop: 8 },
    progressRow: { marginBottom: 18 },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.progressTrack, overflow: "hidden" },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: c.accentGreen },
    progressText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 6 },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    sectionLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    lessonRow: {
      flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card,
      borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, padding: 12, marginBottom: 8,
    },
    lessonNumber: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold", width: 22 },
    lessonTitle: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    manageRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
    statusPill: {
      alignSelf: "flex-start", marginBottom: 6, fontSize: 10, fontFamily: "Inter_700Bold", color: c.accentGreen,
      backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
    },
    statusPillArchived: { color: c.textMuted, backgroundColor: "rgba(0,0,0,0.06)" },
    activePill: {
      alignSelf: "flex-start", marginBottom: 6, fontSize: 10, fontFamily: "Inter_700Bold", color: c.primaryGreen,
      backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
    },
    sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheetBox: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, width: "100%", alignSelf: "center" },
    sheetTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    fieldLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 4 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular",
    },
    sheetRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  });
}
