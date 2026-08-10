import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";

// "Preferred learning format" reuses the same p2p_user_goals.learning_format
// column settings/goals.tsx edits — one source of truth, surfaced in both
// places since it's relevant to both "my goals" and "how Kingdom School
// runs for me."
const LEARNING_FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "solo", label: "On my own" },
  { value: "peer_guide", label: "One on one with a peer guide" },
  { value: "group_circle", label: "In a group circle" },
];

const SESSION_LENGTH_OPTIONS: { value: "15min" | "45min" | "flexible"; label: string }[] = [
  { value: "15min", label: "15 minutes" },
  { value: "45min", label: "45 minutes" },
  { value: "flexible", label: "Flexible" },
];

const REMINDER_DAYS: { value: string; label: string }[] = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

export default function KingdomSchoolSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, updateProfile, user, supabase } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [learningFormat, setLearningFormat] = useState<string | null>(null);
  const [loadingFormat, setLoadingFormat] = useState(true);

  const loadLearningFormat = useCallback(async () => {
    if (!user?.id) { setLoadingFormat(false); return; }
    const { data } = await supabase.from("p2p_user_goals").select("learning_format").eq("user_id", user.id).maybeSingle();
    setLearningFormat((data as { learning_format: string | null } | null)?.learning_format ?? null);
    setLoadingFormat(false);
  }, [user?.id, supabase]);

  useEffect(() => { loadLearningFormat(); }, [loadLearningFormat]);

  async function setLearningFormatValue(value: string) {
    if (!user?.id) return;
    const next = learningFormat === value ? null : value;
    setLearningFormat(next);
    await supabase.from("p2p_user_goals").upsert(
      { user_id: user.id, learning_format: next, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Kingdom School" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Preferred Learning Format</Text>
        <View style={styles.card}>
          {loadingFormat ? (
            <ActivityIndicator color={colors.accentGreen} />
          ) : (
            LEARNING_FORMAT_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionRow, i === LEARNING_FORMAT_OPTIONS.length - 1 && styles.rowLast]}
                onPress={() => setLearningFormatValue(opt.value)}
              >
                <Text style={styles.optionLabel}>{opt.label}</Text>
                {learningFormat === opt.value && <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />}
              </TouchableOpacity>
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>Session Length Preference</Text>
        <View style={styles.card}>
          {SESSION_LENGTH_OPTIONS.map((opt, i) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.optionRow, i === SESSION_LENGTH_OPTIONS.length - 1 && styles.rowLast]}
              onPress={() => updateProfile({ preferredSessionLength: opt.value })}
            >
              <Text style={styles.optionLabel}>{opt.label}</Text>
              {(profile?.preferredSessionLength ?? "flexible") === opt.value && <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Reminder Day</Text>
        <View style={styles.card}>
          <View style={styles.chipWrapRow}>
            {REMINDER_DAYS.map((d) => {
              const selected = profile?.reminderDay === d.value;
              return (
                <TouchableOpacity
                  key={d.value}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => updateProfile({ reminderDay: d.value })}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>{d.label}</Text>
                </TouchableOpacity>
              );
            })}
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
    sectionTitle: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 24 },
    optionRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    rowLast: { borderBottomWidth: 0, paddingBottom: 0 },
    optionLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium" },
    chipWrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: c.lightCream },
    chipActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    chipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    chipTextActive: { color: "#fff", fontWeight: "700" },
  });
}