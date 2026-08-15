import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, Platform, Modal, FlatList } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData, LearningGoal, LearningGoalLevel, LearningGoalTimeframe, LearningGoalTargetType } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const TIMEFRAME_OPTIONS: { value: LearningGoalTimeframe; label: string }[] = [
  { value: "today", label: "Today" }, { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" }, { value: "custom", label: "Custom" },
];
const LEVEL_OPTIONS: { value: LearningGoalLevel; label: string }[] = [
  { value: "lesson", label: "Lesson" }, { value: "module", label: "Module" }, { value: "curriculum", label: "Full Curriculum" },
];

export default function ChurchLearningGoalsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchLeader, modules, lessons, getLearningGoals, createLearningGoal, updateLearningGoal } = useData();
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<LearningGoalLevel>("lesson");
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<LearningGoalTimeframe>("this_week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [targetType, setTargetType] = useState<LearningGoalTargetType>("percentage");
  const [targetValue, setTargetValue] = useState("80");
  const [modulePickerOpen, setModulePickerOpen] = useState(false);
  const [lessonPickerOpen, setLessonPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const curriculumId = modules[0]?.curriculumId ?? null;
  const lessonsInModule = lessons.filter((l) => l.moduleId === moduleId);

  const load = useCallback(async () => {
    if (!userChurch) return;
    setLoading(true);
    setGoals(await getLearningGoals(userChurch.id, "active"));
    setLoading(false);
  }, [userChurch, getLearningGoals]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function resetForm() {
    setTitle(""); setLevel("lesson"); setModuleId(null); setLessonId(null);
    setTimeframe("this_week"); setCustomStart(""); setCustomEnd(""); setTargetType("percentage"); setTargetValue("80");
  }

  async function handleCreate() {
    if (!userChurch || !title.trim()) return;
    if (level === "module" && !moduleId) { Alert.alert("Choose a module"); return; }
    if (level === "lesson" && !lessonId) { Alert.alert("Choose a lesson"); return; }
    if (level === "curriculum" && !curriculumId) { Alert.alert("No curriculum available yet"); return; }
    if (timeframe === "custom" && (!customStart.trim() || !customEnd.trim())) { Alert.alert("Enter a start and end date"); return; }

    setSubmitting(true);
    const { goal, error } = await createLearningGoal(userChurch.id, {
      title: title.trim(), goalLevel: level,
      lessonId: level === "lesson" ? lessonId! : undefined,
      moduleId: level === "module" ? moduleId! : undefined,
      curriculumId: level === "curriculum" ? curriculumId! : undefined,
      timeframe,
      startsAt: timeframe === "custom" ? new Date(customStart).toISOString() : undefined,
      endsAt: timeframe === "custom" ? new Date(customEnd).toISOString() : undefined,
      targetType, targetValue: Number(targetValue) || 0,
    });
    setSubmitting(false);
    if (error || !goal) { Alert.alert("Couldn't create learning goal", error ?? "Please try again."); return; }
    setCreating(false);
    resetForm();
    load();
  }

  async function handleArchive(goalId: string) {
    if (!userChurch) return;
    const err = await updateLearningGoal(userChurch.id, goalId, { status: "archived" });
    if (err) Alert.alert("Couldn't archive goal", err);
    else load();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Learning Goals</Text>
      </View>

      {!isChurchLeader ? (
        <View style={styles.content}><Text style={styles.lockedText}>Only church leadership can manage learning goals.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {!creating ? (
            <TouchableOpacity style={styles.createBtn} onPress={() => setCreating(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.createBtnText}>Create Learning Goal</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.form}>
              <Text style={styles.label}>Goal Name</Text>
              <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Complete Module 1 Together" placeholderTextColor={colors.textMuted} />

              <Text style={styles.label}>What are we studying?</Text>
              <View style={styles.chipRow}>
                {LEVEL_OPTIONS.map((o) => (
                  <TouchableOpacity key={o.value} style={[styles.chip, level === o.value && styles.chipActive]} onPress={() => { setLevel(o.value); setModuleId(null); setLessonId(null); }}>
                    <Text style={[styles.chipText, level === o.value && styles.chipTextActive]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {(level === "module" || level === "lesson") && (
                <TouchableOpacity style={styles.pickerBtn} onPress={() => setModulePickerOpen(true)}>
                  <Text style={[styles.pickerBtnText, !moduleId && { color: colors.textMuted }]}>
                    {modules.find((m) => m.id === moduleId)?.title ?? "Choose a module"}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              {level === "lesson" && moduleId && (
                <TouchableOpacity style={styles.pickerBtn} onPress={() => setLessonPickerOpen(true)}>
                  <Text style={[styles.pickerBtnText, !lessonId && { color: colors.textMuted }]}>
                    {lessons.find((l) => l.id === lessonId)?.title ?? "Choose a lesson"}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              {level === "curriculum" && !curriculumId && (
                <Text style={styles.warnText}>Curriculum content hasn't loaded yet — try again shortly.</Text>
              )}

              <Text style={[styles.label, { marginTop: 16 }]}>Timeframe</Text>
              <View style={styles.chipRow}>
                {TIMEFRAME_OPTIONS.map((o) => (
                  <TouchableOpacity key={o.value} style={[styles.chip, timeframe === o.value && styles.chipActive]} onPress={() => setTimeframe(o.value)}>
                    <Text style={[styles.chipText, timeframe === o.value && styles.chipTextActive]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {timeframe === "custom" && (
                <View style={styles.dateRow}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={customStart} onChangeText={setCustomStart} placeholder="Start (YYYY-MM-DD)" placeholderTextColor={colors.textMuted} />
                  <TextInput style={[styles.input, { flex: 1 }]} value={customEnd} onChangeText={setCustomEnd} placeholder="End (YYYY-MM-DD)" placeholderTextColor={colors.textMuted} />
                </View>
              )}

              <Text style={[styles.label, { marginTop: 16 }]}>Target</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity style={[styles.chip, targetType === "percentage" && styles.chipActive]} onPress={() => setTargetType("percentage")}>
                  <Text style={[styles.chipText, targetType === "percentage" && styles.chipTextActive]}>% of active members</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.chip, targetType === "member_count" && styles.chipActive]} onPress={() => setTargetType("member_count")}>
                  <Text style={[styles.chipText, targetType === "member_count" && styles.chipTextActive]}>Number of members</Text>
                </TouchableOpacity>
              </View>
              <TextInput style={styles.input} value={targetValue} onChangeText={setTargetValue} keyboardType="number-pad" placeholder={targetType === "percentage" ? "80" : "20"} placeholderTextColor={colors.textMuted} />

              <View style={styles.formBtnRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setCreating(false); resetForm(); }}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleCreate} disabled={submitting || !title.trim()}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Create Goal</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          <Text style={styles.sectionLabel}>Active Goals</Text>
          {loading ? (
            <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 20 }} />
          ) : goals.length === 0 ? (
            <Text style={styles.emptyText}>No learning goal has been set for this period.{"\n"}Set a goal to give your church a shared learning target.</Text>
          ) : (
            goals.map((g) => (
              <View key={g.id} style={styles.goalCard}>
                <Text style={styles.goalTitle}>{g.title}</Text>
                <Text style={styles.goalMeta}>
                  {TIMEFRAME_OPTIONS.find((o) => o.value === g.timeframe)?.label} · Target: {g.targetType === "percentage" ? `${g.targetValue}%` : `${g.targetValue} members`}
                </Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, g.progressPercent ?? 0)}%` }, g.achieved && styles.progressFillAchieved]} />
                </View>
                <Text style={styles.goalProgressText}>
                  {g.achieved ? "🎉 Goal reached! " : ""}{g.completedCount ?? 0} of {g.totalMembers ?? 0} members ({Math.round(g.progressPercent ?? 0)}%)
                </Text>
                <TouchableOpacity onPress={() => handleArchive(g.id)}><Text style={styles.archiveText}>Archive</Text></TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={modulePickerOpen} animationType="slide" transparent onRequestClose={() => setModulePickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModulePickerOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Choose a Module</Text>
            <FlatList data={modules} keyExtractor={(m) => m.id} style={{ maxHeight: 340 }} renderItem={({ item }) => (
              <TouchableOpacity style={styles.optionRow} onPress={() => { setModuleId(item.id); setLessonId(null); setModulePickerOpen(false); }}>
                <Text style={styles.optionRowText}>{item.title}</Text>
              </TouchableOpacity>
            )} />
          </View>
        </TouchableOpacity>
      </Modal>
      <Modal visible={lessonPickerOpen} animationType="slide" transparent onRequestClose={() => setLessonPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setLessonPickerOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Choose a Lesson</Text>
            <FlatList data={lessonsInModule} keyExtractor={(l) => l.id} style={{ maxHeight: 340 }} renderItem={({ item }) => (
              <TouchableOpacity style={styles.optionRow} onPress={() => { setLessonId(item.id); setLessonPickerOpen(false); }}>
                <Text style={styles.optionRowText}>{item.title}</Text>
              </TouchableOpacity>
            )} />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { padding: 20, paddingBottom: 60 },
  lockedText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.accentGreen, borderRadius: 10, height: 46, marginBottom: 20,
  },
  createBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  form: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 14, padding: 16, marginBottom: 24 },
  label: { fontSize: 13, color: colors.textMid, marginBottom: 6, fontFamily: "Inter_500Medium" },
  input: {
    backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 8,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: colors.lightCream },
  chipActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  chipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  pickerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.lightCream,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12, marginBottom: 8,
  },
  pickerBtnText: { color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular" },
  warnText: { fontSize: 12, color: "#D97706", marginBottom: 8, fontFamily: "Inter_400Regular" },
  dateRow: { flexDirection: "row", gap: 8 },
  formBtnRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, height: 46, alignItems: "center", justifyContent: "center" },
  cancelBtnText: { color: colors.textMid, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  saveBtn: { flex: 1, backgroundColor: colors.accentGreen, borderRadius: 10, height: 46, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.textDark, marginBottom: 10, fontFamily: "Inter_700Bold" },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 20, lineHeight: 20, fontFamily: "Inter_400Regular" },
  goalCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14, marginBottom: 10 },
  goalTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  goalMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  progressTrack: { height: 8, backgroundColor: colors.lightCream, borderRadius: 4, marginTop: 10, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.accentGreen, borderRadius: 4 },
  progressFillAchieved: { backgroundColor: "#D97706" },
  goalProgressText: { fontSize: 12, color: colors.textMid, marginTop: 6, fontFamily: "Inter_400Regular" },
  archiveText: { fontSize: 12, color: "#B91C1C", marginTop: 8, fontFamily: "Inter_500Medium" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, marginBottom: 10, fontFamily: "Inter_700Bold" },
  optionRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  optionRowText: { color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular" },
});