import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function ChurchProfileSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchCreator, updateChurch, loadUserChurch } = useData();
  const [city, setCity] = useState(userChurch?.city ?? "");
  const [country, setCountry] = useState(userChurch?.country ?? "");
  const [website, setWebsite] = useState(userChurch?.website ?? "");
  const [contactName, setContactName] = useState(userChurch?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(userChurch?.contactEmail ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!userChurch || !country.trim()) return;
    setSaving(true);
    const { error } = await updateChurch(userChurch.id, {
      city: city.trim(), country: country.trim(), website: website.trim(),
      contactName: contactName.trim(), contactEmail: contactEmail.trim(),
    });
    setSaving(false);
    if (error) { Alert.alert("Couldn't save", error); return; }
    await loadUserChurch();
    Alert.alert("Saved", "Church profile updated.");
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!isChurchCreator && (
          <View style={styles.lockBanner}>
            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
            <Text style={styles.lockBannerText}>Only the General Overseer can change this.</Text>
          </View>
        )}

        <Field label="City" value={city} onChangeText={setCity} editable={isChurchCreator} />
        <Field label="Country *" value={country} onChangeText={setCountry} editable={isChurchCreator} />
        <Field label="Official Website" value={website} onChangeText={setWebsite} editable={isChurchCreator} autoCapitalize="none" placeholder="https://www.examplechurch.org" />
        <Field label="Contact Name" value={contactName} onChangeText={setContactName} editable={isChurchCreator} />
        <Field label="Contact Email" value={contactEmail} onChangeText={setContactEmail} editable={isChurchCreator} autoCapitalize="none" keyboardType="email-address" placeholder="contact@example.org" />

        {isChurchCreator && (
          <TouchableOpacity style={[styles.saveBtn, !country.trim() && styles.saveBtnDisabled]} onPress={handleSave} disabled={saving || !country.trim()}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function Field(props: { label: string; value: string; onChangeText: (v: string) => void; editable?: boolean; autoCapitalize?: any; keyboardType?: any; placeholder?: string }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={[styles.input, !props.editable && styles.inputDisabled]}
        value={props.value}
        onChangeText={props.onChangeText}
        editable={props.editable}
        autoCapitalize={props.autoCapitalize ?? "words"}
        keyboardType={props.keyboardType}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textMuted}
      />
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
  inputDisabled: { opacity: 0.6 },
  saveBtn: { backgroundColor: colors.accentGreen, borderRadius: 12, height: 50, alignItems: "center", justifyContent: "center", marginTop: 8 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
});