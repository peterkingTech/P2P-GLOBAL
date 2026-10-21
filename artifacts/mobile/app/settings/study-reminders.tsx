import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Switch, Linking, AppState } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import {
  DAY_LABELS, DEFAULT_REMINDERS, GOAL_CHOICES, applyReminderSchedule, goalProgress, loadReminderSettings, normalizeSettings,
  saveReminderSettings, snoozeStudyReminder, type ScheduleResult, type StudyFocus, type StudyReminderSettings,
} from "@/lib/studyReminders";
import { studyMinutesToday, localDayKey } from "@/lib/studyTime";

// Personal study reminders and a daily goal — for this person only (no group
// reminders, no streak penalties, no one else can see it). Reminders are
// scheduled on this phone in its local time.
const FOCUS: { key: StudyFocus; label: string }[] = [
  { key: "core", label: "Core Foundation" },
  { key: "plans", label: "P2P Plans" },
  { key: "bible", label: "Bible reading" },
];
const MINUTE_STEPS = [0, 15, 30, 45];

export default function StudyRemindersScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const userId = profile?.id ?? null;
  const [s, setS] = useState<StudyReminderSettings>(DEFAULT_REMINDERS);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<ScheduleResult | null>(null);
  const [minutes, setMinutes] = useState(0);
  const [lessonsToday, setLessonsToday] = useState<number | null>(null);
  const [snoozed, setSnoozed] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void loadReminderSettings(userId).then((v) => { setS(v); setLoaded(true); });
  }, [userId]);

  // Today's real activity: time with a lesson/the Bible open on this phone,
  // and lessons worked on today (the person's own progress rows).
  const refreshToday = useCallback(async () => {
    if (!userId) return;
    setMinutes(await studyMinutesToday(userId));
    const [y, m, d] = localDayKey().split("-").map(Number);
    const startOfDay = new Date(y, m - 1, d).toISOString();
    const { count, error } = await supabase.from("p2p_lesson_progress").select("lesson_id", { count: "exact", head: true })
      .eq("user_id", userId).gte("updated_at", startOfDay).or("completed.eq.true,status.eq.submitted");
    setLessonsToday(error ? null : count ?? 0);
  }, [userId]);
  useFocusEffect(useCallback(() => { void refreshToday(); }, [refreshToday]));

  const update = async (patch: Partial<StudyReminderSettings>, askPermission = false) => {
    if (!userId) return;
    const next = normalizeSettings({ ...s, ...patch });
    setS(next);
    await saveReminderSettings(userId, next);
    setStatus(await applyReminderSchedule(next, askPermission));
  };

  // Notification permission may change in the phone's settings while away.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active" && loaded && s.enabled) void applyReminderSchedule(s).then(setStatus); });
    return () => sub.remove();
  }, [loaded, s]);

  const [hour, minute] = s.time.split(":").map(Number);
  const setTime = (h: number, m: number) => update({ time: `${String((h + 24) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}` });
  const timeLabel = new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const goal = goalProgress(minutes, s.goalMinutes);

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Study reminders" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={styles.sectionTitle}>Today</Text>
        <View style={styles.card} accessibilityLabel={`${goal.label}. ${lessonsToday != null ? `${lessonsToday} lessons worked on today.` : ""}`}>
          <Text style={styles.big}>{goal.label}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${goal.pct}%` }]} /></View>
          <Text style={styles.note}>Counted while a lesson or the Bible is open on this phone. {lessonsToday != null ? `Lessons worked on today: ${lessonsToday}.` : ""}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Remind me to study</Text>
              <Text style={styles.note}>A gentle reminder on the days you choose. Only you see it.</Text>
            </View>
            <Switch value={s.enabled} onValueChange={(v) => update({ enabled: v }, v)} trackColor={{ true: c.accentGreen, false: c.borderBeige }} accessibilityLabel="Study reminders" />
          </View>
          {status?.status === "permission_denied" && (
            <TouchableOpacity onPress={() => Linking.openSettings().catch(() => {})} style={styles.warn} accessibilityRole="button">
              <Ionicons name="notifications-off-outline" size={16} color={c.amber} />
              <Text style={styles.warnText}>Notifications are off for P2P, so reminders can't appear. Tap to open Settings.</Text>
            </TouchableOpacity>
          )}
          {status?.status === "unsupported" && <Text style={styles.note}>Reminders work in the phone app (not on the web).</Text>}
          {status?.status === "scheduled" && <Text style={styles.ok}>Reminders set for {s.days.length} day{s.days.length === 1 ? "" : "s"} a week at {timeLabel}.</Text>}
        </View>

        <Text style={styles.sectionTitle}>Days</Text>
        <View style={[styles.card, styles.chips]} accessibilityRole="radiogroup">
          {DAY_LABELS.map((d, i) => {
            const on = s.days.includes(i);
            return (
              <TouchableOpacity key={d} style={[styles.chip, on && styles.chipOn]} onPress={() => update({ days: on ? s.days.filter((x) => x !== i) : [...s.days, i] })}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={d}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{d}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Time</Text>
        <View style={[styles.card, styles.timeRow]}>
          <TouchableOpacity style={styles.step} onPress={() => setTime(hour - 1, minute)} accessibilityRole="button" accessibilityLabel="One hour earlier"><Ionicons name="remove" size={18} color={c.textDark} /></TouchableOpacity>
          <Text style={styles.time} accessibilityLiveRegion="polite">{timeLabel}</Text>
          <TouchableOpacity style={styles.step} onPress={() => setTime(hour + 1, minute)} accessibilityRole="button" accessibilityLabel="One hour later"><Ionicons name="add" size={18} color={c.textDark} /></TouchableOpacity>
          <View style={styles.minutes}>
            {MINUTE_STEPS.map((m) => (
              <TouchableOpacity key={m} style={[styles.minChip, minute === m && styles.chipOn]} onPress={() => setTime(hour, m)} accessibilityRole="radio" accessibilityState={{ selected: minute === m }} accessibilityLabel={`:${String(m).padStart(2, "0")}`}>
                <Text style={[styles.chipText, minute === m && styles.chipTextOn]}>:{String(m).padStart(2, "0")}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <Text style={styles.footnote}>Uses this phone's local time — if you travel, reminders follow the phone's clock.</Text>

        <Text style={styles.sectionTitle}>Daily goal</Text>
        <View style={[styles.card, styles.chips]}>
          {GOAL_CHOICES.map((g) => (
            <TouchableOpacity key={g} style={[styles.chip, s.goalMinutes === g && styles.chipOn]} onPress={() => update({ goalMinutes: g })} accessibilityRole="radio" accessibilityState={{ selected: s.goalMinutes === g }}>
              <Text style={[styles.chipText, s.goalMinutes === g && styles.chipTextOn]}>{g >= 60 ? `${g / 60} h` : `${g} min`}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Focus</Text>
        <View style={[styles.card, styles.chips]}>
          {FOCUS.map((f) => {
            const on = s.focus.includes(f.key);
            return (
              <TouchableOpacity key={f.key} style={[styles.chip, on && styles.chipOn]} onPress={() => update({ focus: on ? s.focus.filter((x) => x !== f.key) : [...s.focus, f.key] })}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.footnote}>Tapping a reminder opens {s.focus.length === 1 && s.focus[0] === "bible" ? "the Bible" : s.focus.length === 1 && s.focus[0] === "plans" ? "your Plans" : "Learn"}. Opening it never marks anything complete.</Text>

        {s.enabled && (
          <TouchableOpacity style={styles.snooze} disabled={snoozed} onPress={async () => setSnoozed(await snoozeStudyReminder(s, 60))} accessibilityRole="button">
            <Ionicons name="alarm-outline" size={16} color={c.textDark} />
            <Text style={styles.snoozeText}>{snoozed ? "I'll remind you in an hour" : "Remind me again in an hour"}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    sectionTitle: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_700Bold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 20, gap: 10 },
    big: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    track: { height: 8, borderRadius: 4, backgroundColor: c.progressTrack, overflow: "hidden" },
    fill: { height: 8, borderRadius: 4, backgroundColor: c.accentGreen },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    label: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    note: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    ok: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    warn: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
    warnText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige, justifyContent: "center", backgroundColor: c.lightCream },
    chipOn: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    chipText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    chipTextOn: { color: "#fff" },
    timeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
    step: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    time: { minWidth: 96, textAlign: "center", fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    minutes: { flexDirection: "row", gap: 6, marginLeft: "auto" },
    minChip: { minHeight: 36, paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, justifyContent: "center" },
    footnote: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: -10, marginBottom: 20 },
    snooze: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: c.borderBeige },
    snoozeText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
