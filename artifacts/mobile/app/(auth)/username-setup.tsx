import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { validateUsername, formatUsername, generateUsernameSuggestions } from "@/lib/username";

// Mandatory, unskippable username-setup step for accounts that predate the
// @username system, or that an admin has force-flagged via Admin >
// Usernames (see AuthGate's needsUsernameSetup check in app/_layout.tsx).
type UsernameStatus = "idle" | "checking" | "available" | "unavailable";

export default function UsernameSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, updateUsername, checkUsernameAvailable, refreshProfile, signOut } = useAuth();

  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<UsernameStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkSeq = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const clean = formatUsername(username);
    if (!clean) { setStatus("idle"); setMessage(null); setSuggestions([]); return; }

    const localCheck = validateUsername(clean);
    if (!localCheck.valid) {
      setStatus("unavailable");
      setMessage(localCheck.error ?? "Invalid username");
      setSuggestions([]);
      return;
    }

    setStatus("checking");
    const seq = ++checkSeq.current;
    debounceRef.current = setTimeout(async () => {
      const result = await checkUsernameAvailable(clean);
      if (checkSeq.current !== seq) return;
      if (result.available) {
        setStatus("available");
        setMessage(`@${clean} is available`);
        setSuggestions([]);
      } else {
        setStatus("unavailable");
        const reasonText: Record<string, string> = {
          reserved: "This username is reserved",
          taken: `@${clean} is taken`,
          recently_released: `@${clean} was just released and isn't claimable yet`,
          invalid_format: "Invalid username",
          network_error: "Couldn't reach the server to check this — check your connection and try again",
        };
        setMessage(reasonText[result.reason ?? ""] ?? "That username isn't available");
        setSuggestions(result.reason === "taken" ? generateUsernameSuggestions(clean) : []);
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [username, checkUsernameAvailable]);

  async function handleContinue() {
    if (status !== "available") return;
    setSaving(true);
    const err = await updateUsername(formatUsername(username));
    setSaving(false);
    if (err) {
      Alert.alert("Couldn't save username", err);
      return;
    }
    await refreshProfile();
    router.replace("/(tabs)" as any);
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40, paddingHorizontal: 24, flexGrow: 1 }}
      bottomOffset={40}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="at-circle" size={40} color={colors.accentGreen} />
      </View>
      <Text style={styles.title}>Choose your username</Text>
      <Text style={styles.subtitle}>
        P2P Global now uses @usernames for profiles, search, and circles. Pick one to continue{profile?.displayName ? `, ${profile.displayName}` : ""} — you can change it again in 90 days.
      </Text>

      <View style={styles.inputGroup}>
        <View style={styles.usernameRow}>
          <Text style={styles.usernamePrefix}>@</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9._]/g, ""))}
            placeholder=""
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          {status === "checking" && <ActivityIndicator size="small" color={colors.lightGreen} style={styles.statusIcon} />}
          {status === "available" && <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} style={styles.statusIcon} />}
          {status === "unavailable" && <Ionicons name="close-circle" size={20} color="#F87171" style={styles.statusIcon} />}
        </View>
        {message && (
          <Text style={[styles.message, status === "available" ? styles.messageOk : styles.messageBad]}>{message}</Text>
        )}
        {suggestions.length > 0 && (
          <View style={styles.suggestionRow}>
            {suggestions.map((s) => (
              <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => setUsername(s)}>
                <Text style={styles.suggestionChipText}>@{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.continueBtn} onPress={handleContinue} disabled={status !== "available" || saving}>
        {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.continueBtnText}>Continue</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
        <Text style={styles.signOutBtnText}>Sign out</Text>
      </TouchableOpacity>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  iconWrap: { alignItems: "center", marginBottom: 16 },
  title: { fontSize: 22, fontWeight: "700", color: colors.textDark, textAlign: "center", marginBottom: 8, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20, marginBottom: 28, fontFamily: "Inter_400Regular" },
  inputGroup: { marginBottom: 20 },
  usernameRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.card ?? "#fff", borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, paddingHorizontal: 14,
  },
  usernamePrefix: { fontSize: 16, color: colors.textMuted, marginRight: 4, fontFamily: "Inter_600SemiBold" },
  input: { flex: 1, paddingVertical: 14, color: colors.textDark, fontSize: 16, fontFamily: "Inter_400Regular" },
  statusIcon: { marginLeft: 8 },
  message: { fontSize: 12, marginTop: 6, fontFamily: "Inter_400Regular" },
  messageOk: { color: colors.accentGreen },
  messageBad: { color: "#F87171" },
  suggestionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  suggestionChip: {
    backgroundColor: "rgba(29,158,117,0.08)", borderWidth: 1, borderColor: "rgba(29,158,117,0.3)",
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
  },
  suggestionChipText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium" },
  continueBtn: { backgroundColor: colors.accentGreen, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  continueBtnText: { color: "#fff", fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  signOutBtn: { alignItems: "center", marginTop: 20 },
  signOutBtnText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_500Medium" },
});
