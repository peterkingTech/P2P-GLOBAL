import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useData, PublicUserProfile } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const ROLE_OPTIONS: { value: string; label: string; needsZone?: boolean; needsCountry?: boolean }[] = [
  { value: "admin_zone", label: "Zone Admin", needsZone: true },
  { value: "admin_national", label: "National Admin", needsCountry: true },
  { value: "admin_content", label: "Content Admin" },
  { value: "admin_translation", label: "Translation Admin" },
  { value: "admin_moderation", label: "Moderation Admin" },
  { value: "admin_verification", label: "Verification Admin" },
  { value: "admin_help", label: "Help Request Admin" },
  { value: "admin_username", label: "Username Admin" },
  { value: "admin_finance", label: "Finance Admin" },
  { value: "admin_marketing", label: "Marketing Admin" },
  { value: "admin_church", label: "Church Portal Admin" },
];

const ZONES = ["europe", "africa", "asia", "americas", "oceania", "middle_east"];

export default function AppointAdminScreen() {
  const router = useRouter();
  const { getProfileByUsername, appointAdmin } = useData();

  const [username, setUsername] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<PublicUserProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSearch() {
    if (!username.trim()) return;
    setSearching(true);
    setNotFound(false);
    setFound(null);
    const result = await getProfileByUsername(username.trim().replace(/^@/, ""));
    setSearching(false);
    if (result) setFound(result);
    else setNotFound(true);
  }

  const selectedRole = ROLE_OPTIONS.find((r) => r.value === role);

  async function handleAppoint() {
    if (!found || !role || !reason.trim()) return;
    if (selectedRole?.needsZone && !zone) {
      Alert.alert("Zone required", "Select a zone for this role.");
      return;
    }
    if (selectedRole?.needsCountry && !country.trim()) {
      Alert.alert("Country required", "Enter a country for this role.");
      return;
    }
    setSubmitting(true);
    const err = await appointAdmin(found.username, role, {
      adminZone: selectedRole?.needsZone ? zone ?? undefined : undefined,
      adminCountry: selectedRole?.needsCountry ? country.trim() : undefined,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (err) {
      Alert.alert("Couldn't appoint admin", err);
      return;
    }
    Alert.alert(
      "Admin appointed",
      `@${found.username} has been appointed as ${selectedRole?.label}. They have been notified.`,
      [{ text: "OK", onPress: () => router.back() }]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Add New Admin</Text>

      <Text style={styles.label}>Find user by username</Text>
      <View style={styles.searchRow}>
        <Text style={styles.atPrefix}>@</Text>
        <TextInput
          style={styles.searchInput}
          value={username}
          onChangeText={setUsername}
          placeholder="username"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleSearch}
        />
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={searching}>
          {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.searchBtnText}>Search</Text>}
        </TouchableOpacity>
      </View>

      {notFound && <Text style={styles.notFoundText}>No user found with that username.</Text>}

      {found && (
        <View style={styles.foundCard}>
          <Ionicons name="checkmark-circle" size={18} color={colors.accentGreen} />
          <View>
            <Text style={styles.foundName}>@{found.username}</Text>
            <Text style={styles.foundSub}>{found.fullName ?? "Unnamed"} {found.country ? `· ${found.country}` : ""} {found.isVerified ? "· Verified" : ""}</Text>
          </View>
        </View>
      )}

      {found && (
        <>
          <Text style={styles.label}>Select role</Text>
          {ROLE_OPTIONS.map((opt) => (
            <TouchableOpacity key={opt.value} style={styles.roleRow} onPress={() => setRole(opt.value)}>
              <Ionicons name={role === opt.value ? "radio-button-on" : "radio-button-off"} size={18} color={role === opt.value ? colors.accentGreen : colors.textMuted} />
              <Text style={styles.roleLabel}>{opt.label}</Text>
            </TouchableOpacity>
          ))}

          {selectedRole?.needsZone && (
            <>
              <Text style={styles.label}>Zone</Text>
              <View style={styles.zoneRow}>
                {ZONES.map((z) => (
                  <TouchableOpacity key={z} style={[styles.zoneChip, zone === z && styles.zoneChipActive]} onPress={() => setZone(z)}>
                    <Text style={[styles.zoneChipText, zone === z && styles.zoneChipTextActive]}>{z.replace("_", " ")}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {selectedRole?.needsCountry && (
            <>
              <Text style={styles.label}>Country</Text>
              <TextInput style={styles.input} value={country} onChangeText={setCountry} placeholder="Country" placeholderTextColor={colors.textMuted} />
            </>
          )}

          <Text style={styles.label}>Appointment reason (internal, not shown to admin)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={reason}
            onChangeText={setReason}
            placeholder="Why is this appointment being made?"
            placeholderTextColor={colors.textMuted}
            multiline
          />

          <TouchableOpacity style={styles.appointBtn} onPress={handleAppoint} disabled={submitting || !role || !reason.trim()}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.appointBtnText}>Appoint as Admin</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { padding: 20, gap: 6 },
  title: { fontSize: 20, fontWeight: "700", color: colors.textDark, marginBottom: 16, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, fontWeight: "700", color: colors.textMid, marginTop: 16, marginBottom: 8, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  atPrefix: { fontSize: 15, color: colors.textMuted, fontFamily: "Inter_600SemiBold" },
  searchInput: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textDark, fontFamily: "Inter_400Regular",
  },
  searchBtn: { backgroundColor: colors.accentGreen, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  searchBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  notFoundText: { color: "#B91C1C", fontSize: 12, marginTop: 8, fontFamily: "Inter_400Regular" },
  foundCard: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(29,158,117,0.08)",
    borderWidth: 1, borderColor: "rgba(29,158,117,0.3)", borderRadius: 12, padding: 12, marginTop: 10,
  },
  foundName: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  foundSub: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  roleLabel: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  zoneRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  zoneChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  zoneChipActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  zoneChipText: { fontSize: 12, color: colors.textMid, textTransform: "capitalize", fontFamily: "Inter_500Medium" },
  zoneChipTextActive: { color: "#fff", fontWeight: "700" },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: colors.textDark, fontFamily: "Inter_400Regular",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  appointBtn: { backgroundColor: colors.accentGreen, borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center", marginTop: 24 },
  appointBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
});