import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { shareInviteLink } from "@/lib/sharing";
import { recordInviteShared } from "@/lib/inviteEncouragement";
import { grainLabel } from "@/lib/grain";
import colors from "@/constants/colors";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// "Be an Electronic Evangelist" — the explanation and the invite action in
// one place. Uses the real personal invite link (getMyInviteLink): sign-up
// redeems it by username (POST /profiles/invite/redeem) and Grain counts it.
// This screen previously shared an 8-character code taken from the user id,
// which redemption could never match.
export default function InvitePeer() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { getMyInviteLink } = useData();
  const [busy, setBusy] = useState<"share" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);

  async function getLink(): Promise<string | null> {
    if (!profile?.username) {
      showAlert("Set a username first", "Add a username so your invite link can point to you.");
      return null;
    }
    const link = await getMyInviteLink();
    if (!link) showAlert("Couldn't get your invite link", "Please try again.");
    return link;
  }

  async function handleShare() {
    if (busy || !profile?.id) return;
    setBusy("share");
    try {
      const link = await getLink();
      if (!link || !profile.username) return;
      const shared = await shareInviteLink({ username: profile.username, inviteLink: link });
      if (shared) await recordInviteShared(profile.id);
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy() {
    if (busy) return;
    setBusy("copy");
    try {
      const link = await getLink();
      if (!link) return;
      await Clipboard.setStringAsync(link);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setBusy(null);
    }
  }

  const grain = grainLabel(profile?.grainCount ?? 0);

  return (
    <>
      <Stack.Screen options={{ title: "Invite a Peer" }} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={styles.seed}>🌱</Text>
        <Text style={styles.title}>Be an Electronic Evangelist</Text>
        <Text style={styles.lead}>Your phone can be more than a place to consume. Use it to help someone grow.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What does that mean?</Text>
          <Text style={styles.cardBody}>
            Technology can carry more than content. A message from you can help someone discover Scripture,
            discipleship, prayer and a community to grow with.
          </Text>
          <Text style={[styles.cardBody, { marginTop: 10 }]}>
            Everyone is learning from someone and helping someone grow. Who can you help grow today?
          </Text>
        </View>

        <TouchableOpacity style={styles.btn} onPress={() => { void handleShare(); }} disabled={!!busy}>
          {busy === "share" ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="share-outline" size={18} color="#fff" />
              <Text style={styles.btnText}>Invite a Peer</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnOutline} onPress={() => { void handleCopy(); }} disabled={!!busy}>
          {busy === "copy" ? <ActivityIndicator color={colors.primaryGreen} /> : (
            <>
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={colors.primaryGreen} />
              <Text style={styles.btnOutlineText}>{copied ? "Link copied" : "Copy my invite link"}</Text>
            </>
          )}
        </TouchableOpacity>

        {!!grain && <Text style={styles.grain}>{grain}</Text>}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.lightCream },
  container: { alignItems: "center", padding: 24, paddingTop: 40, gap: 8 },
  seed: { fontSize: 40 },
  title: { fontSize: 22, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginTop: 8, textAlign: "center" },
  lead: { fontSize: 15, color: colors.textDark, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 16 },
  card: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 18, marginBottom: 24, width: "100%",
  },
  cardTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 8 },
  cardBody: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 21 },
  btn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primaryGreen, borderRadius: 12, paddingVertical: 14, width: "100%", marginBottom: 12, minHeight: 50,
  },
  btnText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  btnOutline: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", minHeight: 50,
    borderRadius: 12, paddingVertical: 14, width: "100%", borderWidth: 1.5, borderColor: colors.primaryGreen,
  },
  btnOutlineText: { color: colors.primaryGreen, fontWeight: "700", fontFamily: "Inter_700Bold" },
  grain: { marginTop: 16, fontSize: 13, color: colors.textMuted, fontFamily: "Inter_500Medium" },
});
