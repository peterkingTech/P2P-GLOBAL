import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData, ChurchMemberProfile } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const STAGE_LABELS: Record<string, string> = {
  dormant_seed: "Dormant Seed", sprout: "Sprout", young_tree: "Young Tree",
  fruitful_tree: "Fruitful Tree", forest_builder: "Forest Builder", forest_of_nations: "Forest of Nations",
};

export default function ChurchMemberProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { userChurch, getChurchMemberProfile, updateChurchMemberNotes } = useData();
  const [profile, setProfile] = useState<ChurchMemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const load = useCallback(async () => {
    if (!userChurch || !userId) return;
    setLoading(true);
    const data = await getChurchMemberProfile(userChurch.id, userId);
    setProfile(data);
    setNotes(data?.adminNotes ?? "");
    setLoading(false);
  }, [userChurch, userId, getChurchMemberProfile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleSaveNotes() {
    if (!userChurch || !userId) return;
    setSavingNotes(true);
    const err = await updateChurchMemberNotes(userChurch.id, userId, notes);
    setSavingNotes(false);
    if (err) Alert.alert("Couldn't save note", err);
  }

  if (loading || !profile) {
    return (
      <View style={[styles.container, styles.centerFill]}><ActivityIndicator color={colors.accentGreen} /></View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40, paddingHorizontal: 20 }}>
      <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
        <Ionicons name="arrow-back" size={22} color={colors.textDark} />
      </TouchableOpacity>

      <View style={styles.avatarCircle}><Ionicons name="person" size={28} color={colors.primaryGreen} /></View>
      <Text style={styles.username}>@{profile.username ?? "unknown"}</Text>
      <Text style={styles.displayName}>{profile.displayName} {profile.country ? `· ${profile.country}` : ""}</Text>

      <Text style={styles.sectionTitle}>Kingdom School Progress</Text>
      <View style={styles.card}>
        <Text style={styles.stageText}>{STAGE_LABELS[profile.treeStage] ?? profile.treeStage}</Text>
        <Text style={styles.metaText}>Last active: {profile.lastActiveAt ? new Date(profile.lastActiveAt).toLocaleDateString() : "Never"}</Text>
      </View>

      <Text style={styles.sectionTitle}>Peer Guide Relationship</Text>
      <View style={styles.card}>
        {profile.peerGuide ? (
          <Text style={styles.metaText}>Peer guide: @{profile.peerGuide.username} {profile.peerGuide.country ? `· ${profile.peerGuide.country}` : ""}</Text>
        ) : (
          <Text style={styles.metaText}>No peer guide assigned yet</Text>
        )}
        <Text style={styles.metaText}>Guiding: {profile.guidingCount} member{profile.guidingCount === 1 ? "" : "s"} · {profile.nationsGuided} nation{profile.nationsGuided === 1 ? "" : "s"}</Text>
      </View>

      <Text style={styles.sectionTitle}>Achievements</Text>
      <View style={styles.card}>
        <Text style={styles.metaText}>🍇 {profile.fruits.length} Fruits earned</Text>
        <Text style={styles.metaText}>🌾 {profile.grainCount} Grain planted</Text>
      </View>

      {profile.cohorts.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Cohorts</Text>
          <View style={styles.card}>
            {profile.cohorts.map((c) => (
              <Text key={c.cohortId} style={styles.metaText}>{c.name} · {c.status}</Text>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>Leadership Private Notes</Text>
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Add a private note (only visible to leadership)..."
        placeholderTextColor={colors.textMuted}
        multiline
      />
      <TouchableOpacity style={styles.saveNotesBtn} onPress={handleSaveNotes} disabled={savingNotes}>
        {savingNotes ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveNotesBtnText}>Save Note</Text>}
      </TouchableOpacity>

      <View style={styles.privacyNote}>
        <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
        <Text style={styles.privacyNoteText}>This view does not show session content, assignment answers, or private reflections. Member privacy is protected.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { alignItems: "center", justifyContent: "center" },
  avatarCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  username: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  displayName: { fontSize: 13, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.textMid, marginTop: 20, marginBottom: 8, textTransform: "uppercase", fontFamily: "Inter_700Bold" },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14, gap: 6 },
  stageText: { fontSize: 15, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  metaText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
  notesInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 12, fontSize: 13, color: colors.textDark, minHeight: 80, textAlignVertical: "top", fontFamily: "Inter_400Regular",
  },
  saveNotesBtn: { backgroundColor: colors.accentGreen, borderRadius: 10, height: 42, alignItems: "center", justifyContent: "center", marginTop: 10 },
  saveNotesBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  privacyNote: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 24, padding: 12, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige },
  privacyNoteText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 16, fontFamily: "Inter_400Regular" },
});