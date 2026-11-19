// Reminders for ONE Learning Plan (owner brief 2026-11-19 §7), inside My Plans / the plan screen. Uses the phone's
// own scheduled notifications (lib/planReminders — the same infrastructure as study and listening reminders).
// Create (once, or repeating on chosen days), edit, pause, resume, delete. Nothing is created automatically.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton, SegmentedControl } from "@/components/ui";
import { DAY_LABELS, MAX_PER_PLAN, loadPlanReminders, newReminderId, savePlanReminders, type ApplyResult, type PlanReminder } from "@/lib/planReminders";

const TIME_PRESETS = [{ label: "Morning", time: "07:00" }, { label: "Midday", time: "12:30" }, { label: "Evening", time: "20:00" }];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

export default function PlanReminders({ planId, planTitle, disabled }: { planId: string; planTitle: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [all, setAll] = useState<PlanReminder[] | null>(null);
  const [editing, setEditing] = useState<PlanReminder | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const mine = (all ?? []).filter((r) => r.planId === planId);

  useEffect(() => { loadPlanReminders().then(setAll); }, []);
  const say = (r: ApplyResult) => setStatus(r.status === "permission_denied" ? t("planReminders.denied", { defaultValue: "Notifications are turned off for P2P Global. Turn them on in your phone's settings to get reminders." })
    : r.status === "unsupported" ? t("planReminders.web", { defaultValue: "Reminders are delivered on your phone. They're saved here and work in the P2P app." })
    : r.status === "off" ? t("planReminders.none", { defaultValue: "No reminders are scheduled." }) : t("planReminders.saved", { defaultValue: "Reminders updated." }));
  const commit = useCallback(async (next: PlanReminder[]) => { setAll(next); say(await savePlanReminders(next)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => setEditing({ id: newReminderId(), planId, planTitle, kind: "repeat", time: "07:00", days: [1, 2, 3, 4, 5], date: addDays(1), paused: false });
  const saveEdit = () => {
    if (!editing || !all) return;
    if (editing.kind === "repeat" && !editing.days.length) { setStatus(t("planReminders.pickDay", { defaultValue: "Choose at least one day." })); return; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(editing.time)) { setStatus(t("planReminders.badTime", { defaultValue: "Enter a time like 07:30." })); return; }
    if (editing.kind === "once" && new Date(`${editing.date}T${editing.time}:00`).getTime() <= Date.now()) { setStatus(t("planReminders.past", { defaultValue: "Choose a time in the future." })); return; }
    const exists = all.some((r) => r.id === editing.id);
    void commit(exists ? all.map((r) => (r.id === editing.id ? { ...editing, planTitle } : r)) : [...all, { ...editing, planTitle }]);
    setEditing(null);
  };

  const describe = (r: PlanReminder) => r.kind === "once"
    ? `${new Date(`${r.date}T${r.time}:00`).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
    : `${r.days.length === 7 ? t("planReminders.everyDay", { defaultValue: "Every day" }) : r.days.map((d) => DAY_LABELS[d]).join(", ")} · ${r.time}`;

  return (
    <View style={s.box}>
      <Text style={s.label}>{t("planReminders.title", { defaultValue: "Reminders" })}</Text>
      {all === null ? null : mine.length ? mine.map((r) => (
        <View key={r.id} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={[s.text, (r.paused || r.planPaused) && s.muted]}>{describe(r)}</Text>
            {r.paused ? <Text style={s.small}>{t("planReminders.paused", { defaultValue: "Paused" })}</Text> : r.planPaused ? <Text style={s.small}>{t("planReminders.planPaused", { defaultValue: "On hold while this plan is paused" })}</Text> : null}
          </View>
          <IconButton icon={r.paused ? "play" : "pause"} size="sm" accessibilityLabel={r.paused ? t("planReminders.resume", { defaultValue: "Resume reminder" }) : t("planReminders.pause", { defaultValue: "Pause reminder" })} onPress={() => commit((all ?? []).map((x) => (x.id === r.id ? { ...x, paused: !x.paused } : x)))} />
          <IconButton icon="create-outline" size="sm" accessibilityLabel={t("planReminders.edit", { defaultValue: "Edit reminder" })} onPress={() => setEditing({ ...r })} />
          <IconButton icon="trash-outline" size="sm" accessibilityLabel={t("planReminders.delete", { defaultValue: "Delete reminder" })} onPress={() => commit((all ?? []).filter((x) => x.id !== r.id))} />
        </View>
      )) : !editing ? <Text style={s.small}>{t("planReminders.empty", { defaultValue: "No reminders for this plan." })}</Text> : null}

      {editing ? (
        <View style={s.form}>
          <SegmentedControl accessibilityLabel={t("planReminders.kind", { defaultValue: "Reminder type" })} value={editing.kind} onChange={(v) => setEditing({ ...editing, kind: v as PlanReminder["kind"] })}
            options={[{ value: "repeat", label: t("planReminders.repeat", { defaultValue: "Repeat" }) }, { value: "once", label: t("planReminders.once", { defaultValue: "Once" }) }]} />
          {editing.kind === "repeat" ? (
            <ChipRow accessibilityLabel={t("planReminders.days", { defaultValue: "Days" })}>
              {DAY_LABELS.map((d, i) => <FilterChip key={d} label={d} selected={editing.days.includes(i)} onPress={() => setEditing({ ...editing, days: editing.days.includes(i) ? editing.days.filter((x) => x !== i) : [...editing.days, i].sort() })} />)}
            </ChipRow>
          ) : (
            <ChipRow accessibilityLabel={t("planReminders.date", { defaultValue: "Date" })} single>
              {[["today", 0], ["tomorrow", 1], ["inAWeek", 7]].map(([k, n]) => {
                const v = addDays(n as number);
                return <FilterChip key={k as string} selection="single" selected={editing.date === v} label={`${k === "today" ? "Today" : k === "tomorrow" ? "Tomorrow" : "In a week"} · ${new Date(`${v}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`} onPress={() => setEditing({ ...editing, date: v })} />;
              })}
            </ChipRow>
          )}
          {editing.kind === "once" ? <TextInput value={editing.date ?? ""} onChangeText={(v) => setEditing({ ...editing, date: v.slice(0, 10) })} placeholder="YYYY-MM-DD" placeholderTextColor={c.textMuted} style={s.input} accessibilityLabel={t("planReminders.date", { defaultValue: "Date" })} /> : null}
          <ChipRow accessibilityLabel={t("planReminders.time", { defaultValue: "Time" })} single>
            {TIME_PRESETS.map((p) => <FilterChip key={p.time} selection="single" selected={editing.time === p.time} label={`${p.label} · ${p.time}`} onPress={() => setEditing({ ...editing, time: p.time })} />)}
          </ChipRow>
          <TextInput value={editing.time} onChangeText={(v) => setEditing({ ...editing, time: v.replace(/[^0-9:]/g, "").slice(0, 5) })} placeholder="07:30" placeholderTextColor={c.textMuted} style={s.input} keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"} accessibilityLabel={t("planReminders.time", { defaultValue: "Time" })} />
          <Text style={s.small}>{t("planReminders.localTime", { defaultValue: "In your phone's local time." })}</Text>
          <View style={s.buttons}>
            <AppButton size="sm" icon="checkmark" label={t("planReminders.save", { defaultValue: "Save reminder" })} onPress={saveEdit} />
            <AppButton size="sm" variant="tertiary" label={t("planReminders.cancel", { defaultValue: "Cancel" })} onPress={() => setEditing(null)} />
          </View>
        </View>
      ) : !disabled && mine.length < MAX_PER_PLAN ? (
        <AppButton size="sm" variant="secondary" icon="alarm-outline" label={t("planReminders.add", { defaultValue: "Add a reminder" })} onPress={startNew} />
      ) : null}
      {status ? <Text style={s.small} accessibilityLiveRegion="polite">{status}</Text> : null}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    box: { gap: 8 },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    row: { flexDirection: "row", alignItems: "center", gap: 2 },
    text: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    muted: { color: c.textMuted },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    form: { gap: 8, padding: 10, borderRadius: 12, backgroundColor: c.cardBeige },
    input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 12, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 14 },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  });
}
