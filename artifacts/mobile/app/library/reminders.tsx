import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, TextInput } from "react-native";
import { Stack } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton, SegmentedControl } from "@/components/ui";
import { listCollections, type CollectionCard } from "@/lib/scriptureCollectionsApi";
import { DAY_LABELS, TIME_PRESETS, loadReminders, saveReminders, type ListeningReminder, type ReminderKind } from "@/lib/listeningReminders";

// Listening and memorisation reminders — optional, on this phone only.
// Morning / afternoon / evening or a custom time, chosen weekdays, and
// (for listening) a playlist to open. Opening one never starts playback.

const newId = () => `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export default function RemindersScreen() {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [list, setList] = useState<ListeningReminder[] | null>(null);
  const [playlists, setPlaylists] = useState<CollectionCard[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadReminders().then(setList);
    listCollections().then((r) => setPlaylists([...r.mine, ...r.shared])).catch(() => {});
  }, []);
  const update = (id: string, patch: Partial<ListeningReminder>) => setList((l) => l?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? l);
  const add = (kind: ReminderKind) => setList((l) => [...(l ?? []), { id: newId(), kind, enabled: true, time: kind === "memorise" ? "20:00" : "07:00", days: [0, 1, 2, 3, 4, 5, 6], collectionId: null, collectionTitle: null }]);
  async function save() {
    if (!list) return;
    setBusy(true);
    try {
      const r = await saveReminders(list);
      setNotice(r.status === "scheduled" ? `Saved — ${r.count} weekly ${r.count === 1 ? "reminder" : "reminders"} on this phone.` : r.status === "off" ? "Saved. No reminders are on."
        : r.status === "permission_denied" ? "Saved, but notifications are turned off for P2P Global in your phone's settings." : "Reminders work in the phone app.");
    } finally { setBusy(false); }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Listening reminders" }} />
      <Text style={s.hint}>Optional reminders on this phone. They only open P2P Global — nothing plays until you tap Play.</Text>
      {list?.map((r) => (
        <View key={r.id} style={s.card}>
          <View style={s.head}>
            <Text style={s.title}>{r.kind === "memorise" ? "Memorisation review" : "Listening time"}</Text>
            <Switch value={r.enabled} onValueChange={(v) => update(r.id, { enabled: v })} accessibilityLabel={`${r.kind === "memorise" ? "Memorisation review" : "Listening"} reminder on`}
              trackColor={{ true: c.accentGreen, false: c.borderBeige }} thumbColor="#fff" />
            <IconButton icon="trash-outline" size="sm" color={c.textMuted} accessibilityLabel="Delete this reminder" onPress={() => setList((l) => l?.filter((x) => x.id !== r.id) ?? l)} />
          </View>
          <ChipRow accessibilityLabel="Time of day" single>
            {TIME_PRESETS.map((p) => <FilterChip key={p.time} label={`${p.label} · ${p.time}`} selected={r.time === p.time} selection="single" onPress={() => update(r.id, { time: p.time })} />)}
          </ChipRow>
          <View style={s.row}>
            <Text style={s.label}>Custom time</Text>
            <TextInput style={s.time} value={r.time} onChangeText={(v) => update(r.id, { time: v.replace(/[^0-9:]/g, "").slice(0, 5) })} placeholder="HH:MM" placeholderTextColor={c.textMuted}
              keyboardType="numbers-and-punctuation" accessibilityLabel="Custom time, 24-hour, hours and minutes" maxLength={5} />
          </View>
          <View style={s.days} accessibilityLabel="Days">
            {DAY_LABELS.map((d, i) => {
              const on = r.days.includes(i);
              return (
                <Pressable key={d} style={[s.day, on && { backgroundColor: c.accentGreen, borderColor: c.accentGreen }]} onPress={() => update(r.id, { days: on ? r.days.filter((x) => x !== i) : [...r.days, i] })}
                  accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={d}>
                  <Text style={[s.dayText, on && { color: "#fff" }]}>{d}</Text>
                </Pressable>
              );
            })}
          </View>
          {r.kind === "listen" ? (
            <>
              <Text style={s.label}>Open</Text>
              <ChipRow accessibilityLabel="Playlist to open" single>
                <FilterChip label="My library" selected={!r.collectionId} selection="single" onPress={() => update(r.id, { collectionId: null, collectionTitle: null })} />
                {playlists.map((p) => <FilterChip key={p.id} label={p.title} selected={r.collectionId === p.id} selection="single" onPress={() => update(r.id, { collectionId: p.id, collectionTitle: p.title })} />)}
              </ChipRow>
            </>
          ) : null}
        </View>
      ))}
      {list && !list.length ? <Text style={s.hint}>No reminders yet.</Text> : null}
      <SegmentedControl accessibilityLabel="Add a reminder" value="none" onChange={(v) => add(v as ReminderKind)}
        options={[{ value: "listen", label: "+ Listening" }, { value: "memorise", label: "+ Memorisation" }]} />
      <AppButton label="Save reminders" icon="checkmark" onPress={save} loading={busy} />
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 12, paddingBottom: 120 },
    hint: { fontSize: 13, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    notice: { fontSize: 13, lineHeight: 18, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    card: { padding: 14, borderRadius: 16, backgroundColor: c.card, gap: 10 },
    head: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    label: { fontSize: 13, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    time: { minHeight: 40, minWidth: 90, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, color: c.textDark, fontFamily: "Inter_500Medium", fontSize: 15 },
    days: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    day: { minWidth: 44, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: c.borderBeige },
    dayText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_600SemiBold" },
  });
}
