import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// Shorter, onboarding-specific version of the 5-question pre-plan flow
// (plans/pre-plan-questions.tsx) — Prompt 6 explicitly asks for 4 quick
// questions here instead of 5, with different wording, so this is a
// separate screen rather than another "mode" of that one.

const GOAL_OPTIONS = [
  "Grow closer to God",
  "Understand the Bible",
  "Find community and belonging",
  "Break free from something holding me back",
  "Strengthen my relationships",
  "Prepare for a life change",
  "Grow as a leader",
  "Not sure yet",
];

const FAITH_JOURNEY_OPTIONS: { value: string; label: string }[] = [
  { value: "new_believer", label: "I am brand new to faith" },
  { value: "growing", label: "I have believed for a little while" },
  { value: "mature", label: "I have walked with God for years" },
  { value: "returning", label: "I am returning after time away" },
];

const LIFE_SITUATION_OPTIONS: { value: string; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "parent", label: "Parent" },
  { value: "student", label: "Student" },
  { value: "professional", label: "Working professional" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "peer_guide", label: "One on one with a peer guide" },
  { value: "group_circle", label: "In a small group with others" },
  { value: "unsure", label: "Flexible — I will decide later" },
];

type Step = 0 | 1 | 2 | 3 | 4; // 4 = affirmation

export default function GoalsOnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const styles = makeStyles();

  const [step, setStep] = useState<Step>(0);
  const [goals, setGoals] = useState<string[]>([]);
  const [faithJourney, setFaithJourney] = useState<string | null>(null);
  const [lifeSituation, setLifeSituation] = useState<string | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleGoal(value: string) {
    setGoals((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  }

  function goNext() { setStep((s) => Math.min(4, s + 1) as Step); }

  async function finish() {
    if (!profile?.id) { router.replace("/(auth)/journey" as any); return; }
    setSaving(true);
    try {
      const { data: existing } = await supabase.from("p2p_user_goals").select("*").eq("user_id", profile.id).maybeSingle();
      await supabase.from("p2p_user_goals").upsert(
        {
          user_id: profile.id,
          goal_type: existing?.goal_type ?? "personal",
          goals: goals.length ? goals : existing?.goals ?? [],
          success_vision: existing?.success_vision ?? null,
          weekly_time: existing?.weekly_time ?? null,
          learning_format: format ?? existing?.learning_format ?? null,
          potential_blockers: existing?.potential_blockers ?? [],
          age_range: existing?.age_range ?? null,
          life_stage: faithJourney ?? existing?.life_stage ?? null,
          life_situation: lifeSituation && lifeSituation !== "prefer_not_to_say" ? lifeSituation : (existing?.life_situation ?? null),
          topic_interests: existing?.topic_interests ?? [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    } catch {
      // Best-effort — never block entry to the app on a save failure.
    } finally {
      setSaving(false);
      router.replace("/(auth)/journey" as any);
    }
  }

  function skip() {
    router.replace("/(auth)/journey" as any);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <View style={styles.progressDots}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.dot, i <= step && styles.dotActive, i === step && styles.dotCurrent]} />
          ))}
        </View>
        {step < 4 && (
          <TouchableOpacity onPress={skip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.skipBtn}>
            <Text style={styles.skipBtnText}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.content}>
        {step === 0 && (
          <>
            <Text style={styles.eyebrow}>Optional · takes 1 minute</Text>
            <Text style={styles.question}>What are you hoping for in Kingdom School?</Text>
            <View style={styles.optionsList}>
              {GOAL_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt} style={[styles.optionRow, goals.includes(opt) && styles.optionRowActive]} onPress={() => toggleGoal(opt)}>
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
            <Text style={styles.question}>Where are you in your faith journey?</Text>
            <View style={styles.optionsList}>
              {FAITH_JOURNEY_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt.value} style={[styles.optionRow, faithJourney === opt.value && styles.optionRowActive]} onPress={() => setFaithJourney(opt.value)}>
                  <Text style={[styles.optionText, faithJourney === opt.value && styles.optionTextActive]}>{opt.label}</Text>
                  {faithJourney === opt.value && <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.nextBtn, !faithJourney && styles.nextBtnDisabled]} onPress={goNext} disabled={!faithJourney}>
              <Text style={styles.nextBtnText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.eyebrow}>Optional</Text>
            <Text style={styles.question}>What is your current life situation?</Text>
            <View style={styles.optionsList}>
              {LIFE_SITUATION_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt.value} style={[styles.optionRow, lifeSituation === opt.value && styles.optionRowActive]} onPress={() => setLifeSituation(opt.value)}>
                  <Text style={[styles.optionText, lifeSituation === opt.value && styles.optionTextActive]}>{opt.label}</Text>
                  {lifeSituation === opt.value && <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.nextBtn} onPress={goNext}>
              <Text style={styles.nextBtnText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 3 && (
          <>
            <Text style={styles.question}>How would you like to learn?</Text>
            <View style={styles.optionsList}>
              {FORMAT_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt.value} style={[styles.optionRow, format === opt.value && styles.optionRowActive]} onPress={() => setFormat(opt.value)}>
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
          <View style={styles.affirmationWrap}>
            <View style={styles.affirmationIconWrap}>
              <Ionicons name="checkmark" size={28} color="#fff" />
            </View>
            <Text style={styles.question}>Perfect.</Text>
            <Text style={styles.affirmationSub}>We will suggest content that matches your journey.</Text>
            <Text style={styles.affirmationSub}>Your first recommendation is waiting for you.</Text>
            <TouchableOpacity style={styles.nextBtn} onPress={finish} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.nextBtnText}>Enter Kingdom School</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

function makeStyles() {
  const c = colors;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
    progressDots: { flexDirection: "row", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.borderBeige },
    dotActive: { backgroundColor: c.accentGreen },
    dotCurrent: { width: 20 },
    skipBtn: { padding: 4 },
    skipBtnText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium" },
    content: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
    eyebrow: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold", textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
    question: { fontSize: 21, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", lineHeight: 28, textAlign: "center" },
    optionsList: { gap: 10, marginTop: 24 },
    optionRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.borderBeige, borderRadius: 14, padding: 16,
    },
    optionRowActive: { borderColor: c.accentGreen, backgroundColor: `${c.accentGreen}0D` },
    optionText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium" },
    optionTextActive: { color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    nextBtn: { backgroundColor: c.accentGreen, borderRadius: 14, height: 54, alignItems: "center", justifyContent: "center", marginTop: 32 },
    nextBtnDisabled: { opacity: 0.5 },
    nextBtnText: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
    affirmationWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    affirmationIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center", marginBottom: 20 },
    affirmationSub: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },
  });
}
