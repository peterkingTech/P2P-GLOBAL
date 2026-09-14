import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Modal, Platform, Alert, Switch } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  createAvailability, getMyAvailability, toggleAvailability, deleteAvailability,
  type PrayerAvailability, type AvailabilityRecurrence, type PrayerRequestVisibility,
} from "@/lib/prayerCoordinationApi";
import { deviceTimezone, zoneShortLabel } from "@/lib/prayerTimeDisplay";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const WEEKDAYS = [
  { key: 0, label: "Sun" }, { key: 1, label: "Mon" }, { key: 2, label: "Tue" }, { key: 3, label: "Wed" },
  { key: 4, label: "Thu" }, { key: 5, label: "Fri" }, { key: 6, label: "Sat" },
];

function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(t);
}

export default function PrayerAvailabilityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const tz = deviceTimezone();

  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<PrayerAvailability[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recurrence, setRecurrence] = useState<AvailabilityRecurrence>("once");
  const [dateChoice, setDateChoice] = useState<"today" | "tomorrow">("today");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("21:00");
  const [endTime, setEndTime] = useState("21:30");
  const [visibility, setVisibility] = useState<PrayerRequestVisibility>("open");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSlots(await getMyAvailability());
    } catch (e: any) {
      showAlert("Couldn't load your availability", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openSheet() {
    setRecurrence("once"); setDateChoice("today"); setDayOfWeek(1);
    setStartTime("21:00"); setEndTime("21:30"); setVisibility("open");
    setSheetOpen(true);
  }

  async function handleSave() {
    if (!isValidTime(startTime) || !isValidTime(endTime)) return showAlert("Invalid time", "Use HH:MM, e.g. 21:00.");
    if (startTime >= endTime) return showAlert("Invalid time range", "End time must be after start time.");
    setSaving(true);
    try {
      await createAvailability({
        timezone: tz, recurrence, startTime, endTime, visibility,
        specificDate: recurrence === "once" ? todayStr(dateChoice === "tomorrow" ? 1 : 0) : undefined,
        dayOfWeek: recurrence === "weekly" ? dayOfWeek : undefined,
      });
      setSheetOpen(false);
      await load();
    } catch (e: any) {
      showAlert("Couldn't save this slot", e.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(slot: PrayerAvailability) {
    try {
      await toggleAvailability(slot.id);
      await load();
    } catch (e: any) {
      showAlert("Couldn't update this slot", e.message ?? "Please try again.");
    }
  }

  async function handleDelete(slot: PrayerAvailability) {
    try {
      await deleteAvailability(slot.id);
      await load();
    } catch (e: any) {
      showAlert("Couldn't remove this slot", e.message ?? "Please try again.");
    }
  }

  function slotLabel(slot: PrayerAvailability): string {
    if (slot.recurrence === "weekly") {
      const day = WEEKDAYS.find((w) => w.key === slot.dayOfWeek)?.label ?? "";
      return `Every ${day}`;
    }
    const today = todayStr(0), tomorrow = todayStr(1);
    if (slot.specificDate === today) return "Today";
    if (slot.specificDate === tomorrow) return "Tomorrow";
    return slot.specificDate ?? "";
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>My Availability</Text>
        <TouchableOpacity onPress={openSheet} accessibilityLabel="Add availability">
          <Ionicons name="add-circle" size={26} color={c.accentGreen} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.tzNote}>Times shown in your device timezone: {zoneShortLabel(tz)}</Text>

        {loading ? (
          <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
        ) : slots.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>You haven't shared any prayer availability yet.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={openSheet}>
              <Text style={styles.emptyBtnText}>Set My Availability</Text>
            </TouchableOpacity>
          </View>
        ) : (
          slots.map((slot) => (
            <View key={slot.id} style={[styles.slotCard, !slot.isActive && styles.slotCardInactive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.slotDay}>{slotLabel(slot)}</Text>
                <Text style={styles.slotTime}>{slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                  <Ionicons name={slot.visibility === "open" ? "earth" : "lock-closed"} size={12} color={c.textMuted} />
                  <Text style={styles.slotVis}>{slot.visibility === "open" ? "Open to peers" : "Private"}</Text>
                </View>
              </View>
              <Switch value={slot.isActive} onValueChange={() => handleToggle(slot)} trackColor={{ false: c.borderBeige, true: c.accentGreen }} thumbColor="#fff" />
              <TouchableOpacity onPress={() => handleDelete(slot)} style={{ marginLeft: 12 }} accessibilityLabel="Delete slot">
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheetBox, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.sheetTitle}>Add Availability</Text>

            <View style={styles.recRow}>
              <TouchableOpacity style={[styles.recBtn, recurrence === "once" && styles.recBtnActive]} onPress={() => setRecurrence("once")}>
                <Text style={[styles.recBtnText, recurrence === "once" && styles.recBtnTextActive]}>One time</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.recBtn, recurrence === "weekly" && styles.recBtnActive]} onPress={() => setRecurrence("weekly")}>
                <Text style={[styles.recBtnText, recurrence === "weekly" && styles.recBtnTextActive]}>Every week</Text>
              </TouchableOpacity>
            </View>

            {recurrence === "once" ? (
              <View style={styles.recRow}>
                <TouchableOpacity style={[styles.recBtn, dateChoice === "today" && styles.recBtnActive]} onPress={() => setDateChoice("today")}>
                  <Text style={[styles.recBtnText, dateChoice === "today" && styles.recBtnTextActive]}>Today</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.recBtn, dateChoice === "tomorrow" && styles.recBtnActive]} onPress={() => setDateChoice("tomorrow")}>
                  <Text style={[styles.recBtnText, dateChoice === "tomorrow" && styles.recBtnTextActive]}>Tomorrow</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.weekdayRow}>
                {WEEKDAYS.map((w) => (
                  <TouchableOpacity key={w.key} style={[styles.weekdayChip, dayOfWeek === w.key && styles.weekdayChipActive]} onPress={() => setDayOfWeek(w.key)}>
                    <Text style={[styles.weekdayChipText, dayOfWeek === w.key && styles.weekdayChipTextActive]}>{w.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.timeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Start (HH:MM)</Text>
                <TextInput style={styles.timeInput} value={startTime} onChangeText={setStartTime} placeholder="21:00" placeholderTextColor={c.textMuted} maxLength={5} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>End (HH:MM)</Text>
                <TextInput style={styles.timeInput} value={endTime} onChangeText={setEndTime} placeholder="21:30" placeholderTextColor={c.textMuted} maxLength={5} />
              </View>
            </View>
            <Text style={styles.tzNote}>Your timezone: {zoneShortLabel(tz)}</Text>

            <View style={[styles.recRow, { marginTop: 10 }]}>
              <TouchableOpacity style={[styles.recBtn, visibility === "open" && styles.recBtnActive]} onPress={() => setVisibility("open")}>
                <Text style={[styles.recBtnText, visibility === "open" && styles.recBtnTextActive]}>Open to peers</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.recBtn, visibility === "private" && styles.recBtnActive]} onPress={() => setVisibility("private")}>
                <Text style={[styles.recBtnText, visibility === "private" && styles.recBtnTextActive]}>Private</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sheetRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSheetOpen(false)} disabled={saving}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center", paddingVertical: 40 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    tzNote: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginBottom: 12 },
    emptyState: { alignItems: "center", paddingVertical: 40, gap: 14 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    emptyBtn: { backgroundColor: c.accentGreen, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
    emptyBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
    slotCard: {
      flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 10,
    },
    slotCardInactive: { opacity: 0.5 },
    slotDay: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    slotTime: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 2 },
    slotVis: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheetBox: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
    sheetTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
    recRow: { flexDirection: "row", gap: 8 },
    recBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    recBtnActive: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
    recBtnText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium" },
    recBtnTextActive: { color: c.accentGreen, fontFamily: "Inter_700Bold" },
    weekdayRow: { flexDirection: "row", justifyContent: "space-between" },
    weekdayChip: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    weekdayChipActive: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
    weekdayChipText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    weekdayChipTextActive: { color: c.accentGreen },
    timeRow: { flexDirection: "row", gap: 10, marginTop: 8 },
    fieldLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
    timeInput: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center",
    },
    sheetRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    cancelBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
    saveBtn: { flex: 1, backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
