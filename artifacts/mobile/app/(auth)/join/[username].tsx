import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import { getFlagEmoji } from "@/lib/countryGeo";
import colors from "@/constants/colors";

interface InviterPreview {
  username: string;
  fullName: string | null;
  photoUrl: string | null;
  country: string | null;
}

// Lives inside (auth) so AuthGate doesn't bounce a signed-out visitor to
// onboarding before this screen gets a chance to store the invite code —
// see the AUTH gate's `!isAuthenticated && !inAuth` check in app/_layout.tsx.
export default function JoinScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();
  const { isAuthenticated, isLoading } = useAuth();

  const [inviter, setInviter] = useState<InviterPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      // Already have an account — nothing to redeem, just go see who invited them.
      router.replace(`/profile/${username}` as any);
      return;
    }
    if (username) AsyncStorage.setItem("pending_invite_code", username);
  }, [isAuthenticated, isLoading, username, router]);

  useEffect(() => {
    if (!username) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/profiles/username/${encodeURIComponent(username)}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setInviter({ username: data.username, fullName: data.fullName, photoUrl: data.photoUrl, country: data.country });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.card}>
        <Text style={styles.grain}>🌾</Text>
        {loading ? (
          <ActivityIndicator color={colors.accentGreen} style={{ marginVertical: 20 }} />
        ) : inviter ? (
          <>
            {inviter.photoUrl ? (
              <Image source={{ uri: inviter.photoUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{(inviter.fullName ?? inviter.username).charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.title}>@{inviter.username} invited you</Text>
            {(inviter.fullName || inviter.country) && (
              <Text style={styles.subtitle}>
                {inviter.fullName}{inviter.fullName && inviter.country ? " · " : ""}{inviter.country ? `${getFlagEmoji(inviter.country)} ${inviter.country}` : ""}
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.title}>You've been invited to P2P Global</Text>
        )}

        <Text style={styles.description}>
          Join P2P Global Kingdom School — go through the Bible with a peer guide, free, for every nation.
        </Text>
        <Text style={styles.verse}>"Go and make disciples of all nations." — Matthew 28:19</Text>

        <TouchableOpacity style={styles.continueBtn} onPress={() => router.replace("/(auth)/register")} activeOpacity={0.85}>
          <Text style={styles.continueBtnText}>Create Your Account</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.cream} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.loginLink} onPress={() => router.replace("/(auth)/login")}>
          <Text style={styles.loginLinkText}>Already have an account? Log in</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  card: { width: "100%", maxWidth: 420, alignItems: "center" },
  grain: { fontSize: 40, marginBottom: 12 },
  avatar: { width: 72, height: 72, borderRadius: 36, marginBottom: 14, borderWidth: 2, borderColor: colors.accentGreen },
  avatarFallback: { backgroundColor: "rgba(29,158,117,0.15)", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 28, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  title: { fontSize: 20, fontWeight: "700", color: colors.cream, textAlign: "center", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 4, fontFamily: "Inter_400Regular" },
  description: { fontSize: 14, color: "rgba(255,255,255,0.75)", textAlign: "center", lineHeight: 20, marginTop: 20, fontFamily: "Inter_400Regular" },
  verse: { fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "center", fontStyle: "italic", marginTop: 12, fontFamily: "Inter_400Regular" },
  continueBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 52, width: "100%", marginTop: 28,
  },
  continueBtnText: { fontSize: 15, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  loginLink: { marginTop: 16, padding: 6 },
  loginLinkText: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_500Medium" },
});