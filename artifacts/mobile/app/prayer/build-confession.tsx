import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Switch, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

const TIME_PRESETS = [
  { label: "6:00 AM", hour: 6, minute: 0 },
  { label: "7:00 AM", hour: 7, minute: 0 },
  { label: "8:00 AM", hour: 8, minute: 0 },
  { label: "9:00 AM", hour: 9, minute: 0 },
];

interface LibraryLine { id: string; title: string; prayer_text: string; scripture_reference: string | null }
interface ConfessionLine { scripture_ref: string | null; text: string; declaration: string }

export default function BuildConfessionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [library, setLibrary] = useState<LibraryLine[]>([]);
  const [lines, setLines] = useState<ConfessionLine[]>([]);
  const [customLine, setCustomLine] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [morningNotification, setMorningNotification] = useState(false);
  const [notificationHour, setNotificationHour] = useState(7);
  const [notificationMinute, setNotificationMinute] = useState(0);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const [{ data: lib }, { data: existing }] = await Promise.all([
      supabase.from("p2p_prayer_library").select("id,title,prayer_text,scripture_reference").eq("category", "confession").eq("is_active", true).order("display_order"),
      supabase.from("p2p_personal_confessions").select("*").eq("user_id", profile.id).maybeSingle(),
    ]);
    setLibrary((lib ?? []) as LibraryLine[]);
    if (existing) {
      setLines((existing.confession_lines as ConfessionLine[]) ?? []);
      setMorningNotification(existing.morning_notification ?? false);
      if (existing.notification_time) {
        const [h, m] = (existing.notification_time as string).split(":").map(Number);
        setNotificationHour(h);
        setNotificationMinute(m);
      }
    }
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  function addLibraryLine(item: LibraryLine) {
    if (lines.some((l) => l.declaration === item.prayer_text)) return;
    setLines((prev) => [...prev, { scripture_ref: item.scripture_reference, text: item.title, declaration: item.prayer_text }]);
  }

  function addCustomLine() {
    if (!customLine.trim()) return;
    setLines((prev) => [...prev, { scripture_ref: null, text: "Custom", declaration: customLine.trim() }]);
    setCustomLine("");
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function moveLine(index: number, dir: -1 | 1) {
    setLines((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    if (!profile?.id) return;
    setSaving(true);
    try {
      const timeStr = `${String(notificationHour).padStart(2, "0")}:${String(notificationMinute).padStart(2, "0")}:00`;
      const { error } = await supabase.from("p2p_personal_confessions").upsert(
        {
          user_id: profile.id,
          title: "My Confession",
          confession_lines: lines,
          morning_notification: morningNotification,
          notification_time: morningNotification ? timeStr : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;
      Alert.alert("Saved", "Your confession has been saved.");
      router.back();
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.upperRoomAmber} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>Build My Confession</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHeading}>Available Lines</Text>
        <View style={styles.libraryGrid}>
          {library.map((item) => (
            <TouchableOpacity key={item.id} style={styles.libraryChip} onPress={() => addLibraryLine(item)}>
              <Ionicons name="add-circle-outline" size={14} color={colors.upperRoomAmber} />
              <Text style={styles.libraryChipText} numberOfLines={1}>{item.title}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.customRow}>
          <TextInput
            style={styles.customInput}
            value={customLine}
            onChangeText={setCustomLine}
            placeholder="Add your own declaration..."
            placeholderTextColor={colors.upperRoomMuted}
          />
          <TouchableOpacity style={styles.customAddBtn} onPress={addCustomLine}>
            <Ionicons name="add" size={18} color="#100B06" />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeading}>Your Confession</Text>
        {lines.length === 0 ? (
          <Text style={styles.emptyText}>Add lines above to build your daily confession.</Text>
        ) : (
          lines.map((line, i) => (
            <View key={i} style={styles.lineRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineText}>{line.declaration}</Text>
                {line.scripture_ref ? <Text style={styles.lineRef}>{line.scripture_ref}</Text> : null}
              </View>
              <View style={styles.lineActions}>
                <TouchableOpacity onPress={() => moveLine(i, -1)} disabled={i === 0}>
                  <Ionicons name="arrow-up" size={16} color={i === 0 ? colors.upperRoomBorder : colors.upperRoomMuted} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => moveLine(i, 1)} disabled={i === lines.length - 1}>
                  <Ionicons name="arrow-down" size={16} color={i === lines.length - 1 ? colors.upperRoomBorder : colors.upperRoomMuted} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeLine(i)}>
                  <Ionicons name="close-circle" size={18} color="#C0392B" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {lines.length > 0 && (
          <View style={styles.previewCard}>
            <Text style={styles.previewLabel}>Preview</Text>
            {lines.map((l, i) => <Text key={i} style={styles.previewLine}>{l.declaration}</Text>)}
          </View>
        )}

        <View style={styles.notifRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.notifLabel}>Remind me to confess this each morning</Text>
          </View>
          <Switch value={morningNotification} onValueChange={setMorningNotification} trackColor={{ false: colors.upperRoomBorder, true: colors.upperRoomAmber }} thumbColor="#fff" />
        </View>
        {morningNotification && (
          <View style={styles.timePresetRow}>
            {TIME_PRESETS.map((p) => {
              const active = notificationHour === p.hour && notificationMinute === p.minute;
              return (
                <TouchableOpacity
                  key={p.label}
                  style={[styles.timePresetChip, active && styles.timePresetChipActive]}
                  onPress={() => { setNotificationHour(p.hour); setNotificationMinute(p.minute); }}
                >
                  <Text style={[styles.timePresetText, active && styles.timePresetTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#100B06" size="small" /> : <Text style={styles.saveBtnText}>Save My Confession</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.upperRoomBg },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
    headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: c.upperRoomCream, fontFamily: "Inter_700Bold", textAlign: "center" },
    scroll: { paddingHorizontal: 20 },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.upperRoomMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
    libraryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    libraryChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: c.upperRoomCard, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 7, maxWidth: "48%" },
    libraryChipText: { fontSize: 11, color: c.upperRoomCream, fontFamily: "Inter_500Medium", flexShrink: 1 },
    customRow: { flexDirection: "row", gap: 8, marginTop: 12 },
    customInput: { flex: 1, backgroundColor: c.upperRoomCard, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 10, padding: 10, color: c.upperRoomCream, fontSize: 13, fontFamily: "Inter_400Regular" },
    customAddBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: c.upperRoomAmber, alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 13, color: c.upperRoomMuted, fontFamily: "Inter_400Regular" },
    lineRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.upperRoomCard, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 12, padding: 12, marginBottom: 8 },
    lineText: { fontSize: 13, color: c.upperRoomCream, fontFamily: "Inter_500Medium" },
    lineRef: { fontSize: 11, color: c.upperRoomAmber, fontFamily: "Inter_400Regular", marginTop: 2 },
    lineActions: { flexDirection: "row", gap: 10 },
    previewCard: { backgroundColor: "rgba(224,164,65,0.08)", borderWidth: 1, borderColor: "rgba(224,164,65,0.25)", borderRadius: 14, padding: 16, marginTop: 12, gap: 8 },
    previewLabel: { fontSize: 11, fontWeight: "700", color: c.upperRoomAmber, fontFamily: "Inter_700Bold", textTransform: "uppercase", marginBottom: 4 },
    previewLine: { fontSize: 14, color: c.upperRoomCream, fontFamily: "Inter_400Regular", lineHeight: 21 },
    notifRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 24, backgroundColor: c.upperRoomCard, borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 12, padding: 14 },
    notifLabel: { fontSize: 13, color: c.upperRoomCream, fontFamily: "Inter_500Medium" },
    notifTimeText: { fontSize: 12, color: c.upperRoomAmber, fontFamily: "Inter_600SemiBold", marginTop: 4 },
    timePresetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    timePresetChip: { borderWidth: 1, borderColor: c.upperRoomBorder, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
    timePresetChipActive: { backgroundColor: c.upperRoomAmber, borderColor: c.upperRoomAmber },
    timePresetText: { fontSize: 12, color: c.upperRoomMuted, fontFamily: "Inter_500Medium" },
    timePresetTextActive: { color: "#100B06", fontWeight: "700" },
    timeBtn: { marginTop: 10, alignItems: "center" },
    timeBtnText: { fontSize: 12, color: c.upperRoomAmber, fontFamily: "Inter_500Medium" },
    saveBtn: { backgroundColor: c.upperRoomAmber, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", marginTop: 28 },
    saveBtnText: { color: "#100B06", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}
