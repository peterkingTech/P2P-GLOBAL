import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Alert, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import { getChurchStudies, createChurchStudy, type ChurchStudy } from "@/lib/churchStudyApi";
import { getChurchStudyPlans, createChurchStudyPlan, type ChurchStudyPlan } from "@/lib/churchStudyPlanApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const STATUS_LABEL: Record<string, string> = { draft: "Draft", published: "Published", archived: "Archived" };

// Study — the app's two content sources coexisting: P2P Curriculum & Plans
// (the official, shared discipleship foundation — always shown first) and
// Church Studies (locally authored, church-owned content). Church Studies
// is never presented as if it were P2P Curriculum, and creating one is
// only ever possible from inside this church context — there is no
// individual/peer-to-peer "Create Custom Study" anywhere in the app.
export default function ChurchStudiesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchLeader } = useData();

  const [loading, setLoading] = useState(true);
  const [studies, setStudies] = useState<ChurchStudy[]>([]);
  const [plans, setPlans] = useState<ChurchStudyPlan[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!userChurch?.id) return;
    setLoading(true);
    try {
      const [studyList, planList] = await Promise.all([getChurchStudies(userChurch.id), getChurchStudyPlans(userChurch.id)]);
      setStudies(studyList);
      setPlans(planList);
    } catch (e: any) {
      showAlert("Couldn't load Church Studies", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [userChurch?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleCreate() {
    if (!userChurch?.id || !title.trim()) return;
    setCreating(true);
    try {
      const study = await createChurchStudy(userChurch.id, title.trim(), description.trim() || undefined);
      setCreateOpen(false);
      setTitle("");
      setDescription("");
      router.push({ pathname: "/church/studies/[studyId]", params: { studyId: study.id } } as any);
    } catch (e: any) {
      showAlert("Couldn't create the study", e.message ?? "Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreatePlan() {
    if (!userChurch?.id || !title.trim()) return;
    setCreating(true);
    try {
      const plan = await createChurchStudyPlan(userChurch.id, title.trim(), description.trim() || undefined);
      setCreatePlanOpen(false);
      setTitle("");
      setDescription("");
      router.push({ pathname: "/church/study-plans/[planId]", params: { planId: plan.id } } as any);
    } catch (e: any) {
      showAlert("Couldn't create the study plan", e.message ?? "Please try again.");
    } finally {
      setCreating(false);
    }
  }

  if (!userChurch?.id) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <Text style={styles.emptyText}>Join or register a church to use Studies.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Study</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        {/* P2P Curriculum & Plans — the shared discipleship foundation, always
            available and always shown first, never hidden by a Church
            Studies preference (Stage 5 will add the default-source setting;
            this screen never removes either option). */}
        <TouchableOpacity style={styles.p2pCard} onPress={() => router.push("/curriculum" as any)}>
          <View style={styles.p2pIconWrap}><Ionicons name="book" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.p2pTitle}>P2P Curriculum & Plans</Text>
            <Text style={styles.p2pSub}>Official discipleship curriculum · Kingdom School</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>CUSTOM STUDY PLANS</Text>
          {isChurchLeader && (
            <TouchableOpacity style={styles.createBtn} onPress={() => setCreatePlanOpen(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.createBtnText}>Create Plan</Text>
            </TouchableOpacity>
          )}
        </View>
        {loading ? null : plans.length === 0 ? (
          <Text style={styles.emptyText}>
            {isChurchLeader ? "No Custom Study Plans yet. Create one above." : "No Custom Study Plans have been published yet."}
          </Text>
        ) : (
          plans.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.studyCard}
              onPress={() => router.push({ pathname: "/church/study-plans/[planId]", params: { planId: p.id } } as any)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.studyTitle}>{p.title}</Text>
                {!!p.description && <Text style={styles.studySub} numberOfLines={2}>{p.description}</Text>}
                {isChurchLeader && p.status !== "published" && (
                  <Text style={[styles.statusPill, p.status === "archived" && styles.statusPillArchived]}>{STATUS_LABEL[p.status]}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))
        )}

        <View style={[styles.sectionRow, { marginTop: 18 }]}>
          <Text style={styles.sectionLabel}>CHURCH STUDIES</Text>
          {isChurchLeader && (
            <TouchableOpacity style={styles.createBtn} onPress={() => setCreateOpen(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.createBtnText}>Create Study</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : studies.length === 0 ? (
          <Text style={styles.emptyText}>
            {isChurchLeader ? "No Church Studies yet. Create one above." : "No Church Studies have been published yet."}
          </Text>
        ) : (
          studies.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.studyCard}
              onPress={() => router.push({ pathname: "/church/studies/[studyId]", params: { studyId: s.id } } as any)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.studyTitle}>{s.title}</Text>
                {!!s.description && <Text style={styles.studySub} numberOfLines={2}>{s.description}</Text>}
                {isChurchLeader && s.status !== "published" && (
                  <Text style={[styles.statusPill, s.status === "archived" && styles.statusPillArchived]}>{STATUS_LABEL[s.status]}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Create Church Study</Text>
            <Text style={styles.fieldLabel}>Study Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. The Book of Romans" placeholderTextColor={colors.textMuted} />
            <Text style={styles.fieldLabel}>Study Description</Text>
            <TextInput
              style={[styles.input, { minHeight: 70 }]} value={description} onChangeText={setDescription} multiline
              placeholder="What is this study about? (optional)" placeholderTextColor={colors.textMuted}
            />
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
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. New Believers Foundations" placeholderTextColor={colors.textMuted} />
            <Text style={styles.fieldLabel}>Plan Description</Text>
            <TextInput
              style={[styles.input, { minHeight: 70 }]} value={description} onChangeText={setDescription} multiline
              placeholder="What is this plan about? (optional)" placeholderTextColor={colors.textMuted}
            />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { alignItems: "center", justifyContent: "center", paddingVertical: 24 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  p2pCard: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.primaryGreen,
    borderRadius: 14, padding: 14, marginBottom: 18,
  },
  p2pIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  p2pTitle: { fontSize: 15, color: "#fff", fontFamily: "Inter_700Bold" },
  p2pSub: { fontSize: 12, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_400Regular", marginTop: 2 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sectionLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.accentGreen, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  createBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  studyCard: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card,
    borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 8,
  },
  studyTitle: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  studySub: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusPill: {
    alignSelf: "flex-start", marginTop: 6, fontSize: 10, fontFamily: "Inter_700Bold", color: colors.accentGreen,
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
