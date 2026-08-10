import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

const GOAL_OPTIONS = [
  "I want to grow closer to God",
  "I am going through a difficult season",
  "I want to strengthen my relationships",
  "I want to understand the Bible better",
  "I want to break free from something",
  "I want to prepare for a life change",
  "I want to develop as a leader",
  "Someone recommended this to me",
];

const WEEKLY_TIME_OPTIONS: { value: string; label: string }[] = [
  { value: "under_1h", label: "Less than 1 hour" },
  { value: "1_2h", label: "1 to 2 hours" },
  { value: "3_5h", label: "3 to 5 hours" },
  { value: "unlimited", label: "As much as it takes" },
];

const FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "peer_guide", label: "With my peer guide — one on one" },
  { value: "group_circle", label: "In a group circle with others" },
  { value: "solo", label: "On my own for now" },
  { value: "unsure", label: "Not sure yet" },
];

const BLOCKER_OPTIONS = [
  "Busy work schedule",
  "Family responsibilities",
  "I sometimes lose motivation",
  "I have tried things like this before and stopped",
  "Nothing — I am ready",
  "Prefer not to say",
];

type Step = 0 | 1 | 2 | 3 | 4 | 5; // 5 = summary

export default function PrePlanQuestionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // No planId => "general" mode: same 5 questions, framed for the overall
  // journey rather than one plan (used by onboarding and Settings → My
  // Goals → "Update my goals"). Answers go straight to p2p_user_goals with
  // no plan enrollment created.
  const { planId, returnTo } = useLocalSearchParams<{ planId?: string; returnTo?: string }>();
  const isGeneral = !planId;
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [step, setStep] = useState<Step>(0);
  const [goals, setGoals] = useState<string[]>([]);
  const [successVision, setSuccessVision] = useState("");
  const [weeklyTime, setWeeklyTime] = useState<string | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function goNext() { setStep((s) => Math.min(5, s + 1) as Step); }
  function goBack() {
    if (step === 0) { router.back(); return; }
    setStep((s) => Math.max(0, s - 1) as Step);
  }

  async function finish() {
    if (!profile?.id) { router.back(); return; }
    setSaving(true);
    try {
      const { data: existingGoals } = await supabase.from("p2p_user_goals").select("*").eq("user_id", profile.id).maybeSingle();

      if (isGeneral) {
        // General mode is the primary goal-setting occasion (onboarding, or
        // an explicit "Update my goals" from Settings) — these 5 answers
        // overwrite the fields they cover; fields this flow never asks about
        // (age range, life stage/situation, topic interests) are preserved.
        await supabase.from("p2p_user_goals").upsert(
          {
            user_id: profile.id,
            goal_type: existingGoals?.goal_type ?? "personal",
            goals,
            success_vision: successVision.trim() || null,
            weekly_time: weeklyTime,
            learning_format: format,
            potential_blockers: blockers,
            age_range: existingGoals?.age_range ?? null,
            life_stage: existingGoals?.life_stage ?? null,
            life_situation: existingGoals?.life_situation ?? null,
            topic_interests: existingGoals?.topic_interests ?? [],
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
      } else {
        const answers = { goals, successVision: successVision.trim() || null, weeklyTime, format, blockers };
        await supabase.from("p2p_plan_enrollments").upsert(
          {
            user_id: profile.id,
            plan_id: planId,
            status: "enrolled",
            enrolled_at: new Date().toISOString(),
            goal_answers: answers,
          },
          { onConflict: "user_id,plan_id" }
        );

        // Feed new preference signals back into the user's overall goals
        // record — additive only, never overwrites an existing
        // success_vision/age_range/etc. the user set elsewhere.
        const mergedGoals = Array.from(new Set([...(existingGoals?.goals ?? []), ...goals]));
        const mergedBlockers = Array.from(new Set([...(existingGoals?.potential_blockers ?? []), ...blockers]));
        await supabase.from("p2p_user_goals").upsert(
          {
            user_id: profile.id,
            goal_type: existingGoals?.goal_type ?? "personal",
            goals: mergedGoals,
            success_vision: existingGoals?.success_vision ?? (successVision.trim() || null),
            weekly_time: weeklyTime ?? existingGoals?.weekly_time ?? null,
            learning_format: format ?? existingGoals?.learning_format ?? null,
            potential_blockers: mergedBlockers,
            age_range: existingGoals?.age_range ?? null,
            life_stage: existingGoals?.life_stage ?? null,
            life_situation: existingGoals?.life_situation ?? null,
            topic_interests: existingGoals?.topic_interests ?? [],
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
      }
    } catch {
      // Best-effort — never block navigation on a save failure.
    } finally {
      setSaving(false);
      if (isGeneral) router.replace((returnTo as any) ?? "/settings/index");
      else router.replace(`/plan/${planId}` as any);
    }
  }

  const formatLabel = FORMAT_OPTIONS.find((f) => f.value === format)?.label ?? null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={goBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <View style={styles.progressDots}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.dot, i <= step && styles.dotActive, i === step && styles.dotCurrent]} />
          ))}
        </View>
        {isGeneral && step < 5 ? (
          <TouchableOpacity onPress={() => router.replace((returnTo as any) ?? "/settings/index")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.skipHeaderText}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      <View style={styles.content}>
        {step === 0 && (
          <>
            <Text style={styles.question}>{isGeneral ? "What are you hoping for in Kingdom School?" : "What brings you to this plan?"}</Text>
            <Text style={styles.hint}>Pick all that apply</Text>
            <View style={styles.optionsList}>
              {GOAL_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt} style={[styles.optionRow, goals.includes(opt) && styles.optionRowActive]} onPress={() => toggle(goals, setGoals, opt)}>
                  <Text style={[styles.optionText, goals.includes(opt) && styles.optionTextActive]}>{opt}</Text>
                  {goals.includes(opt) && <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.nextBtn} onPress={goNext}>
              <Text style={styles.nextBtnText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.question}>What would success look like for you?</Text>
            <Text style={styles.hint}>Optional</Text>
            <TextInput
              style={styles.textInput}
              value={successVision}
              onChangeText={setSuccessVision}
              placeholder="In a few words, what would you love to see change?"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <TouchableOpacity style={styles.nextBtn} onPress={goNext}>
              <Text style={styles.nextBtnText}>Continue</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipBtn} onPress={goNext}>
              <Text style={styles.skipBtnText}>Skip</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.question}>How much time can you give each week?</Text>
            <View style={styles.optionsList}>
              {WEEKLY_TIME_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt.value} style={[styles.optionRow, weeklyTime === opt.value && styles.optionRowActive]} onPress={() => { setWeeklyTime(opt.value); }}>
                  <Text style={[styles.optionText, weeklyTime === opt.value && styles.optionTextActive]}>{opt.label}</Text>
                  {weeklyTime === opt.value && <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.nextBtn, !weeklyTime && styles.nextBtnDisabled]} onPress={goNext} disabled={!weeklyTime}>
              <Text style={styles.nextBtnText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 3 && (
          <>
            <Text style={styles.question}>How would you like to go through this?</Text>
            <View style={styles.optionsList}>
              {FORMAT_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt.value} style={[styles.optionRow, format === opt.value && styles.optionRowActive]} onPress={() => { setFormat(opt.value); }}>
                  <Text style={[styles.optionText, format === opt.value && styles.optionTextActive]}>{opt.label}</Text>
                  {format === opt.value && <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.nextBtn, !format && styles.nextBtnDisabled]} onPress={goNext} disabled={!format}>
              <Text style={styles.nextBtnText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 4 && (
          <>
            <Text style={styles.question}>Is there anything that might make it hard to stay consistent?</Text>
            <Text style={styles.hint}>Optional</Text>
            <View style={styles.optionsList}>
              {BLOCKER_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt} style={[styles.optionRow, blockers.includes(opt) && styles.optionRowActive]} onPress={() => toggle(blockers, setBlockers, opt)}>
                  <Text style={[styles.optionText, blockers.includes(opt) && styles.optionTextActive]}>{opt}</Text>
                  {blockers.includes(opt) && <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.nextBtn} onPress={goNext}>
              <Text style={styles.nextBtnText}>Continue</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipBtn} onPress={goNext}>
              <Text style={styles.skipBtnText}>Skip</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 5 && (
          <>
            <View style={styles.summaryIconWrap}>
              <Ionicons name="checkmark" size={28} color="#fff" />
            </View>
            <Text style={styles.question}>You are all set</Text>
            {successVision.trim() ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Your vision</Text>
                <Text style={styles.summaryValue}>{successVision.trim()}</Text>
              </View>
            ) : null}
            {formatLabel ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>How you'll go through it</Text>
                <Text style={styles.summaryValue}>{formatLabel}</Text>
              </View>
            ) : null}
            <TouchableOpacity style={styles.nextBtn} onPress={finish} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.nextBtnText}>{isGeneral ? "Save" : "Start"}</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
    progressDots: { flex: 1, flexDirection: "row", justifyContent: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.borderBeige },
    dotActive: { backgroundColor: c.accentGreen },
    dotCurrent: { width: 20 },
    skipHeaderText: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_500Medium" },
    content: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
    question: { fontSize: 21, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", lineHeight: 28, textAlign: "center" },
    hint: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6, marginBottom: 20 },
    optionsList: { gap: 10, marginTop: 24 },
    optionRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.borderBeige, borderRadius: 14, padding: 16,
    },
    optionRowActive: { borderColor: c.accentGreen, backgroundColor: `${c.accentGreen}0D` },
    optionText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium" },
    optionTextActive: { color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    textInput: {
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.borderBeige, borderRadius: 14,
      padding: 16, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", minHeight: 100,
      textAlignVertical: "top", marginTop: 24,
    },
    nextBtn: { backgroundColor: c.accentGreen, borderRadius: 14, height: 54, alignItems: "center", justifyContent: "center", marginTop: 32 },
    nextBtnDisabled: { opacity: 0.5 },
    nextBtnText: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
    skipBtn: { alignItems: "center", paddingVertical: 14 },
    skipBtnText: { color: c.textMuted, fontSize: 14, fontFamily: "Inter_500Medium" },
    summaryIconWrap: {
      width: 56, height: 56, borderRadius: 28, backgroundColor: c.accentGreen,
      alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 20,
    },
    summaryCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 16, marginTop: 16 },
    summaryLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    summaryValue: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium", marginTop: 6, lineHeight: 20 },
  });
}
