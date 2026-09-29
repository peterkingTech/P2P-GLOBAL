import React, { useState } from "react";
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
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { supabase } from "@/contexts/AuthContext";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import colors from "@/constants/colors";

// Same "is this a plausible email" check as everywhere else that validates
// one locally in this app — not a full RFC 5322 validator, just enough to
// catch an obviously malformed/empty submission before hitting the network.
function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isTablet } = useLayout();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address.");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed.toLowerCase(), {
        redirectTo: Linking.createURL("reset-password"),
      });
      // SECURITY: never reveal whether this email has an account — Supabase's
      // own /recover endpoint already returns success regardless for exactly
      // this reason, so a genuine error here is a real problem (rate limit,
      // network, malformed request), not "no such account." Only the rate
      // limit case gets its own distinct message (it doesn't leak account
      // existence — it's purely about request frequency); anything else
      // still shows the same generic success state rather than exposing raw
      // Supabase error text.
      if (resetError && /rate limit/i.test(resetError.message)) {
        setError("Too many attempts. Please wait a few minutes and try again.");
        setLoading(false);
        return;
      }
      setSent(true);
    } catch {
      // A real network/transport failure — still not a signal about the
      // email's validity, just "the request didn't go through."
      setError("Couldn't send the request. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <View style={[styles.container, styles.centerContent, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.content, isTablet && { maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" as any, width: "100%" }]}>
          <View style={styles.iconCircle}>
            <Ionicons name="mail-outline" size={32} color={colors.accentGreen} />
          </View>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a password reset link if an account exists for that email address.
          </Text>
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
        <Text style={styles.title}>Forgot password?</Text>
        <Text style={styles.subtitle}>Enter your email and we'll send you a link to reset it.</Text>
      </View>

      <View style={styles.form}>
        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="hello@email.com"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit} activeOpacity={0.85} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.cream} /> : <Text style={styles.primaryBtnText}>Send Reset Link</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.linkText}>Back to Sign In</Text>
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
  input: {
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12, padding: 14, color: colors.cream, fontSize: 15, fontFamily: "Inter_400Regular",
  },
  primaryBtn: {
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center", marginTop: 8,
  },
  primaryBtnText: { color: colors.cream, fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 32 },
  linkText: { color: colors.accentGreen, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
