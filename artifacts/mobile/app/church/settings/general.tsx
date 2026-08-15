import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const DESCRIPTION_MAX = 280;

export default function ChurchGeneralSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchCreator, updateChurch, loadUserChurch } = useData();
  const [name, setName] = useState(userChurch?.name ?? "");
  const [description, setDescription] = useState(userChurch?.description ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!userChurch || !name.trim()) return;
    setSaving(true);
    const { error } = await updateChurch(userChurch.id, { name: name.trim(), description: description.trim() });
    setSaving(false);
    if (error) { Alert.alert("Couldn't save", error); return; }
    await loadUserChurch();
    Alert.alert("Saved", "Church details updated.");
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.headerTitle}>General</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!isChurchCreator && (
          <View style={styles.lockBanner}>
            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
            <Text style={styles.lockBannerText}>Only the General Overseer can change this.</Text>
          </View>
        )}

        <Text style={styles.label}>Church / Ministry Name *</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} editable={isChurchCreator} placeholderTextColor={colors.textMuted} />

        <Text style={[styles.label, { marginTop: 16 }]}>Tell us about your church</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={(v) => setDescription(v.slice(0, DESCRIPTION_MAX))}
          editable={isChurchCreator}
          multiline
          placeholder="A local Christian community focused on biblical discipleship, prayer and serving our community."
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.charCounter}>{description.length}/{DESCRIPTION_MAX}</Text>

        {isChurchCreator && (
          <TouchableOpacity style={[styles.saveBtn, !name.trim() && styles.saveBtnDisabled]} onPress={handleSave} disabled={saving || !name.trim()}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { padding: 20, paddingBottom: 60 },
  lockBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12, marginBottom: 16,
  },
  lockBannerText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  label: { fontSize: 13, color: colors.textMid, marginBottom: 6, fontFamily: "Inter_500Medium" },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    padding: 14, color: colors.textDark, fontSize: 15, fontFamily: "Inter_400Regular",
  },
  textArea: { minHeight: 90, textAlignVertical: "top" },
  charCounter: { fontSize: 11, color: colors.textMuted, textAlign: "right", marginTop: 4, fontFamily: "Inter_400Regular" },
  saveBtn: { backgroundColor: colors.accentGreen, borderRadius: 12, height: 50, alignItems: "center", justifyContent: "center", marginTop: 24 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
});