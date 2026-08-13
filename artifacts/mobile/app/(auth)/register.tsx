import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import colors from "@/constants/colors";
import { MIN_SIGNUP_AGE, isValidCalendarDate, toISODate, ageFromISODate, parseDMY } from "@/lib/dateOfBirth";
import DateOfBirthInput from "@/components/DateOfBirthInput";
import { validateUsername, formatUsername, generateUsernameSuggestions } from "@/lib/username";

type UsernameStatus = "idle" | "checking" | "available" | "unavailable";

const PENDING_INVITE_KEY = "pending_invite_code";

interface InviterNotice {
  username: string;
  fullName: string | null;
  country: string | null;
}

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp, checkUsernameAvailable } = useAuth();

  const [inviterNotice, setInviterNotice] = useState<InviterNotice | null>(null);

  useEffect(() => {
    (async () => {
      const code = await AsyncStorage.getItem(PENDING_INVITE_KEY);
      if (!code) return;
      try {
        const res = await fetch(`${getApiUrl()}/profiles/username/${encodeURIComponent(code)}`);
        if (res.ok) {
          const data = await res.json();
          setInviterNotice({ username: data.username, fullName: data.fullName, country: data.country });
        }
      } catch {
        // Not critical — registration proceeds either way, redemption is
        // attempted silently again after signUp regardless of this preview.
      }
    })();
  }, []);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dob, setDob] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null);
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkSeq = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const clean = formatUsername(username);
    if (!clean) { setUsernameStatus("idle"); setUsernameMessage(null); setUsernameSuggestions([]); return; }

    const localCheck = validateUsername(clean);
    if (!localCheck.valid) {
      setUsernameStatus("unavailable");
      setUsernameMessage(localCheck.error ?? "Invalid username");
      setUsernameSuggestions([]);
      return;
    }

    setUsernameStatus("checking");
    const seq = ++checkSeq.current;
    debounceRef.current = setTimeout(async () => {
      const result = await checkUsernameAvailable(clean);
      if (checkSeq.current !== seq) return; // a newer keystroke already superseded this check
      if (result.available) {
        setUsernameStatus("available");
        setUsernameMessage(`@${clean} is available`);
        setUsernameSuggestions([]);
      } else {
        setUsernameStatus("unavailable");
        const reasonText: Record<string, string> = {
          reserved: "This username is reserved",
          taken: `@${clean} is taken`,
          recently_released: `@${clean} was just released and isn't claimable yet`,
          invalid_format: "Invalid username",
        };
        setUsernameMessage(reasonText[result.reason ?? ""] ?? "That username isn't available");
        setUsernameSuggestions(result.reason === "taken" ? generateUsernameSuggestions(clean) : []);
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [username, checkUsernameAvailable]);

  async function handleRegister() {
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!email.trim()) { setError("Please enter your email."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (usernameStatus !== "available") { setError("Please choose an available username."); return; }

    const parsed = parseDMY(dob);
    if (!parsed || !isValidCalendarDate(parsed.year, parsed.month, parsed.day)) {
      setError("Please enter a valid date in DD.MM.YYYY format");
      return;
    }
    const isoDob = toISODate(parsed.year, parsed.month, parsed.day);
    if (ageFromISODate(isoDob) < MIN_SIGNUP_AGE) {
      setError(`You must be at least ${MIN_SIGNUP_AGE} years old to create an account.`);
      return;
    }

    setLoading(true);
    setError(null);
    const err = await signUp(email.trim(), password, name.trim(), isoDob, formatUsername(username));
    if (err) {
      setLoading(false);
      setError(err);
      return;
    }

    const inviteCode = await AsyncStorage.getItem(PENDING_INVITE_KEY);
    if (inviteCode) {
      try {
        const { data: { user: newUser } } = await supabase.auth.getUser();
        if (newUser) {
          await fetch(`${getApiUrl()}/profiles/invite/redeem`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ inviteCode, newUserId: newUser.id }),
          });
        }
      } catch {
        // Silent fail — never block registration over an invite issue.
      } finally {
        await AsyncStorage.removeItem(PENDING_INVITE_KEY);
      }
    }

    setLoading(false);
    // Go to intake form (sections 1-2 of the registration questionnaire)
    router.replace("/(auth)/intake");
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + (Platform.OS === "web" ? 40 : 24),
          paddingBottom: insets.bottom + 40,
        },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={22} color={colors.lightGreen} />
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Join the Network</Text>
        <Text style={styles.subtitle}>Begin your discipleship journey</Text>
      </View>

      <View style={styles.form}>
        {inviterNotice && (
          <View style={styles.inviteNotice}>
            <Text style={styles.inviteNoticeEmoji}>🌾</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.inviteNoticeTitle}>You were invited by</Text>
              <Text style={styles.inviteNoticeUsername}>@{inviterNotice.username}</Text>
              {(inviterNotice.fullName || inviterNotice.country) && (
                <Text style={styles.inviteNoticeSub}>
                  {inviterNotice.fullName}{inviterNotice.fullName && inviterNotice.country ? " · " : ""}{inviterNotice.country ?? ""}
                </Text>
              )}
            </View>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Choose your username</Text>
          <View style={styles.usernameRow}>
            <Text style={styles.usernamePrefix}>@</Text>
            <TextInput
              style={[styles.input, styles.usernameInput]}
              value={username}
              onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9._]/g, ""))}
              placeholder="kingdomwalker"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {usernameStatus === "checking" && <ActivityIndicator size="small" color={colors.lightGreen} style={styles.usernameStatusIcon} />}
            {usernameStatus === "available" && <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} style={styles.usernameStatusIcon} />}
            {usernameStatus === "unavailable" && <Ionicons name="close-circle" size={20} color="#F87171" style={styles.usernameStatusIcon} />}
          </View>
          {usernameMessage && (
            <Text style={[styles.usernameMessage, usernameStatus === "available" ? styles.usernameMessageOk : styles.usernameMessageBad]}>
              {usernameMessage}
            </Text>
          )}
          {usernameSuggestions.length > 0 && (
            <View style={styles.suggestionsRow}>
              {usernameSuggestions.map((s) => (
                <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => setUsername(s)}>
                  <Text style={styles.suggestionChipText}>@{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="your@email.com"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              placeholder="Min. 6 characters"
              placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword((p) => !p)}
            >
              <Ionicons
                name={showPassword ? "eye-off" : "eye"}
                size={20}
                color={colors.lightGreen}
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Date of Birth</Text>
          <DateOfBirthInput value={dob} onChangeText={setDob} style={styles.input} />
          <Text style={styles.dobNote}>
            We ask this to keep the community safe — it's never shown to other users. You must be {MIN_SIGNUP_AGE}+ to join.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleRegister}
          activeOpacity={0.85}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <Text style={styles.primaryBtnText}>Create Account</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account?</Text>
        <TouchableOpacity onPress={() => router.replace("/(auth)/login")}>
          <Text style={styles.linkText}> Sign in</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  content: { paddingHorizontal: 28 },
  backBtn: { marginBottom: 20 },
  header: { marginBottom: 36 },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.cream,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  subtitle: { color: colors.lightGreen, fontSize: 14, opacity: 0.75, fontFamily: "Inter_400Regular" },
  form: { gap: 16 },
  errorBanner: {
    backgroundColor: "rgba(185,28,28,0.15)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(185,28,28,0.4)",
    padding: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  errorText: { color: "#FCA5A5", fontSize: 13, flex: 1, fontFamily: "Inter_400Regular" },
  inviteNotice: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(29,158,117,0.3)", padding: 14,
  },
  inviteNoticeEmoji: { fontSize: 22 },
  inviteNoticeTitle: { fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  inviteNoticeUsername: { fontSize: 15, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  inviteNoticeSub: { fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2, fontFamily: "Inter_400Regular" },
  inputGroup: { gap: 6 },
  usernameRow: { flexDirection: "row", alignItems: "center" },
  usernamePrefix: { position: "absolute", left: 14, zIndex: 1, color: colors.lightGreen, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  usernameInput: { flex: 1, paddingLeft: 26 },
  usernameStatusIcon: { position: "absolute", right: 14 },
  usernameMessage: { fontSize: 12, marginTop: 2, fontFamily: "Inter_400Regular" },
  usernameMessageOk: { color: colors.accentGreen },
  usernameMessageBad: { color: "#F87171" },
  suggestionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  suggestionChip: { backgroundColor: "rgba(29,158,117,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  suggestionChipText: { color: colors.accentGreen, fontSize: 12, fontFamily: "Inter_500Medium" },
  label: { color: colors.lightGreen, fontSize: 13, opacity: 0.75, fontFamily: "Inter_500Medium" },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 14,
    color: colors.cream,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  passwordRow: { flexDirection: "row", alignItems: "center" },
  eyeBtn: { position: "absolute", right: 14 },
  dobNote: { color: colors.textMuted, fontSize: 12, marginTop: 2, fontFamily: "Inter_400Regular" },
  primaryBtn: {
    backgroundColor: colors.accentGreen,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryBtnText: {
    color: colors.cream,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 32 },
  footerText: { color: colors.textMuted, fontSize: 14, fontFamily: "Inter_400Regular" },
  linkText: { color: colors.accentGreen, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
