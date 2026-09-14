import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { getGathering, createInvitation, type PrayerGathering, type PrayerGatheringParticipant } from "@/lib/prayerCoordinationApi";
import { formatDuration } from "@/lib/prayerTimeDisplay";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Connects outward to EXISTING systems only — no new study/growth/mission
// feature is created here, just navigation into what already exists.
const NEXT_STEPS: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string; route: string }[] = [
  { key: "study", icon: "book-outline", label: "Study Together", route: "/curriculum" },
  { key: "growth", icon: "leaf-outline", label: "Set a Growth Step", route: "/my-discipleship/journey" },
  { key: "mission", icon: "earth-outline", label: "Pray for a Mission", route: "/(tabs)/missions" },
  { key: "testimony", icon: "sparkles-outline", label: "Share a Testimony", route: "/prayer/testimony/record" },
];

export default function PrayerCompleteScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [gathering, setGathering] = useState<PrayerGathering | null>(null);
  const [participants, setParticipants] = useState<PrayerGatheringParticipant[]>([]);
  const [reflection, setReflection] = useState("");
  const [savingReflection, setSavingReflection] = useState(false);
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const [reInviting, setReInviting] = useState<"tomorrow" | "week" | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { gathering: g, participants: p } = await getGathering(id);
        setGathering(g);
        setParticipants(p);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const otherParticipant = participants.find((p) => p.userId !== profile?.id);

  async function handleSaveReflection() {
    if (!reflection.trim() || !profile?.id) return;
    setSavingReflection(true);
    try {
      // Reuses the EXISTING, unmodified private prayer journal table —
      // the exact same insert shape app/(tabs)/prayer.tsx's own
      // logPrayerAction already uses. No second journal is created.
      await supabase.from("p2p_prayer_journal").insert({ user_id: profile.id, prayer_text: reflection.trim(), category: "prayer_together" });
      setReflectionSaved(true);
    } catch (e: any) {
      showAlert("Couldn't save your reflection", e.message ?? "Please try again.");
    } finally {
      setSavingReflection(false);
    }
  }

  async function handlePrayAgain(when: "tomorrow" | "week") {
    if (!gathering || !otherParticipant) return;
    setReInviting(when);
    try {
      const originalStart = new Date(gathering.scheduledStartAt);
      const originalEnd = new Date(gathering.scheduledEndAt);
      const durationMs = originalEnd.getTime() - originalStart.getTime();
      const daysAhead = when === "tomorrow" ? 1 : 7;
      const newStart = new Date(originalStart.getTime() + daysAhead * 24 * 60 * 60 * 1000);
      const newEnd = new Date(newStart.getTime() + durationMs);
      await createInvitation({
        recipientId: otherParticipant.userId, requestId: gathering.requestId ?? undefined,
        proposedStartAt: newStart.toISOString(), proposedEndAt: newEnd.toISOString(), message: gathering.prayerFocus ?? undefined,
      });
      showAlert("Invitation sent", `${otherParticipant.displayName} will be notified.`);
      router.replace("/(tabs)/prayer" as any);
    } catch (e: any) {
      showAlert("Couldn't send a new invitation", e.message ?? "Please try again.");
    } finally {
      setReInviting(null);
    }
  }

  if (loading) {
    return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  }

  const duration = gathering?.actualStartAt && gathering?.actualEndAt
    ? formatDuration(gathering.actualStartAt, gathering.actualEndAt)
    : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 30 }]}>
      <View style={styles.centerWrap}>
        <Text style={styles.emoji}>🙏</Text>
        <Text style={styles.title}>Prayer Complete</Text>
        <Text style={styles.names}>You{otherParticipant ? ` + ${otherParticipant.displayName}` : ""}</Text>
        {duration && <Text style={styles.duration}>{duration}</Text>}
        {!!gathering?.prayerFocus && <Text style={styles.focus}>{gathering.prayerFocus}</Text>}
      </View>

      {!reflectionSaved ? (
        <View style={styles.reflectionCard}>
          <Text style={styles.reflectionLabel}>Save a private reflection? (optional)</Text>
          <TextInput
            style={styles.reflectionInput} value={reflection} onChangeText={setReflection} multiline
            placeholder="What stood out to you?" placeholderTextColor={c.textMuted}
          />
          <TouchableOpacity style={styles.reflectionBtn} onPress={handleSaveReflection} disabled={savingReflection || !reflection.trim()}>
            {savingReflection ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.reflectionBtnText}>Save to My Journal</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.savedText}>Saved to your prayer journal.</Text>
      )}

      {otherParticipant && (
        <View style={styles.againRow}>
          <TouchableOpacity style={styles.againBtn} onPress={() => handlePrayAgain("tomorrow")} disabled={!!reInviting}>
            {reInviting === "tomorrow" ? <ActivityIndicator size="small" color={c.accentGreen} /> : <Text style={styles.againBtnText}>Tomorrow</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.againBtn} onPress={() => handlePrayAgain("week")} disabled={!!reInviting}>
            {reInviting === "week" ? <ActivityIndicator size="small" color={c.accentGreen} /> : <Text style={styles.againBtnText}>This Week</Text>}
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.nextWrap}>
        <Text style={styles.nextTitle}>What would you like to do next?</Text>
        {NEXT_STEPS.map((step) => (
          <TouchableOpacity key={step.key} style={styles.nextRow} onPress={() => router.replace(step.route as any)}>
            <Ionicons name={step.icon} size={18} color={c.accentGreen} />
            <Text style={styles.nextRowText}>{step.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace("/(tabs)/prayer" as any)}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream, paddingHorizontal: 20 },
    centerFill: { alignItems: "center", justifyContent: "center" },
    centerWrap: { alignItems: "center", gap: 4, marginBottom: 20 },
    emoji: { fontSize: 44, marginBottom: 8 },
    title: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    names: { fontSize: 15, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 4 },
    duration: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
    focus: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_500Medium", marginTop: 10, textAlign: "center" },
    reflectionCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginBottom: 16 },
    reflectionLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
    reflectionInput: {
      backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      padding: 10, minHeight: 60, textAlignVertical: "top", color: c.textDark, fontSize: 13, fontFamily: "Inter_400Regular",
    },
    reflectionBtn: { backgroundColor: c.accentGreen, borderRadius: 10, paddingVertical: 10, alignItems: "center", marginTop: 10 },
    reflectionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
    savedText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_500Medium", textAlign: "center", marginBottom: 16 },
    againRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
    againBtn: { flex: 1, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    againBtnText: { color: c.accentGreen, fontSize: 13, fontFamily: "Inter_700Bold" },
    nextWrap: { gap: 10 },
    nextTitle: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_600SemiBold", marginBottom: 4, textAlign: "center" },
    nextRow: {
      flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1,
      borderColor: c.borderBeige, borderRadius: 12, padding: 14,
    },
    nextRowText: { flex: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    doneBtn: { alignItems: "center", paddingVertical: 14, marginTop: 6 },
    doneBtnText: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_500Medium" },
  });
}
