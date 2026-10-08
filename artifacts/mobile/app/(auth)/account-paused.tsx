import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";
import ReadableText from "@/components/ReadableText";
import { READABLE_WIDTH } from "@/lib/typography";

const LOGO = require("@/assets/images/logo.png");

// Shown by AuthGate (app/_layout.tsx) whenever the signed-in account is on a
// break. Reactivating goes through the server (POST /account/reactivate); the
// gate then returns the user to the app on its own.
export default function AccountPausedScreen() {
  const insets = useSafeAreaInsets();
  const { accountStatus, refreshAccountStatus, signOut } = useAuth();
  const [busy, setBusy] = useState<"reactivate" | "signout" | null>(null);

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  // Same screen for a scheduled deletion: the grace period is a pause, and
  // the main action keeps the account (POST /account/deletion/cancel).
  const scheduled = accountStatus?.status === "deletion_scheduled";
  const until = accountStatus?.deactivatedUntil;
  const untilText = scheduled
    ? accountStatus?.deletionScheduledFor
      ? `Your account is scheduled to be permanently deleted on ${fmt(accountStatus.deletionScheduledFor)}.`
      : "Your account is scheduled to be permanently deleted."
    : until
      ? `Your account is paused until ${fmt(until)}.`
      : "Your account is paused until you reactivate it.";

  async function reactivate() {
    setBusy("reactivate");
    try {
      const path = scheduled ? "/account/deletion/cancel" : "/account/reactivate";
      const res = await authedFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert("Couldn't reactivate", body.error ?? "Please try again later.");
        return;
      }
      await refreshAccountStatus();
    } catch {
      Alert.alert("Couldn't reactivate", "Please check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSignOut() {
    setBusy("signout");
    try { await signOut(); } finally { setBusy(null); }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 20 : 0), paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.center}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        <ReadableText style={styles.title}>{scheduled ? "Your account is set to be deleted" : "You're taking a break"}</ReadableText>
        <ReadableText balance style={styles.body}>{untilText}</ReadableText>
        <ReadableText balance style={styles.body}>
          {scheduled
            ? "Until then nothing has been deleted. If you'd like to stay, you can keep your account and everything in it."
            : "Everything you've built is safe — your journey, progress, Family Circles and Peer Circles are here whenever you're ready to return."}
        </ReadableText>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.btn} onPress={reactivate} disabled={busy !== null} activeOpacity={0.85}>
          {busy === "reactivate" ? <ActivityIndicator color={colors.cream} /> : (
            <>
              <Text style={styles.btnText}>{scheduled ? "Keep my account" : "Reactivate my account"}</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.cream} />
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleSignOut} disabled={busy !== null}>
          {busy === "signout" ? <ActivityIndicator color={colors.lightGreen} /> : <Text style={styles.secondaryText}>Sign out</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  logo: { width: 150, height: 100, marginBottom: 28 },
  title: {
    fontSize: 24, lineHeight: 32, color: colors.cream, textAlign: "center",
    fontFamily: "Inter_700Bold", marginBottom: 14, maxWidth: READABLE_WIDTH.heading,
  },
  body: {
    fontSize: 15, lineHeight: 24, color: colors.textMutedLight, textAlign: "center",
    fontFamily: "Inter_400Regular", marginBottom: 10, maxWidth: READABLE_WIDTH.body,
  },
  footer: { paddingHorizontal: 24, gap: 14 },
  btn: {
    backgroundColor: colors.accentGreen, borderRadius: 14, minHeight: 54,
    paddingHorizontal: 20, paddingVertical: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  btnText: { color: colors.cream, fontSize: 16, fontFamily: "Inter_600SemiBold", flexShrink: 1, textAlign: "center" },
  secondaryBtn: { alignItems: "center", paddingVertical: 10 },
  secondaryText: { color: colors.lightGreen, fontSize: 14, fontFamily: "Inter_400Regular" },
});
