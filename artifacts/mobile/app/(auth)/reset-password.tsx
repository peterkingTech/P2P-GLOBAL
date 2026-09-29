import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { supabase } from "@/contexts/AuthContext";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import colors from "@/constants/colors";

// Same minimum this app already enforces everywhere else a password is set
// (app/(auth)/register.tsx and app/settings/account.tsx both use exactly
// this check and this wording) — kept identical rather than invented, per
// the requirement that registration/reset/change-password share one policy.
const MIN_PASSWORD_LENGTH = 6;

type Stage = "verifying" | "expired" | "form" | "success";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isTablet } = useLayout();
  const params = useLocalSearchParams<{ code?: string }>();

  const [stage, setStage] = useState<Stage>("verifying");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Exchanges the recovery `code` the deep link carried for a real session.
  // On success, Supabase's own auth-js (verified against the installed
  // @supabase/auth-js@2.110.0 source) emits a PASSWORD_RECOVERY event —
  // AuthContext listens for exactly that and sets isPasswordRecovery, which
  // is what keeps AuthGate (app/_layout.tsx) from sweeping this screen into
  // the main app. No polling, no setTimeout — this effect runs once, and
  // the rest of the flow is driven by the real SDK event.
  useEffect(() => {
    if (!params.code) {
      setStage("expired");
      return;
    }
    let cancelled = false;
    (async () => {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code as string);
      if (cancelled) return;
      setStage(exchangeError ? "expired" : "form");
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setError(null);
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (updateError) {
      setError("Couldn't update your password. Please try again.");
      return;
    }
    setStage("success");
    // Forgot Password — the recovery session's only job was setting this new
    // password; leaving it active would mean a used, still-valid recovery
    // link keeps someone signed in indefinitely. Signing out here only ever
    // touches THIS screen's own recovery session (never called from anywhere
    // else in the app), fires SIGNED_OUT, which AuthContext uses to clear
    // isPasswordRecovery. Because this screen is still inside the (auth)
    // group, AuthGate's own "not authenticated" branch requires !inAuth to
    // fire, so no automatic navigation happens — the user reaches Sign In
    // only by tapping the button below.
    await supabase.auth.signOut();
  }

  if (stage === "verifying") {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator color={colors.accentGreen} size="large" />
      </View>
    );
  }

  if (stage === "expired") {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.content, isTablet && { maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" as any, width: "100%" }]}>
          <View style={styles.iconCircle}>
            <Ionicons name="time-outline" size={32} color="#FCA5A5" />
          </View>
          <Text style={styles.title}>Reset link expired</Text>
          <Text style={styles.subtitle}>This password reset link is no longer valid. Please request a new one.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/(auth)/forgot-password")} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Request a new reset link</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (stage === "success") {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.content, isTablet && { maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" as any, width: "100%" }]}>
          <View style={styles.iconCircle}>
            <Ionicons name="checkmark-circle-outline" size={32} color={colors.accentGreen} />
          </View>
          <Text style={styles.title}>Password updated successfully</Text>
          <Text style={styles.subtitle}>You can now sign in with your new password.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/(auth)/login")} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 24), paddingBottom: insets.bottom + 40 },
        isTablet && { maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" as any, width: "100%" },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.logoArea}>
        <Text style={styles.title}>Set a new password</Text>
        <Text style={styles.subtitle}>Choose a new password for your account.</Text>
      </View>

      <View style={styles.form}>
        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>New password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry={!showPassword}
              placeholder={`Min. ${MIN_PASSWORD_LENGTH} characters`}
              placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((p) => !p)}>
              <Ionicons name={showPassword ? "eye-off" : "eye"} size={20} color={colors.lightGreen} />
            </TouchableOpacity>
          </View>
          <Text style={styles.inputHint}>At least {MIN_PASSWORD_LENGTH} characters.</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Confirm new password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showConfirmPassword}
              placeholder="Re-enter your new password"
              placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirmPassword((p) => !p)}>
              <Ionicons name={showConfirmPassword ? "eye-off" : "eye"} size={20} color={colors.lightGreen} />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={handleSave} activeOpacity={0.85} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.cream} /> : <Text style={styles.primaryBtnText}>Save New Password</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  centerContent: { justifyContent: "center" },
  content: { paddingHorizontal: 28 },
  logoArea: { alignItems: "center", marginBottom: 40 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(29,158,117,0.12)",
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 20,
  },
  title: {
    fontSize: 22, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14, color: colors.lightGreen, opacity: 0.75, marginTop: 8,
    textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 20,
  },
  form: { gap: 16 },
  errorBanner: {
    backgroundColor: "rgba(185,28,28,0.15)", borderRadius: 10, borderWidth: 1,
    borderColor: "rgba(185,28,28,0.4)", padding: 12, flexDirection: "row", gap: 8, alignItems: "flex-start",
  },
  errorText: { color: "#FCA5A5", fontSize: 13, flex: 1, fontFamily: "Inter_400Regular" },
  inputGroup: { gap: 6 },
  label: { color: colors.lightGreen, fontSize: 13, opacity: 0.75, fontFamily: "Inter_500Medium" },
  inputHint: { color: colors.textMuted, fontSize: 11, marginTop: 2, fontFamily: "Inter_400Regular" },
  input: {
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12, padding: 14, color: colors.cream, fontSize: 15, fontFamily: "Inter_400Regular",
  },
  passwordRow: { flexDirection: "row", alignItems: "center" },
  eyeBtn: { position: "absolute", right: 14 },
  primaryBtn: {
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center", marginTop: 8,
  },
  primaryBtnText: { color: colors.cream, fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
