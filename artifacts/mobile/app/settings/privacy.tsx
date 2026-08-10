import React from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Switch } from "react-native";
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
  const { profile, updateProfile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

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