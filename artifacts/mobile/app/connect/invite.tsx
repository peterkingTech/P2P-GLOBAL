import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
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
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";


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

        <AppButton label="Invite a Peer" onPress={() => { void handleShare(); }} size="lg" icon="share-outline" disabled={!!busy} loading={busy === "share"} style={{ width: "100%", marginBottom: 12 }} palette="fixedLight" />
        <AppButton label={copied ? "Link copied" : "Copy my invite link"} onPress={() => { void handleCopy(); }} variant="outline" size="lg" icon={copied ? "checkmark" : "copy-outline"} disabled={!!busy} loading={busy === "copy"} style={{ width: "100%" }} palette="fixedLight" />

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
  grain: { marginTop: 16, fontSize: 13, color: colors.textMuted, fontFamily: "Inter_500Medium" },
});
