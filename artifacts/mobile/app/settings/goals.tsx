import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { PLAN_CATEGORIES } from "@/lib/planCategories";

// Moved verbatim from the old settings.tsx "My Goals" section — same fields,
// same behavior, just living on its own screen now.

const LIFE_STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "new_believer", label: "New Believer" },
  { value: "growing", label: "Growing" },
  { value: "mature", label: "Mature" },
  { value: "leader", label: "Leader" },
];

const LIFE_SITUATION_OPTIONS: { value: string; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "parent", label: "Parent" },
  { value: "student", label: "Student" },
  { value: "professional", label: "Working Professional" },
];

// Was a hand-picked, generic 8-item list that predated (and didn't match)
// the 10 real plan categories — topic_interests now stores the category
// slug directly, so it matches the recommendation engine's tag-based
// scoring exactly instead of relying on loose free-text overlap.
const TOPIC_INTEREST_OPTIONS: { value: string; label: string }[] = PLAN_CATEGORIES
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((c) => ({ value: c.key, label: c.label }));

const AGE_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: "13-17", label: "Under 18" },
  { value: "18-24", label: "18 to 24" },
  { value: "25-34", label: "25 to 34" },
  { value: "35-44", label: "35 to 44" },
  { value: "45-54", label: "45 to 54" },
  { value: "55+", label: "55 and over" },
];

const LEARNING_FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "peer_guide", label: "One on one with a peer guide" },
  { value: "group_circle", label: "In a group circle" },
  { value: "solo", label: "On my own" },
  { value: "unsure", label: "Not sure yet" },
];

interface UserGoalsRow {
  goals: string[];
  success_vision: string | null;
  weekly_time: string | null;
  learning_format: string | null;
  potential_blockers: string[];
  age_range: string | null;
  life_stage: string | null;
  life_situation: string | null;
  topic_interests: string[];
}

function emptyGoalsRow(): UserGoalsRow {
  return { goals: [], success_vision: null, weekly_time: null, learning_format: null, potential_blockers: [], age_range: null, life_stage: null, life_situation: null, topic_interests: [] };
}

export default function GoalsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, supabase } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [goalsRow, setGoalsRow] = useState<UserGoalsRow | null>(null);
  const [goalsLoading, setGoalsLoading] = useState(true);

  const loadGoals = useCallback(async () => {
    if (!user?.id) { setGoalsLoading(false); return; }
    setGoalsLoading(true);
    const { data } = await supabase.from("p2p_user_goals").select("*").eq("user_id", user.id).maybeSingle();
    setGoalsRow(data as UserGoalsRow | null);
    setGoalsLoading(false);
  }, [user?.id, supabase]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  async function updateGoalField(field: keyof UserGoalsRow, value: unknown) {
    if (!user?.id) return;
    setGoalsRow((prev) => ({ ...(prev ?? emptyGoalsRow()), [field]: value } as UserGoalsRow));
    await supabase.from("p2p_user_goals").upsert(
      { user_id: user.id, ...(goalsRow ?? emptyGoalsRow()), [field]: value, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  }

  function toggleTopicInterest(topic: string) {
    const current = goalsRow?.topic_interests ?? [];
    const next = current.includes(topic) ? current.filter((t) => t !== topic) : [...current, topic];
    updateGoalField("topic_interests", next);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="My Goals" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          {goalsLoading ? (
            <ActivityIndicator color={colors.accentGreen} />
          ) : (
            <>
              {goalsRow?.goals?.length ? (
                <View style={styles.chipWrapRow}>
                  {goalsRow.goals.map((g) => (
                    <View key={g} style={styles.chipReadonly}><Text style={styles.chipReadonlyText}>{g}</Text></View>
                  ))}
                </View>
              ) : (
                <Text style={styles.goalsEmptyText}>You haven't set your goals yet.</Text>
              )}
              {goalsRow?.success_vision ? (
                <Text style={styles.goalsVisionText}>"{goalsRow.success_vision}"</Text>
              ) : null}
              <TouchableOpacity
                style={styles.updateGoalsBtn}
                onPress={() => router.push("/plans/pre-plan-questions?returnTo=/settings/goals" as any)}
              >
                <Ionicons name="refresh-outline" size={15} color={colors.accentGreen} />
                <Text style={styles.updateGoalsBtnText}>Update my goals</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Life stage</Text>
          <View style={styles.chipWrapRow}>
            {LIFE_STAGE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chip, goalsRow?.life_stage === opt.value && styles.chipActive]}
                onPress={() => updateGoalField("life_stage", goalsRow?.life_stage === opt.value ? null : opt.value)}
              >
                <Text style={[styles.chipText, goalsRow?.life_stage === opt.value && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Life situation</Text>
          <View style={styles.chipWrapRow}>
            {LIFE_SITUATION_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chip, goalsRow?.life_situation === opt.value && styles.chipActive]}
                onPress={() => updateGoalField("life_situation", goalsRow?.life_situation === opt.value ? null : opt.value)}
              >
                <Text style={[styles.chipText, goalsRow?.life_situation === opt.value && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Topic interests</Text>
          <View style={styles.chipWrapRow}>
            {TOPIC_INTEREST_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chip, goalsRow?.topic_interests?.includes(opt.value) && styles.chipActive]}
                onPress={() => toggleTopicInterest(opt.value)}
              >
                <Text style={[styles.chipText, goalsRow?.topic_interests?.includes(opt.value) && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Learning format preference</Text>
          <View style={styles.chipWrapRow}>
            {LEARNING_FORMAT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chip, goalsRow?.learning_format === opt.value && styles.chipActive]}
                onPress={() => updateGoalField("learning_format", goalsRow?.learning_format === opt.value ? null : opt.value)}
              >
                <Text style={[styles.chipText, goalsRow?.learning_format === opt.value && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Age range</Text>
          <Text style={styles.ageRangeHint}>Optional — helps us suggest age-appropriate content</Text>
          <View style={styles.chipWrapRow}>
            <TouchableOpacity
              style={[styles.chip, !goalsRow?.age_range && styles.chipActive]}
              onPress={() => updateGoalField("age_range", null)}
            >
              <Text style={[styles.chipText, !goalsRow?.age_range && styles.chipTextActive]}>Prefer not to say</Text>
            </TouchableOpacity>
            {AGE_RANGE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chip, goalsRow?.age_range === opt.value && styles.chipActive]}
                onPress={() => updateGoalField("age_range", opt.value)}
              >
                <Text style={[styles.chipText, goalsRow?.age_range === opt.value && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 24 },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, marginBottom: 8, fontFamily: "Inter_600SemiBold" },
    chipWrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: c.lightCream },
    chipActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    chipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    chipTextActive: { color: "#fff", fontWeight: "700" },
    chipReadonly: { backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 },
    chipReadonlyText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_500Medium" },
    goalsEmptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", marginBottom: 4 },
    goalsVisionText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 10, lineHeight: 19 },
    updateGoalsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, borderWidth: 1, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 11 },
    updateGoalsBtnText: { fontSize: 13, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    ageRangeHint: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: -4, marginBottom: 8 },
  });
}