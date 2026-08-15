import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

// Handles both a bare code typed in by hand and the invite link's trailing
// segment (…/join/church/lighthouse-x7k2m9) if a user pastes the whole URL.
function extractCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/church\/([a-z0-9-]+)\/?$/i);
  return match ? match[1] : trimmed;
}

export default function JoinChurchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code?: string }>();
  const { joinChurch } = useData();
  const [code, setCode] = useState(codeParam ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    const clean = extractCode(code);
    if (!clean) return;
    setSubmitting(true);
    setError(null);
    const { church, error: joinError } = await joinChurch(clean);
    setSubmitting(false);
    if (joinError || !church) {
      setError(joinError ?? "Couldn't join church");
      return;
    }
    router.replace("/church" as any);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 24) }]}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={colors.lightGreen} />
      </TouchableOpacity>
      <Text style={styles.title}>Join Your Church on P2P Global</Text>
      <Text style={styles.subtitle}>Enter your church invite code or link:</Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(v) => { setCode(v); setError(null); }}
        placeholder="lighthouse-zurich-x7k2m9"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.helperText}>Ask your pastor or church admin for the invite code or link.</Text>

      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity style={[styles.primaryBtn, !code.trim() && styles.btnDisabled]} onPress={handleJoin} disabled={submitting || !code.trim()}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Join Church</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg, paddingHorizontal: 28 },
  backBtn: { marginBottom: 20 },
  title: { fontSize: 22, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold", marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.lightGreen, opacity: 0.8, marginBottom: 16, fontFamily: "Inter_400Regular" },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12, padding: 14, color: colors.cream, fontSize: 15, fontFamily: "Inter_400Regular",
  },
  helperText: { fontSize: 12, color: colors.textMuted, marginTop: 8, fontFamily: "Inter_400Regular" },
  errorBanner: {
    flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "rgba(185,28,28,0.15)",
    borderRadius: 10, borderWidth: 1, borderColor: "rgba(185,28,28,0.4)", padding: 12, marginTop: 16,
  },
  errorText: { color: "#FCA5A5", fontSize: 13, flex: 1, fontFamily: "Inter_400Regular" },
  primaryBtn: {
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 52,
    alignItems: "center", justifyContent: "center", marginTop: 24,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
});