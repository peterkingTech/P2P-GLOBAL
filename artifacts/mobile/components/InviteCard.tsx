import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { shareInviteLink } from "@/lib/sharing";
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";

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
      showAlert("Set a username first", "Add a username before inviting others.");
      return;
    }
    setBusy(true);
    try {
      const inviteLink = await getMyInviteLink();
      if (!inviteLink) { showAlert("Couldn't get invite link", "Please try again."); return; }
      await shareInviteLink({ username: profile.username, inviteLink });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <AppButton label={`${buttonText}`} onPress={handlePress} disabled={busy} loading={busy} />
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
  });
}