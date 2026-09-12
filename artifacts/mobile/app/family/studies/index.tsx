import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Alert, Platform } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { getFamilyDetail } from "@/lib/familyApi";
import { getFamilyStudies, createFamilyStudy, type FamilyStudy } from "@/lib/familyStudyApi";
import {
  getFamilyStudyPlans, createFamilyStudyPlan, setFamilyStudySource,
  type FamilyStudyPlan, type FamilyStudySource,
} from "@/lib/familyStudyPlanApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const STATUS_LABEL: Record<string, string> = { draft: "Draft", published: "Published", archived: "Archived" };

// Study — three sources shown here, kept clearly distinct (Phase 0 forensic
// report, section L): P2P Curriculum & Plans (always available, always
// default), Family Studies (this family authors its own brand-new lesson
// content), and Custom Study Plans (this family arranges EXISTING p2p_lessons
// into a purposeful order — never authors new lesson content, never
// duplicates progress). Creating either is gated on Shepherd/Co-Shepherd —
// there is no individual/peer-to-peer "Create Custom Study(/Plan)" anywhere.
export default function FamilyStudiesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [studies, setStudies] = useState<FamilyStudy[]>([]);
  const [plans, setPlans] = useState<FamilyStudyPlan[]>([]);
  const [studySource, setStudySource] = useState<FamilyStudySource>("p2p_curriculum");
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoading(true);
    try {
      const [detail, list, planList] = await Promise.all([
        getFamilyDetail(familyId), getFamilyStudies(familyId), getFamilyStudyPlans(familyId),
      ]);
      const myMembership = detail.members.find((m) => m.userId === profile?.id);
      setCanManage(detail.family.shepherdId === profile?.id || myMembership?.role === "co_shepherd");
      setStudies(list);
      setPlans(planList);
      setStudySource(detail.family.studySource);
    } catch (e: any) {
      showAlert("Couldn't load Family Studies", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [familyId, profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleCreate() {
    if (!familyId || !title.trim()) return;
    setCreating(true);
    try {
      const study = await createFamilyStudy(familyId, title.trim(), description.trim() || undefined);
      setCreateOpen(false);
      setTitle("");
      setDescription("");
      router.push({ pathname: "/family/studies/[studyId]", params: { studyId: study.id, familyId } } as any);
    } catch (e: any) {
      showAlert("Couldn't create the study", e.message ?? "Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreatePlan() {
    if (!familyId || !title.trim()) return;
    setCreating(true);
    try {
      const plan = await createFamilyStudyPlan(familyId, title.trim(), description.trim() || undefined);
      setCreatePlanOpen(false);
      setTitle("");
      setDescription("");
      router.push({ pathname: "/family/study-plans/[planId]", params: { planId: plan.id, familyId } } as any);
    } catch (e: any) {
      showAlert("Couldn't create the study plan", e.message ?? "Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleChooseSource(next: FamilyStudySource) {
    if (!familyId || next === studySource) { setSourceSheetOpen(false); return; }
    try {
      await setFamilyStudySource(familyId, { studySource: next });
      setStudySource(next);
      setSourceSheetOpen(false);
    } catch (e: any) {
      showAlert("Couldn't change the study source", e.message ?? "Please try again.");
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Stack.Screen options={{ title: "Study", headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Study</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <TouchableOpacity style={styles.p2pCard} onPress={() => router.push("/curriculum" as any)}>
          <View style={styles.p2pIconWrap}><Ionicons name="book" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.p2pTitle}>P2P Curriculum & Plans</Text>
            <Text style={styles.p2pSub}>Official discipleship curriculum · Kingdom School</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </TouchableOpacity>

        {canManage && (
          <TouchableOpacity style={styles.sourceCard} onPress={() => setSourceSheetOpen(true)} accessibilityRole="button" accessibilityLabel="Change study source">
            <View style={{ flex: 1 }}>
              <Text style={styles.sourceLabel}>STUDY SOURCE</Text>
              <Text style={styles.sourceValue}>{studySource === "custom_study_plan" ? "Custom Study Plan" : "P2P Curriculum"}</Text>
            </View>
            <Ionicons name="swap-horizontal" size={18} color={c.accentGreen} />
          </TouchableOpacity>
        )}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>CUSTOM STUDY PLANS</Text>
          {canManage && (
            <TouchableOpacity style={styles.createBtn} onPress={() => setCreatePlanOpen(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.createBtnText}>Create Plan</Text>
            </TouchableOpacity>
          )}
        </View>
        {loading ? null : plans.length === 0 ? (
          <Text style={styles.emptyText}>{canManage ? "No Custom Study Plans yet. Create one above." : "No Custom Study Plans have been published yet."}</Text>
        ) : (
          plans.map((p) => (
            <TouchableOpacity
              key={p.id} style={styles.studyCard}
              onPress={() => router.push({ pathname: "/family/study-plans/[planId]", params: { planId: p.id, familyId } } as any)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.studyTitle}>{p.title}</Text>
                {!!p.description && <Text style={styles.studySub} numberOfLines={2}>{p.description}</Text>}
                {canManage && p.status !== "published" && (
                  <Text style={[styles.statusPill, p.status === "archived" && styles.statusPillArchived]}>{STATUS_LABEL[p.status]}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ))
        )}

        <View style={[styles.sectionRow, { marginTop: 18 }]}>
          <Text style={styles.sectionLabel}>FAMILY STUDIES</Text>
          {canManage && (
            <TouchableOpacity style={styles.createBtn} onPress={() => setCreateOpen(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.createBtnText}>Create Study</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
        ) : studies.length === 0 ? (
          <Text style={styles.emptyText}>{canManage ? "No Family Studies yet. Create one above." : "No Family Studies have been published yet."}</Text>
        ) : (
          studies.map((s) => (
            <TouchableOpacity
              key={s.id} style={styles.studyCard}
              onPress={() => router.push({ pathname: "/family/studies/[studyId]", params: { studyId: s.id, familyId } } as any)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.studyTitle}>{s.title}</Text>
                {!!s.description && <Text style={styles.studySub} numberOfLines={2}>{s.description}</Text>}
                {canManage && s.status !== "published" && (
                  <Text style={[styles.statusPill, s.status === "archived" && styles.statusPillArchived]}>{STATUS_LABEL[s.status]}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Create Family Study</Text>
            <Text style={styles.fieldLabel}>Study Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. The Book of Romans" placeholderTextColor={c.textMuted} />
            <Text style={styles.fieldLabel}>Study Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={description} onChangeText={setDescription} multiline placeholder="What is this study about? (optional)" placeholderTextColor={c.textMuted} />
            <View style={styles.sheetRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setCreateOpen(false)} disabled={creating}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCreate} disabled={creating || !title.trim()}>
                {creating ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={createPlanOpen} transparent animationType="slide" onRequestClose={() => setCreatePlanOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Create Custom Study Plan</Text>
            <Text style={styles.fieldLabel}>Plan Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Foundations of Faith" placeholderTextColor={c.textMuted} />
            <Text style={styles.fieldLabel}>Plan Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={description} onChangeText={setDescription} multiline placeholder="What is this plan about? (optional)" placeholderTextColor={c.textMuted} />
            <View style={styles.sheetRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setCreatePlanOpen(false)} disabled={creating}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCreatePlan} disabled={creating || !title.trim()}>
                {creating ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={sourceSheetOpen} transparent animationType="slide" onRequestClose={() => setSourceSheetOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Study Source</Text>
            <Text style={styles.fieldLabel}>Choose what Family Study uses for this family. This does not change what's already been studied.</Text>
            <TouchableOpacity style={styles.sourceOption} onPress={() => handleChooseSource("p2p_curriculum")}>
              <Ionicons name={studySource === "p2p_curriculum" ? "radio-button-on" : "radio-button-off"} size={20} color={c.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceOptionTitle}>P2P Curriculum</Text>
                <Text style={styles.sourceOptionSub}>Official discipleship curriculum · default</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sourceOption} onPress={() => handleChooseSource("custom_study_plan")}>
              <Ionicons name={studySource === "custom_study_plan" ? "radio-button-on" : "radio-button-off"} size={20} color={c.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceOptionTitle}>Custom Study Plan</Text>
                <Text style={styles.sourceOptionSub}>
                  {plans.some((p) => p.status === "published") ? "Open a published plan below and set it active" : "Publish a Custom Study Plan first"}
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSourceSheetOpen(false)}>
              <Text style={styles.cancelBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center", paddingVertical: 24 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    p2pCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.primaryGreen, borderRadius: 14, padding: 14, marginBottom: 18 },
    p2pIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
    p2pTitle: { fontSize: 15, color: "#fff", fontFamily: "Inter_700Bold" },
    p2pSub: { fontSize: 12, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_400Regular", marginTop: 2 },
    sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    sectionLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    createBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.accentGreen, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
    createBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    studyCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 8 },
    studyTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    studySub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    statusPill: {
      alignSelf: "flex-start", marginTop: 6, fontSize: 10, fontFamily: "Inter_700Bold", color: c.accentGreen,
      backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
    },
    statusPillArchived: { color: c.textMuted, backgroundColor: "rgba(0,0,0,0.06)" },
    sourceCard: {
      flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 18,
    },
    sourceLabel: { fontSize: 10, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
    sourceValue: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold", marginTop: 2 },
    sourceOption: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
    sourceOptionTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    sourceOptionSub: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheetBox: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
    sheetTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    fieldLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 4 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular",
    },
    sheetRow: { flexDirection: "row", gap: 10, marginTop: 8 },
    cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    cancelBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
    saveBtn: { flex: 1, backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
