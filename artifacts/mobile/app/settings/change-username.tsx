import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Platform, Alert, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { formatUsername, validateUsername, generateUsernameSuggestions } from "@/lib/username";

type UsernameStatus = "idle" | "checking" | "available" | "unavailable";

export default function ChangeUsernameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, updateUsername, checkUsernameAvailable } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<UsernameStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkSeq = useRef(0);

  const nextChangeDate = profile?.usernameChangedAt
    ? new Date(new Date(profile.usernameChangedAt).getTime() + 90 * 24 * 60 * 60 * 1000)
    : null;
  const cooldownActive = !!nextChangeDate && nextChangeDate.getTime() > Date.now();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const clean = formatUsername(username);
    if (!clean) { setStatus("idle"); setMessage(null); setSuggestions([]); return; }
    if (clean === profile?.username) { setStatus("idle"); setMessage("This is your current username"); setSuggestions([]); return; }

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
  }, [username, checkUsernameAvailable, profile?.username]);

  async function handleSave() {
    if (status !== "available") return;
    setSaving(true);
    const err = await updateUsername(formatUsername(username));
    setSaving(false);
    if (err) {
      Alert.alert("Couldn't change username", err);
      return;
    }
    Alert.alert("Username updated", `You're now @${formatUsername(username)}.`);
    router.back();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Change Username" />
      <View style={styles.content}>
        {cooldownActive ? (
          <View style={styles.warningCard}>
            <Ionicons name="time-outline" size={18} color={colors.textMid} />
            <Text style={styles.warningText}>
              You can change your username again on {nextChangeDate!.toLocaleDateString()}. Usernames can only change every 90 days.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.currentLabel}>Current username</Text>
            <Text style={styles.currentValue}>@{profile?.username ?? "not set"}</Text>

            <View style={styles.inputWrap}>
              <Text style={styles.atPrefix}>@</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="new_username"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {status === "checking" && <ActivityIndicator size="small" color={colors.textMuted} style={styles.statusIcon} />}
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

            <View style={styles.noteCard}>
              <Text style={styles.noteText}>
                Your old username will be held for 30 days before anyone else can claim it. You'll be able to change your username again in 90 days.
              </Text>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={status !== "available" || saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save Username</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    currentLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold" },
    currentValue: { fontSize: 20, fontWeight: "700", color: c.accentGreen, marginTop: 4, marginBottom: 20, fontFamily: "Inter_700Bold" },
    inputWrap: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
      borderRadius: 10, paddingHorizontal: 12,
    },
    atPrefix: { fontSize: 15, color: c.textMuted, marginRight: 4, fontFamily: "Inter_600SemiBold" },
    input: { flex: 1, paddingVertical: 12, color: c.textDark, fontSize: 15, fontFamily: "Inter_400Regular" },
    statusIcon: { marginLeft: 8 },
    message: { fontSize: 12, marginTop: 6, fontFamily: "Inter_400Regular" },
    messageOk: { color: c.accentGreen },
    messageBad: { color: "#F87171" },
    suggestionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    suggestionChip: {
      backgroundColor: "rgba(29,158,117,0.08)", borderWidth: 1, borderColor: "rgba(29,158,117,0.3)",
      borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
    },
    suggestionChipText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_500Medium" },
    noteCard: { backgroundColor: c.card, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, padding: 12, marginTop: 20, marginBottom: 20 },
    noteText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    saveBtn: { backgroundColor: c.accentGreen, borderRadius: 12, height: 48, alignItems: "center", justifyContent: "center" },
    saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
    warningCard: {
      flexDirection: "row", gap: 10, alignItems: "flex-start",
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
      borderRadius: 12, padding: 14, marginTop: 10,
    },
    warningText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
  });
}
