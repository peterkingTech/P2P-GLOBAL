import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Switch, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { createPrayerRequest, type PrayerMode, type PrayerRequestVisibility } from "@/lib/prayerCoordinationApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const MODES: { key: PrayerMode; label: string; hint: string }[] = [
  { key: "pray_for_me", label: "Pray for me", hint: "Peers can pray for this on their own" },
  { key: "pray_with_me", label: "Pray with me", hint: "Peers can join you live to pray together" },
  { key: "both", label: "Both", hint: "Either — whatever a peer feels led to do" },
];

// "Would anyone like to pray with me?" — a genuine coordination request, not
// a social post. Deliberately has no date/time field: the actual "when"
// is discovered through availability matching (Pray Now / a peer's
// published slot), not typed in here — this screen only captures the WHAT.
export default function PrayWithMeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  // Stage 5 — an explicit Mission → Prayer connection point: opening this
  // screen with ?missionId=&missionTitle= (from a future "Pray for this
  // Mission" entry point) pre-fills the focus and links the created
  // request back to that mission (p2p_prayer_coord_requests.mission_id).
  const { missionId, missionTitle } = useLocalSearchParams<{ missionId?: string; missionTitle?: string }>();
  // Pray the Word Stage 7 — a Scripture flow's "Pray With Me" button
  // routes here with ?scriptureRef=&topicTitle= rather than a second
  // peer-invitation system; this only pre-fills existing fields.
  const { scriptureRef, topicTitle } = useLocalSearchParams<{ scriptureRef?: string; topicTitle?: string }>();

  const [title, setTitle] = useState(missionTitle ? `Pray for ${missionTitle}` : topicTitle ? `Pray for ${topicTitle}` : "");
  const [prayerPoint, setPrayerPoint] = useState("");
  const [scripture, setScripture] = useState(scriptureRef ?? "");
  const [mode, setMode] = useState<PrayerMode>("both");
  const [visibility, setVisibility] = useState<PrayerRequestVisibility>("open");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!title.trim() || !prayerPoint.trim()) return;
    setSubmitting(true);
    try {
      await createPrayerRequest({
        title: title.trim(), prayerPoint: prayerPoint.trim(),
        scriptureReference: scripture.trim() ? { reference: scripture.trim() } : null,
        prayerMode: mode, visibility, isAnonymous, missionId: missionId ?? null,
      });
      router.back();
    } catch (e: any) {
      showAlert("Couldn't create your prayer request", e.message ?? "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Pray With Me</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.intro}>Would anyone like to pray with you? Share what's on your heart — peers who are free will be able to reach out.</Text>

        <Text style={styles.fieldLabel}>Prayer Focus</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. My family" placeholderTextColor={c.textMuted} maxLength={80} />

        <Text style={styles.fieldLabel}>Prayer Point</Text>
        <TextInput
          style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} value={prayerPoint} onChangeText={setPrayerPoint} multiline
          placeholder="What would you like prayer for?" placeholderTextColor={c.textMuted}
        />

        <Text style={styles.fieldLabel}>Scripture (optional)</Text>
        <TextInput style={styles.input} value={scripture} onChangeText={setScripture} placeholder="e.g. Philippians 4:6-7" placeholderTextColor={c.textMuted} />

        <Text style={styles.fieldLabel}>What kind of prayer?</Text>
        {MODES.map((m) => (
          <TouchableOpacity key={m.key} style={styles.modeRow} onPress={() => setMode(m.key)}>
            <Ionicons name={mode === m.key ? "radio-button-on" : "radio-button-off"} size={20} color={c.accentGreen} />
            <View style={{ flex: 1 }}>
              <Text style={styles.modeLabel}>{m.label}</Text>
              <Text style={styles.modeHint}>{m.hint}</Text>
            </View>
          </TouchableOpacity>
        ))}

        <Text style={styles.fieldLabel}>Who can see this?</Text>
        <View style={styles.visRow}>
          <TouchableOpacity style={[styles.visBtn, visibility === "open" && styles.visBtnActive]} onPress={() => setVisibility("open")}>
            <Ionicons name="earth" size={14} color={visibility === "open" ? c.accentGreen : c.textMuted} />
            <Text style={[styles.visBtnText, visibility === "open" && styles.visBtnTextActive]}>Open to peers</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.visBtn, visibility === "private" && styles.visBtnActive]} onPress={() => setVisibility("private")}>
            <Ionicons name="lock-closed" size={14} color={visibility === "private" ? c.accentGreen : c.textMuted} />
            <Text style={[styles.visBtnText, visibility === "private" && styles.visBtnTextActive]}>Private (invite only)</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.anonRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.anonLabel}>Post anonymously</Text>
            <Text style={styles.modeHint}>Your name won't be shown to peers</Text>
          </View>
          <Switch value={isAnonymous} onValueChange={setIsAnonymous} trackColor={{ false: c.borderBeige, true: c.accentGreen }} thumbColor="#fff" />
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting || !title.trim() || !prayerPoint.trim()}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Share Prayer Request</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    intro: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 18 },
    fieldLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 14, marginBottom: 6 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular",
    },
    modeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    modeLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    modeHint: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    visRow: { flexDirection: "row", gap: 8 },
    visBtn: {
      flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
      paddingVertical: 10, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
    },
    visBtnActive: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
    visBtnText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    visBtnTextActive: { color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    anonRow: {
      flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18, padding: 12,
      borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
    },
    anonLabel: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    submitBtn: { backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 24 },
    submitBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  });
}
