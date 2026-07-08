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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister() {
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!email.trim()) { setError("Please enter your email."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }

    setLoading(true);
    setError(null);
    const err = await signUp(email.trim(), password, name.trim());
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      // Go to intake form (sections 1-2 of the registration questionnaire)
      router.replace("/(auth)/intake");
    }
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
});
