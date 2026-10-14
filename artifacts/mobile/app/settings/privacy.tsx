import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Switch, Alert } from "react-native";
import { getMyActivityVisibility, setMyActivityVisibility } from "@/lib/presence";
import { getReadReceiptsEnabled, receiptsAvailable, setReadReceiptsEnabled } from "@/lib/messageReceiptsApi";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, UserProfile } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";

const TOGGLES: { key: keyof UserProfile; label: string; desc: string }[] = [
  { key: "visibleToChurchLeadership", label: "Profile visible to church leadership", desc: "Church leaders in your network can view your profile" },
  { key: "showCountryOnProfile", label: "Show my country on my profile", desc: "Other members can see which country you're in" },
];

export default function PrivacySettingsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, updateProfile, supabase } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Activity status lives in p2p_presence (migration 171), not on the
  // profile, so it is loaded and saved separately from the toggles above.
  const [showActivity, setShowActivity] = useState(true);
  // Read receipts (migration 179) are read/written only through their own
  // functions; null = not known yet / not available on this server.
  const [readReceipts, setReadReceipts] = useState<boolean | null>(null);
  const [readReceiptsLoad, setReadReceiptsLoad] = useState<"loading" | "ready" | "unavailable" | "error">("loading");

  useEffect(() => {
    if (!profile?.id) return;
    void getMyActivityVisibility(profile.id).then(setShowActivity);
    setReadReceiptsLoad("loading");
    void getReadReceiptsEnabled(supabase).then((v) => {
      setReadReceipts(v);
      // null is either "server not migrated" or a failed request (e.g. offline).
      setReadReceiptsLoad(v !== null ? "ready" : receiptsAvailable() ? "error" : "unavailable");
    });
  }, [profile?.id, supabase]);

  async function handleReadReceiptsToggle(next: boolean) {
    setReadReceipts(next);
    const err = await setReadReceiptsEnabled(supabase, next);
    if (err) {
      setReadReceipts(!next);
      if (Platform.OS === "web") window.alert("Couldn't save this setting. Please try again.");
      else Alert.alert("Couldn't save", "Please try again.");
    }
  }

  async function handleActivityToggle(next: boolean) {
    setShowActivity(next);
    const ok = await setMyActivityVisibility(next);
    if (!ok) {
      setShowActivity(!next);
      if (Platform.OS === "web") window.alert("Couldn't save this setting. Please try again.");
      else Alert.alert("Couldn't save", "Please try again.");
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Privacy" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          {TOGGLES.map((t, i) => (
            <View key={t.key} style={[styles.row, i === TOGGLES.length - 1 && styles.rowLast]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.label}>{t.label}</Text>
                <Text style={styles.desc}>{t.desc}</Text>
              </View>
              <Switch
                value={(profile?.[t.key] as boolean) ?? true}
                onValueChange={(v) => { updateProfile({ [t.key]: v } as Partial<UserProfile>); }}
                trackColor={{ false: colors.borderBeige, true: colors.accentGreen }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Activity Status</Text>
        <View style={styles.card}>
          <View style={[styles.row, styles.rowLast]}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.label}>Show when I'm active</Text>
              <Text style={styles.desc}>
                Your connections can see "Active now" or roughly when you were last active — never an exact time. If you turn this off, you also won't see theirs.
              </Text>
            </View>
            <Switch
              value={showActivity}
              onValueChange={(v) => { void handleActivityToggle(v); }}
              trackColor={{ false: colors.borderBeige, true: colors.accentGreen }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Messages</Text>
        <View style={styles.card}>
          <View style={[styles.row, styles.rowLast]}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.label}>Send read receipts</Text>
              <Text style={styles.desc}>
                {readReceiptsLoad === "loading"
                  ? "Loading…"
                  : readReceiptsLoad === "unavailable"
                    ? "Read receipts aren't available yet."
                    : readReceiptsLoad === "error"
                      ? "Couldn't load this setting. Check your connection and open this screen again."
                      : "When this is off, people won't see blue ticks when you read their messages. They still see when a message was delivered, and you still see when yours are read."}
              </Text>
            </View>
            <Switch
              value={readReceipts ?? true}
              disabled={readReceipts === null}
              onValueChange={(v) => { void handleReadReceiptsToggle(v); }}
              trackColor={{ false: colors.borderBeige, true: colors.accentGreen }}
              thumbColor="#fff"
              accessibilityLabel="Send read receipts"
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Data and Analytics</Text>
        <View style={styles.card}>
          <View style={[styles.row, styles.rowLast]}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.label}>Analytics opt-out</Text>
              <Text style={styles.desc}>Stop sharing anonymous usage data that helps us improve the app</Text>
            </View>
            <Switch
              value={profile?.analyticsOptOut ?? false}
              onValueChange={(v) => { updateProfile({ analyticsOptOut: v }); }}
              trackColor={{ false: colors.borderBeige, true: colors.accentGreen }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    sectionTitle: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 24 },
    row: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    rowLast: { borderBottomWidth: 0, paddingBottom: 0 },
    label: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    desc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 17 },
  });
}