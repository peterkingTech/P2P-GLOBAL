import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth, supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

const LOGO = require("@/assets/images/logo.png");

const ADMIN_ROLES = new Set(["mentor", "elder"]);

export default function AdminLoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, isAuthenticated, profile, isLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState(false);

  // If already authenticated as an admin, send straight to dashboard
  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated && profile) {
      if (ADMIN_ROLES.has(profile.role)) {
        router.replace("/admin/curriculum");
      }
      // Non-admin who somehow landed here → do nothing; they'll see a neutral screen
    }
  }, [isLoading, isAuthenticated, profile]);

  async function handleAdminLogin() {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);
    setError(null);
    setRoleError(false);

    // Step 1: sign in normally
    const signInError = await signIn(email.trim(), password);
    if (signInError) {
      setError(signInError);
      setLoading(false);
      return;
    }

    // Step 2: fetch the profile role directly — don't rely on async context update
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;

    if (!userId) {
      setError("Authentication failed. Please try again.");
      setLoading(false);
      return;
    }

    const { data: profileRow, error: profileErr } = await supabase
      .from("p2p_profiles")
      .select("role")
      .eq("id", userId)
      .single();

    setLoading(false);

    if (profileErr || !profileRow) {
      setError("Could not verify your account. Please try again.");
      // Sign out so we don't leave the user in a broken state
      await supabase.auth.signOut();
      return;
    }

    const role = profileRow.role as string;

    if (!ADMIN_ROLES.has(role)) {
      // Role check failed — sign them back out and show a clear message
      await supabase.auth.signOut();
      setRoleError(true);
      return;
    }

    // Admin confirmed → go to dashboard
    router.replace("/admin/curriculum");
  }

  const topPad = insets.top + (Platform.OS === "web" ? 40 : 24);

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad, paddingBottom: insets.bottom + 40 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Back link to regular login */}
      <TouchableOpacity
        style={styles.backRow}
        onPress={() => router.replace("/(auth)/login")}
      >
        <Ionicons name="arrow-back" size={18} color="rgba(255,255,255,0.5)" />
        <Text style={styles.backText}>Regular login</Text>
      </TouchableOpacity>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoWrap}>
          <Image source={LOGO} style={styles.logo} />
          <View style={styles.adminBadge}>
            <Ionicons name="shield-checkmark" size={12} color="#fff" />
            <Text style={styles.adminBadgeText}>Admin</Text>
          </View>
        </View>
        <Text style={styles.title}>Admin Sign In</Text>
        <Text style={styles.subtitle}>Mentors and elders only</Text>
      </View>

      {/* Role error — clear, non-alarming message */}
      {roleError && (
        <View style={styles.roleErrorBox}>
          <Ionicons name="lock-closed" size={20} color="#FBBF24" />
          <View style={{ flex: 1 }}>
            <Text style={styles.roleErrorTitle}>No admin access</Text>
            <Text style={styles.roleErrorBody}>
              Your account authenticated successfully, but it doesn't have an
              admin role. If you believe this is a mistake, contact your
              network leader.
            </Text>
          </View>
        </View>
      )}

      {/* Auth error */}
      {error && !roleError && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Form */}
      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(v) => { setEmail(v); setRoleError(false); setError(null); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="admin@example.com"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={password}
              onChangeText={(v) => { setPassword(v); setRoleError(false); setError(null); }}
              secureTextEntry={!showPassword}
              placeholder="••••••••"
              placeholderTextColor="rgba(255,255,255,0.3)"
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword((p) => !p)}
            >
              <Ionicons
                name={showPassword ? "eye-off" : "eye"}
                size={20}
                color="rgba(255,255,255,0.4)"
              />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, loading && { opacity: 0.75 }]}
          onPress={handleAdminLogin}
          activeOpacity={0.85}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="shield-checkmark" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Sign in to Admin</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        This portal is restricted to network mentors and elders. Regular
        members should use the standard sign-in page.
      </Text>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#05100C" },
  content: { paddingHorizontal: 28 },

  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 24,
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.45)",
    fontFamily: "Inter_400Regular",
  },

  header: { alignItems: "center", marginBottom: 36 },
  logoWrap: { position: "relative", marginBottom: 16 },
  logo: { width: 72, height: 72, borderRadius: 16 },
  adminBadge: {
    position: "absolute",
    bottom: -6,
    right: -6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.primaryGreen,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 2,
    borderColor: "#05100C",
  },
  adminBadgeText: {
    fontSize: 10,
    color: "#fff",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.cream,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.45)",
    fontFamily: "Inter_400Regular",
  },

  // Role error (amber, informational — not an alarm)
  roleErrorBox: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    backgroundColor: "rgba(251,191,36,0.1)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  roleErrorTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FBBF24",
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  roleErrorBody: {
    fontSize: 13,
    color: "rgba(251,191,36,0.8)",
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },

  errorBanner: {
    backgroundColor: "rgba(185,28,28,0.15)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(185,28,28,0.4)",
    padding: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    marginBottom: 16,
  },
  errorText: {
    color: "#FCA5A5",
    fontSize: 13,
    flex: 1,
    fontFamily: "Inter_400Regular",
  },

  form: { gap: 16 },
  inputGroup: { gap: 6 },
  label: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 14,
    color: colors.cream,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  passwordRow: { flexDirection: "row", alignItems: "center" },
  eyeBtn: { position: "absolute", right: 14 },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primaryGreen,
    borderRadius: 14,
    height: 54,
    marginTop: 8,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  hint: {
    fontSize: 12,
    color: "rgba(255,255,255,0.25)",
    textAlign: "center",
    marginTop: 32,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
});
