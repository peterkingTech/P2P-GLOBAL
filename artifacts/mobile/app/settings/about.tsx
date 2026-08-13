import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { shareInviteLink } from "@/lib/sharing";

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

// Terms/Privacy Policy/Contact have no published page or screen yet — rather
// than link to a fabricated URL or a blank screen, these rows say so
// honestly when tapped.
function notPublishedYet(what: string) {
  Alert.alert("Coming soon", `${what} hasn't been published yet.`);
}

export default function AboutSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { profile } = useAuth();
  const { getMyInviteLink } = useData();
  const [inviting, setInviting] = useState(false);

  async function handleShareInvite() {
    if (!profile?.username) {
      Alert.alert("Set a username first", "Add a username before inviting others.");
      return;
    }
    setInviting(true);
    try {
      const inviteLink = await getMyInviteLink();
      if (!inviteLink) { Alert.alert("Couldn't get invite link", "Please try again."); return; }
      await shareInviteLink({ username: profile.username, inviteLink });
    } finally {
      setInviting(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="About" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.shareAppBtn} onPress={handleShareInvite} activeOpacity={0.85} disabled={inviting}>
          {inviting ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Ionicons name="share-social-outline" size={20} color="#fff" />
              <Text style={styles.shareAppBtnText}>Invite Someone · Share your link</Text>
            </>
          )}
        </TouchableOpacity>
        {!!profile?.grainCount && <Text style={styles.grainEarnedText}>🌾 {profile.grainCount} Grain earned so far</Text>}

        <View style={styles.card}>
          <View style={[styles.row, styles.rowLast]}>
            <Text style={styles.label}>App version</Text>
            <Text style={styles.value}>{APP_VERSION}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <TouchableOpacity style={styles.linkRow} onPress={() => notPublishedYet("Terms of Service")}>
            <Text style={styles.label}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkRow} onPress={() => notPublishedYet("Privacy Policy")}>
            <Text style={styles.label}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkRow, styles.rowLast]} onPress={() => notPublishedYet("Contact support")}>
            <Text style={styles.label}>Contact Support</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
          </TouchableOpacity>
        </View>

        <View style={styles.brandingWrap}>
          <Text style={styles.brandingText}>Built with ❤️ by AMEN TECH</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 16 },
    shareAppBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
      backgroundColor: c.accentGreen, borderRadius: 14, height: 52, marginBottom: 16,
    },
    shareAppBtnText: { fontSize: 16, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    grainEarnedText: { fontSize: 12, color: c.textMuted, textAlign: "center", marginTop: -8, marginBottom: 16, fontFamily: "Inter_400Regular" },
    row: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    linkRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    rowLast: { borderBottomWidth: 0, paddingBottom: 0 },
    label: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    value: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    brandingWrap: { alignItems: "center", marginTop: 24 },
    brandingText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}