import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Alert, Platform, Switch } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import {
  getChurchCalls, startChurchCall, scheduleChurchCall, startScheduledChurchCall, joinChurchCall, CHURCH_CALL_PURPOSE_LABELS,
  type ChurchCall, type ChurchCallPurpose, type ChurchCallScope,
} from "@/lib/churchCallApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
function formatDuration(startedAt: string, endedAt: string | null): string {
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - new Date(startedAt).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

const PURPOSES: ChurchCallPurpose[] = ["meeting", "teaching", "bible_study", "prayer", "leadership", "small_group", "fellowship", "church_gathering", "other"];

// Church Calls — a church-scoped, multi-participant live call (meetings,
// teaching, Bible study, prayer, leadership, small groups, fellowship).
// Deliberately NOT Direct Calls (person <-> person) and NOT Family
// Gathering (family <-> participants) — this is the third, distinct
// concept: church/community <-> multiple participants. It reuses the
// existing Agora token route (a new church_call_ channel-name prefix) and
// the existing church role model — no new call SDK, no new permission
// tier, no new push infrastructure. Stage 3 adds scheduling, following the
// exact same "Schedule for later" Switch + plain-text date field
// convention already established by church/settings/announcements.tsx —
// no new date-picker dependency.
export default function ChurchCallsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchLeader, getChurchCohorts } = useData();

  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<ChurchCall[]>([]);
  const [upcoming, setUpcoming] = useState<ChurchCall[]>([]);
  const [recent, setRecent] = useState<ChurchCall[]>([]);
  const [cohorts, setCohorts] = useState<{ id: string; name: string; leaderId: string | null }[]>([]);

  const [startOpen, setStartOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState<ChurchCallPurpose>("meeting");
  const [scope, setScope] = useState<ChurchCallScope>("church");
  const [cohortId, setCohortId] = useState<string | null>(null);
  const [scheduleLater, setScheduleLater] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [description, setDescription] = useState("");
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!userChurch) return;
    setLoading(true);
    try {
      const [{ live: l, upcoming: u, recent: r }, cohortRows] = await Promise.all([
        getChurchCalls(userChurch.id),
        getChurchCohorts(userChurch.id),
      ]);
      setLive(l);
      setUpcoming(u);
      setRecent(r);
      setCohorts(cohortRows.map((c) => ({ id: c.id, name: c.name, leaderId: c.leaderId })));
    } catch (e: any) {
      showAlert("Couldn't load Church Calls", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [userChurch, getChurchCohorts]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function resetForm() {
    setTitle(""); setScheduleLater(false); setScheduledAt(""); setDescription("");
  }

  async function handleStart() {
    if (!userChurch || !title.trim()) return;
    if (scope === "cohort" && !cohortId) {
      showAlert("Choose a group", "Pick which small group this call is for.");
      return;
    }
    if (scheduleLater && !scheduledAt.trim()) {
      showAlert("Choose a date", "Enter when this call should start.");
      return;
    }
    setStarting(true);
    try {
      if (scheduleLater) {
        const iso = new Date(scheduledAt).toISOString();
        await scheduleChurchCall(userChurch.id, title.trim(), purpose, scope, iso, undefined, description.trim() || undefined, cohortId ?? undefined);
        setStartOpen(false);
        resetForm();
        load();
      } else {
        const call = await startChurchCall(userChurch.id, title.trim(), purpose, scope, cohortId ?? undefined);
        setStartOpen(false);
        resetForm();
        router.push({ pathname: "/call/church", params: { callId: call.id, channelName: call.channelName, title: call.title } } as any);
      }
    } catch (e: any) {
      showAlert(scheduleLater ? "Couldn't schedule the call" : "Couldn't start the call", e.message ?? "Please try again.");
    } finally {
      setStarting(false);
    }
  }

  async function handleJoin(call: ChurchCall) {
    try {
      await joinChurchCall(call.id);
      router.push({ pathname: "/call/church", params: { callId: call.id, channelName: call.channelName, title: call.title } } as any);
    } catch (e: any) {
      showAlert("Couldn't join", e.message ?? "Please try again.");
    }
  }

  async function handleStartScheduled(call: ChurchCall) {
    try {
      const started = await startScheduledChurchCall(call.id);
      router.push({ pathname: "/call/church", params: { callId: started.id, channelName: started.channelName, title: started.title } } as any);
    } catch (e: any) {
      showAlert("Couldn't start the call", e.message ?? "Please try again.");
    }
  }

  if (!userChurch) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <Text style={styles.emptyText}>Join or register a church to use Church Calls.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.title}>Calls</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {isChurchLeader && (
            <TouchableOpacity style={styles.startBtn} onPress={() => setStartOpen(true)} accessibilityRole="button">
              <Ionicons name="call" size={16} color="#fff" />
              <Text style={styles.startBtnText}>Start Call</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.sectionLabel}>LIVE NOW</Text>
          {live.length === 0 ? (
            <Text style={styles.emptyText}>No Church Calls are live right now.</Text>
          ) : (
            live.map((c) => (
              <TouchableOpacity key={c.id} style={styles.card} onPress={() => handleJoin(c)} accessibilityRole="button">
                <View style={styles.liveDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.cardSub}>{CHURCH_CALL_PURPOSE_LABELS[c.purpose]} · {formatDuration(c.startedAt!, null)}</Text>
                </View>
                <Text style={styles.joinText}>Join →</Text>
              </TouchableOpacity>
            ))
          )}

          <Text style={styles.sectionLabel}>UPCOMING</Text>
          {upcoming.length === 0 ? (
            <Text style={styles.emptyText}>No upcoming Church Calls scheduled.</Text>
          ) : (
            upcoming.map((c) => (
              <View key={c.id} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.cardSub}>{CHURCH_CALL_PURPOSE_LABELS[c.purpose]} · {formatWhen(c.scheduledStartAt!)}</Text>
                </View>
                {isChurchLeader && (
                  <TouchableOpacity onPress={() => handleStartScheduled(c)}>
                    <Text style={styles.joinText}>Start →</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}

          <Text style={styles.sectionLabel}>RECENT CALLS</Text>
          {recent.length === 0 ? (
            <Text style={styles.emptyText}>No past Church Calls yet.</Text>
          ) : (
            recent.map((c) => (
              <TouchableOpacity key={c.id} style={styles.card} onPress={() => router.push({ pathname: "/church/call-summary", params: { callId: c.id } } as any)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.cardSub}>
                    {CHURCH_CALL_PURPOSE_LABELS[c.purpose]} · {formatWhen(c.startedAt!)} · {formatDuration(c.startedAt!, c.endedAt)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={startOpen} transparent animationType="slide" onRequestClose={() => setStartOpen(false)}>
        <View style={styles.sheetOverlay}>
          <ScrollView contentContainerStyle={styles.sheetBox} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>{scheduleLater ? "Schedule a Church Call" : "Start a Church Call"}</Text>
            <TextInput
              style={styles.input}
              placeholder="Title (e.g. Wednesday Bible Study)"
              placeholderTextColor={colors.textMuted}
              value={title}
              onChangeText={setTitle}
            />
            <Text style={styles.fieldLabel}>Purpose</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {PURPOSES.map((p) => (
                <TouchableOpacity key={p} style={[styles.chip, purpose === p && styles.chipActive]} onPress={() => setPurpose(p)}>
                  <Text style={[styles.chipText, purpose === p && styles.chipTextActive]}>{CHURCH_CALL_PURPOSE_LABELS[p]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Scope</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={[styles.chip, scope === "church" && styles.chipActive]} onPress={() => { setScope("church"); setCohortId(null); }}>
                <Text style={[styles.chipText, scope === "church" && styles.chipTextActive]}>Whole Church</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.chip, scope === "cohort" && styles.chipActive]} onPress={() => setScope("cohort")} disabled={cohorts.length === 0}>
                <Text style={[styles.chipText, scope === "cohort" && styles.chipTextActive]}>Small Group</Text>
              </TouchableOpacity>
            </View>
            {scope === "cohort" && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8 }}>
                {cohorts.map((c) => (
                  <TouchableOpacity key={c.id} style={[styles.chip, cohortId === c.id && styles.chipActive]} onPress={() => setCohortId(c.id)}>
                    <Text style={[styles.chipText, cohortId === c.id && styles.chipTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={styles.toggleRow}>
              <Text style={styles.fieldLabel}>Schedule for later</Text>
              <Switch value={scheduleLater} onValueChange={setScheduleLater} trackColor={{ true: colors.accentGreen }} />
            </View>
            {scheduleLater && (
              <>
                <TextInput
                  style={styles.input} value={scheduledAt} onChangeText={setScheduledAt}
                  placeholder="Starts at (YYYY-MM-DD HH:MM)" placeholderTextColor={colors.textMuted}
                />
                <TextInput
                  style={[styles.input, { minHeight: 60 }]} value={description} onChangeText={setDescription}
                  placeholder="Description (optional)" placeholderTextColor={colors.textMuted} multiline
                />
              </>
            )}

            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setStartOpen(false)} disabled={starting}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleStart} disabled={starting || !title.trim()}>
                {starting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>{scheduleLater ? "Schedule" : "Start"}</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  scroll: { padding: 16, paddingBottom: 40, gap: 8 },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", marginBottom: 12 },

  startBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.primaryGreen, borderRadius: 12, paddingVertical: 13, marginBottom: 8,
  },
  startBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

  sectionLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card,
    borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 8,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#DC2626" },
  cardTitle: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  joinText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheetBox: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular",
  },
  chip: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  chipText: { fontSize: 12, color: colors.textDark, fontFamily: "Inter_500Medium" },
  chipTextActive: { color: "#fff", fontFamily: "Inter_700Bold" },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { color: colors.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
  saveBtn: { flex: 1, backgroundColor: colors.primaryGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
