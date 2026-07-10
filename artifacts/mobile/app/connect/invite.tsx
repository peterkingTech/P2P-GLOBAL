import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Share, Platform } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

export default function InvitePeer() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [copied, setCopied] = useState(false);

  const inviteCode = profile?.id ? profile.id.slice(0, 8).toUpperCase() : "------";
  const inviteMessage = `Join me on the P2P Global Bible Study Network! Use my invite code ${inviteCode} when you sign up so we can study together.`;

  async function handleCopy() {
    await Clipboard.setStringAsync(inviteMessage);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    try {
      await Share.share({ message: inviteMessage });
    } catch {}
  }

  return (
    <>
      <Stack.Screen options={{ title: "Invite a Peer" }} />
      <View style={[styles.container, { paddingBottom: insets.bottom + 40 }]}>
        <Ionicons name="mail-outline" size={40} color={colors.amber} />
        <Text style={styles.title}>Invite a Study Partner</Text>
        <Text style={styles.sub}>Share your invite code with someone you know so you can study together.</Text>

        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Your Invite Code</Text>
          <Text style={styles.code}>{inviteCode}</Text>
        </View>

        <TouchableOpacity style={styles.btn} onPress={handleShare}>
          <Ionicons name="share-outline" size={18} color="#fff" />
          <Text style={styles.btnText}>Share Invite</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnOutline} onPress={handleCopy}>
          <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={colors.primaryGreen} />
          <Text style={styles.btnOutlineText}>{copied ? "Copied!" : "Copy Message"}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream, alignItems: "center", padding: 24, paddingTop: 60, gap: 8 },
  title: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginTop: 8 },
  sub: { fontSize: 13, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", marginBottom: 20 },
  codeCard: {
    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    paddingVertical: 20, paddingHorizontal: 32, alignItems: "center", marginBottom: 24, width: "100%",
  },
  codeLabel: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  code: { fontSize: 28, fontWeight: "700", color: colors.primaryGreen, letterSpacing: 4, marginTop: 6, fontFamily: "Inter_700Bold" },
  btn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primaryGreen, borderRadius: 12, paddingVertical: 14, width: "100%", marginBottom: 12,
  },
  btnText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
  btnOutline: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    borderRadius: 12, paddingVertical: 14, width: "100%", borderWidth: 1.5, borderColor: colors.primaryGreen,
  },
  btnOutlineText: { color: colors.primaryGreen, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
