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
import { communityStudyApi, communityStudyPlanApi, type CommunityScope, type CommunityStudyBase, type CommunityStudyPlanBase } from "@/lib/communityStudyApi";
import { setFamilyStudySource, type FamilyStudySource } from "@/lib/familyStudyPlanApi";

import { useSheetWidth } from "@/hooks/useLayout";
import { AppButton, IconButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", published: "Published", archived: "Archived" };

// A community's Study page — the shared screen behind app/family/studies/index.tsx
// and app/church/studies/index.tsx. Three sources, kept clearly distinct:
// Kingdom School (P2P's own curriculum — always available, always first), the
// community's own Studies (lesson content it authors) and Custom Study Plans
// (an order of EXISTING P2P lessons — never new content, never a second
// progress record). What differs by community is explicit:
//   • which community: Church — the person's current church; Family — the
//     family in the route;
//   • who may create: Church — church leadership; Family — Shepherd / Co-Shepherd;
//   • a family also chooses which source its Gatherings follow.
// There is no individual "Create Custom Study" anywhere; the server enforces
// every rule regardless of what is shown.
const SECTION_LABEL: Record<CommunityScope, string> = { family: "FAMILY STUDIES", church: "CHURCH STUDIES" };

export default function CommunityStudiesScreen({ scope }: { scope: CommunityScope }) {
  const sheetWidth = useSheetWidth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { familyId: familyParam } = useLocalSearchParams<{ familyId?: string }>();
  const { profile } = useAuth();
  const { userChurch, isChurchLeader } = useData();
  const ownerId = scope === "church" ? userChurch?.id : familyParam;
  const familyId = scope === "family" ? familyParam : undefined;
  const studyApi = useMemo(() => communityStudyApi<CommunityStudyBase>(scope), [scope]);
  const planApi = useMemo(() => communityStudyPlanApi<CommunityStudyPlanBase>(scope), [scope]);

  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [studies, setStudies] = useState<CommunityStudyBase[]>([]);
  const [plans, setPlans] = useState<CommunityStudyPlanBase[]>([]);
  const [studySource, setStudySource] = useState<FamilyStudySource>("p2p_curriculum");
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!ownerId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [list, planList] = await Promise.all([studyApi.getStudies(ownerId), planApi.getPlans(ownerId)]);
      setStudies(list);
      setPlans(planList);
      if (scope === "church") {
        setCanManage(isChurchLeader);
      } else {
        const detail = await getFamilyDetail(ownerId);
        const myMembership = detail.members.find((m) => m.userId === profile?.id);
        setCanManage(detail.family.shepherdId === profile?.id || myMembership?.role === "co_shepherd");
        setStudySource(detail.family.studySource);
      }
    } catch (e: any) {
      showAlert("Couldn't load Studies", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [scope, ownerId, studyApi, planApi, profile?.id, isChurchLeader]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleCreate() {
    if (!ownerId || !title.trim()) return;
    setCreating(true);
    try {
      const study = await studyApi.createStudy(ownerId, title.trim(), description.trim() || undefined);
      setCreateOpen(false);
      setTitle("");
      setDescription("");
      router.push({ pathname: `/${scope}/studies/[studyId]`, params: { studyId: study.id, ...(familyId ? { familyId } : {}) } } as any);
    } catch (e: any) {
      showAlert("Couldn't create the study", e.message ?? "Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreatePlan() {
    if (!ownerId || !title.trim()) return;
    setCreating(true);
    try {
      const plan = await planApi.createPlan(ownerId, title.trim(), description.trim() || undefined);
      setCreatePlanOpen(false);
      setTitle("");
      setDescription("");
      router.push({ pathname: `/${scope}/study-plans/[planId]`, params: { planId: plan.id, ...(familyId ? { familyId } : {}) } } as any);
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
        <IconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="Back" color={c.textDark} />
        <Text style={styles.title} accessibilityRole="header">Study</Text>
        <View style={{ width: 44 }} />
      </View>

      {!ownerId && scope === "church" ? (
        <View style={styles.centerFill}><Text style={styles.emptyText}>Join or register a church to use Studies.</Text></View>
      ) : (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <TouchableOpacity accessibilityRole="button" style={styles.p2pCard} onPress={() => router.push("/kingdom-school" as any)}
          accessibilityLabel="Kingdom School: P2P Foundations, lessons and Learning Plans">
          <View style={styles.p2pIconWrap}><Ionicons name="book" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.p2pTitle}>Kingdom School</Text>
            <Text style={styles.p2pSub}>P2P Foundations, lessons and Learning Plans</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </TouchableOpacity>

        {scope === "family" && canManage && (
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
            <AppButton label="Create Plan" onPress={() => setCreatePlanOpen(true)} size="sm" icon="add" />
          )}
        </View>
        {loading ? null : plans.length === 0 ? (
          <Text style={styles.emptyText}>{canManage ? "No Custom Study Plans yet. Create one above." : "No Custom Study Plans have been published yet."}</Text>
        ) : (
          plans.map((p) => (
            <TouchableOpacity accessibilityRole="button"
              key={p.id} style={styles.studyCard}
              onPress={() => router.push({ pathname: `/${scope}/study-plans/[planId]`, params: { planId: p.id, ...(familyId ? { familyId } : {}) } } as any)}
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
          <Text style={styles.sectionLabel}>{SECTION_LABEL[scope]}</Text>
          {canManage && (
            <AppButton label="Create Study" onPress={() => setCreateOpen(true)} size="sm" icon="add" />
          )}
        </View>

        {loading ? (
          <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
        ) : studies.length === 0 ? (
          <Text style={styles.emptyText}>{canManage ? "No Studies yet. Create one above." : "No Studies have been published yet."}</Text>
        ) : (
          studies.map((s) => (
            <TouchableOpacity accessibilityRole="button"
              key={s.id} style={styles.studyCard}
              onPress={() => router.push({ pathname: `/${scope}/studies/[studyId]`, params: { studyId: s.id, ...(familyId ? { familyId } : {}) } } as any)}
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
      )}

      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, sheetWidth, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Create Study</Text>
            <Text style={styles.fieldLabel}>Study Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. The Book of Romans" placeholderTextColor={c.textMuted} />
            <Text style={styles.fieldLabel}>Study Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={description} onChangeText={setDescription} multiline placeholder="What is this study about? (optional)" placeholderTextColor={c.textMuted} />
            <View style={styles.sheetRow}>
              <AppButton label="Cancel" onPress={() => setCreateOpen(false)} variant="outline" disabled={creating} style={{ flex: 1 }} />
              <AppButton label="Create" onPress={handleCreate} disabled={creating || !title.trim()} loading={creating} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={createPlanOpen} transparent animationType="slide" onRequestClose={() => setCreatePlanOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, sheetWidth, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Create Custom Study Plan</Text>
            <Text style={styles.fieldLabel}>Plan Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Foundations of Faith" placeholderTextColor={c.textMuted} />
            <Text style={styles.fieldLabel}>Plan Description</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={description} onChangeText={setDescription} multiline placeholder="What is this plan about? (optional)" placeholderTextColor={c.textMuted} />
            <View style={styles.sheetRow}>
              <AppButton label="Cancel" onPress={() => setCreatePlanOpen(false)} variant="outline" disabled={creating} style={{ flex: 1 }} />
              <AppButton label="Create" onPress={handleCreatePlan} disabled={creating || !title.trim()} loading={creating} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={sourceSheetOpen} transparent animationType="slide" onRequestClose={() => setSourceSheetOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, sheetWidth, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Study Source</Text>
            <Text style={styles.fieldLabel}>Choose what Study uses for this Family Circle. This does not change what's already been studied.</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.sourceOption} onPress={() => handleChooseSource("p2p_curriculum")}>
              <Ionicons name={studySource === "p2p_curriculum" ? "radio-button-on" : "radio-button-off"} size={20} color={c.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceOptionTitle}>P2P Curriculum</Text>
                <Text style={styles.sourceOptionSub}>Official discipleship curriculum · default</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.sourceOption} onPress={() => handleChooseSource("custom_study_plan")}>
              <Ionicons name={studySource === "custom_study_plan" ? "radio-button-on" : "radio-button-off"} size={20} color={c.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceOptionTitle}>Custom Study Plan</Text>
                <Text style={styles.sourceOptionSub}>
                  {plans.some((p) => p.status === "published") ? "Open a published plan below and set it active" : "Publish a Custom Study Plan first"}
                </Text>
              </View>
            </TouchableOpacity>
            <AppButton label="Done" onPress={() => setSourceSheetOpen(false)} variant="outline" style={{ flex: 1 }} />
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
