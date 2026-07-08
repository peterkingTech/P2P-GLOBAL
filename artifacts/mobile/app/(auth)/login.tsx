import React, { useState } from "react";
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

const LOGO = require("@/assets/images/logo.png");
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    const err = await signIn(email.trim(), password);
    setLoading(false);
    if (err) setError(err);
    else router.replace("/(tabs)");
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
      {/* Logo */}
      <View style={styles.logoArea}>
        <Image source={LOGO} style={styles.logoImg} />
        <Text style={styles.appName}>P2P Bible Study</Text>
        <Text style={styles.tagline}>Welcome back</Text>
      </View>

      {/* Form */}
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
              placeholder="••••••••"
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

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleLogin}
          activeOpacity={0.85}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <Text style={styles.primaryBtnText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>New here?</Text>
        <TouchableOpacity onPress={() => router.push("/(auth)/register")}>
          <Text style={styles.linkText}> Create an account</Text>
        </TouchableOpacity>
      </View>

      {/* Admin entry point — subtle, below the fold */}
      <TouchableOpacity
        style={styles.adminLink}
        onPress={() => router.push("/admin/login" as any)}
      >
        <Ionicons name="shield-checkmark-outline" size={13} color="rgba(255,255,255,0.25)" />
        <Text style={styles.adminLinkText}>Admin sign in</Text>
      </TouchableOpacity>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  content: { paddingHorizontal: 28 },
  logoArea: { alignItems: "center", marginBottom: 40 },
  logoImg: {
    width: 88,
    height: 88,
    borderRadius: 20,
    marginBottom: 8,
  },
  appName: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.cream,
    fontFamily: "Inter_700Bold",
  },
  tagline: {
    fontSize: 14,
    color: colors.lightGreen,
    marginTop: 4,
    opacity: 0.7,
    fontFamily: "Inter_400Regular",
  },
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
  inputGroup: { gap: 6 },
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
  adminLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 24,
    paddingVertical: 8,
  },
  adminLinkText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.25)",
    fontFamily: "Inter_400Regular",
  },
});
