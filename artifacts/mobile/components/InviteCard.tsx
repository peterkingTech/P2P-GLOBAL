import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { shareInviteLink } from "@/lib/sharing";

interface InviteCardProps {
  label: string;
  buttonText: string;
}

export function InviteCard({ label, buttonText }: InviteCardProps) {
  const { profile } = useAuth();
  const { getMyInviteLink } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [busy, setBusy] = useState(false);

  async function handlePress() {
    if (!profile?.username) {
      Alert.alert("Set a username first", "Add a username before inviting others.");
      return;
    }
    setBusy(true);
    try {
      const inviteLink = await getMyInviteLink();
      if (!inviteLink) { Alert.alert("Couldn't get invite link", "Please try again."); return; }
      await shareInviteLink({ username: profile.username, inviteLink });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.btn} onPress={handlePress} disabled={busy} activeOpacity={0.85}>
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>{buttonText}</Text>}
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: "rgba(224,164,65,0.08)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(224,164,65,0.25)",
      padding: 16, marginBottom: 16,
    },
    label: { fontSize: 14, fontWeight: "600", color: c.textDark, marginBottom: 12, fontFamily: "Inter_600SemiBold" },
    btn: { backgroundColor: c.accentGreen, borderRadius: 12, height: 44, alignItems: "center", justifyContent: "center" },
    btnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}