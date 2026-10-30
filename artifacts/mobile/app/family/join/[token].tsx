import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { FamilyApiError, previewFamilyInvite, requestToJoinFamily, type FamilyInvitePreview } from "@/lib/familyApi";
import { FAMILY_ROLE_LABEL } from "@/lib/familyMembersModel";
import { AppButton, IconButton } from "@/components/ui";

// Opened from a Family Circle invite QR / link. Shows which family it is and
// lets the person ASK to join. Nothing here joins anyone: a Shepherd or
// Co-Shepherd approves each request (routes/family.ts, migration 192). The
// server answers every invalid link the same way, so this screen can't tell
// an expired link from one that never existed — and doesn't try to.
type Phase = "loading" | "ready" | "sending" | "invalid" | "signin" | "error";

export default function FamilyJoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [phase, setPhase] = useState<Phase>("loading");
  const [preview, setPreview] = useState<FamilyInvitePreview | null>(null);

  const load = useCallback(async () => {
    if (!token) { setPhase("invalid"); return; }
    setPhase("loading");
    try {
      setPreview(await previewFamilyInvite(token));
      setPhase("ready");
    } catch (e) {
      const status = e instanceof FamilyApiError ? e.status : 0;
      setPhase(status === 404 ? "invalid" : status === 401 ? "signin" : "error");
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function ask() {
    if (!token || !preview) return;
    setPhase("sending");
    try {
      const r = await requestToJoinFamily(token);
      setPreview({ ...preview, status: r.status });
      setPhase("ready");
    } catch (e) {
      const status = e instanceof FamilyApiError ? e.status : 0;
      setPhase(status === 404 ? "invalid" : "error");
    }
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/" as any));

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <IconButton icon="arrow-back" accessibilityLabel="Go back" onPress={goBack} color={colors.textDark} />

      <View style={styles.card}>
        <Ionicons name="home-outline" size={36} color={colors.accentGreen} />
        {phase === "loading" ? (
          <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 16 }} />
        ) : phase === "invalid" ? (
          <>
            <Text style={styles.title}>This invite isn't valid any more</Text>
            <Text style={styles.body}>It may have expired or been turned off. Ask the Family Shepherd for a new code.</Text>
          </>
        ) : phase === "signin" ? (
          <>
            <Text style={styles.title}>Sign in to continue</Text>
            <Text style={styles.body}>Sign in to P2P Global, then open this invite again.</Text>
          </>
        ) : phase === "error" ? (
          <>
            <Text style={styles.title}>Couldn't open this invite</Text>
            <AppButton label="Try again" onPress={load} style={{ minWidth: 180, marginTop: 10 }} />
          </>
        ) : preview ? (
          <>
            <Text style={styles.title}>{preview.familyName}</Text>
            {preview.invitedBy ? <Text style={styles.body}>Shared by {preview.invitedBy}</Text> : null}
            {preview.status === "member" ? (
              <>
                <Text style={styles.status}>You're already in this Family Circle.</Text>
              </>
            ) : preview.status === "pending" ? (
              <Text style={styles.status} accessibilityLiveRegion="polite">Request sent. The Family Shepherd will review it.</Text>
            ) : (
              <>
                <Text style={styles.body}>
                  Ask to join as {FAMILY_ROLE_LABEL[preview.role]?.toLowerCase() ?? "a member"}. The Family Shepherd or a Co-Shepherd reviews every request.
                </Text>
                <AppButton label="Ask to join" onPress={ask} disabled={phase === "sending"} loading={phase === "sending"} style={{ minWidth: 180, marginTop: 10 }} />
              </>
            )}
          </>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (c: AppColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream, paddingHorizontal: 20 },
    back: { width: 44, height: 44, justifyContent: "center" },
    card: { marginTop: 24, alignItems: "center", gap: 10, padding: 24, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    title: { fontSize: 20, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 8 },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
    status: { fontSize: 14, fontWeight: "600", color: c.accentGreen, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 6 },
  });
