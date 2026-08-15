import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function CreateCohortScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, getProfileByUsername, createCohort, addMemberToCohort } = useData();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leaderUsername, setLeaderUsername] = useState("");
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [leaderCheckStatus, setLeaderCheckStatus] = useState<"idle" | "checking" | "found" | "not_found">("idle");
  const [maxMembers, setMaxMembers] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function checkLeader() {
    if (!leaderUsername.trim()) { setLeaderCheckStatus("idle"); setLeaderId(null); return; }
    setLeaderCheckStatus("checking");
    const result = await getProfileByUsername(leaderUsername.trim().replace(/^@/, ""));
    if (result) { setLeaderId(result.userId); setLeaderCheckStatus("found"); }
    else { setLeaderId(null); setLeaderCheckStatus("not_found"); }
  }

  async function handleCreate() {
    if (!userChurch || !name.trim()) return;
    setSubmitting(true);
    const { cohort, error } = await createCohort(userChurch.id, {
      name: name.trim(), description: description.trim() || undefined,
      leaderId: leaderId ?? undefined, maxMembers: maxMembers ? Number(maxMembers) : undefined,
    });
    if (cohort && leaderId) {
      await addMemberToCohort(userChurch.id, cohort.id, { userId: leaderId });
    }
    setSubmitting(false);
    if (error || !cohort) {
      Alert.alert("Couldn't create cohort", error ?? "Please try again.");
      return;
    }
    router.replace("/church/cohorts" as any);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40, paddingHorizontal: 20 }}>
      <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
        <Ionicons name="arrow-back" size={22} color={colors.textDark} />
      </TouchableOpacity>
      <Text style={styles.title}>Create a Cohort</Text>

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="New Believers" placeholderTextColor={colors.textMuted} />

      <Text style={styles.label}>Description</Text>
      <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} placeholder="What is this cohort for?" placeholderTextColor={colors.textMuted} multiline />

      <Text style={styles.label}>Cohort leader (optional)</Text>
      <View style={styles.searchRow}>
        <Text style={styles.atPrefix}>@</Text>
        <TextInput
          style={styles.searchInput} value={leaderUsername}
          onChangeText={(v) => { setLeaderUsername(v); setLeaderCheckStatus("idle"); }}
          onBlur={checkLeader} placeholder="username" placeholderTextColor={colors.textMuted}
          autoCapitalize="none" autoCorrect={false}
        />
        {leaderCheckStatus === "checking" && <ActivityIndicator size="small" color={colors.textMuted} />}
        {leaderCheckStatus === "found" && <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />}
        {leaderCheckStatus === "not_found" && <Ionicons name="close-circle" size={18} color="#F87171" />}
      </View>

      <Text style={styles.label}>Max members (optional)</Text>
      <TextInput style={styles.input} value={maxMembers} onChangeText={setMaxMembers} placeholder="12" placeholderTextColor={colors.textMuted} keyboardType="number-pad" />

      <TouchableOpacity style={[styles.primaryBtn, !name.trim() && styles.btnDisabled]} onPress={handleCreate} disabled={submitting || !name.trim()}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create Cohort</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  title: { fontSize: 20, fontWeight: "700", color: colors.textDark, marginBottom: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, fontWeight: "700", color: colors.textMid, marginBottom: 8, marginTop: 14, textTransform: "uppercase", fontFamily: "Inter_700Bold" },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  textArea: { minHeight: 70, textAlignVertical: "top" },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 12,
  },
  atPrefix: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_600SemiBold" },
  searchInput: { flex: 1, paddingVertical: 12, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular" },
  primaryBtn: { backgroundColor: colors.accentGreen, borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center", marginTop: 28 },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
});