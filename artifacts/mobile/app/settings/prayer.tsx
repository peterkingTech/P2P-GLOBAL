import React from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Switch, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";

// Lightweight time-of-day chips instead of a native time picker component —
// this app has no date/time picker dependency installed yet, and adding one
// just for this one field isn't worth the extra native module.
const CONFESSION_TIMES = ["05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00"];

export default function PrayerSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Prayer" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.label}>Morning confession reminder</Text>
              <Text style={styles.desc}>A daily reminder to speak your confession over your day</Text>
            </View>
            <Switch
              value={profile?.morningConfessionEnabled ?? false}
              onValueChange={(v) => { updateProfile({ morningConfessionEnabled: v }); }}
              trackColor={{ false: colors.borderBeige, true: colors.accentGreen }}
              thumbColor="#fff"
            />
          </View>

          {profile?.morningConfessionEnabled && (
            <View style={styles.timeSection}>
              <Text style={styles.timeLabel}>Reminder time</Text>
              <View style={styles.chipWrapRow}>
                {CONFESSION_TIMES.map((time) => {
                  const selected = (profile?.morningConfessionTime ?? "07:00") === time;
                  return (
                    <TouchableOpacity
                      key={time}
                      style={[styles.chip, selected && styles.chipActive]}
                      onPress={() => updateProfile({ morningConfessionTime: time })}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{time}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={[styles.row, styles.rowLast]}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.label}>Prayer journal reminder</Text>
              <Text style={styles.desc}>A gentle nudge to write in your prayer journal</Text>
            </View>
            <Switch
              value={profile?.prayerJournalReminderEnabled ?? false}
              onValueChange={(v) => { updateProfile({ prayerJournalReminderEnabled: v }); }}
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
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 24 },
    row: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderBeige, paddingBottom: 14,
    },
    rowLast: { borderBottomWidth: 0, paddingBottom: 6 },
    label: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    desc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 17 },
    timeSection: { marginTop: 16 },
    timeLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, marginBottom: 8, fontFamily: "Inter_600SemiBold" },
    chipWrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: c.lightCream },
    chipActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    chipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    chipTextActive: { color: "#fff", fontWeight: "700" },
  });
}