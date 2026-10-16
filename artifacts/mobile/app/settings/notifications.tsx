import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Switch, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, UserProfile } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { loadPreviewSetting, savePreviewSetting, PREVIEW_LEVELS, type PreviewLevel, type PreviewSettingState } from "@/lib/messagePreviewSetting";

const TOGGLES: { key: keyof UserProfile; label: string; desc: string }[] = [
  { key: "notifySessionReminders", label: "Session Reminders", desc: "Remind me when it's time for my next study session" },
  { key: "notifyPeerGuideAlerts", label: "Peer Guide Alerts", desc: "Notify me about activity from my peer guide or disciples" },
  { key: "notifyFruitAwards", label: "Fruit Awards", desc: "Celebrate when I earn a new fruit" },
  { key: "notifyWeeklyEncouragement", label: "Weekly Encouragement", desc: "A weekly message of encouragement for your journey" },
  { key: "notifyElijahCheckins", label: "Elijah Protocol Check-ins", desc: "A gentle check-in if you've been quiet for a while" },
  { key: "notifyBreakRooms", label: "Break Rooms", desc: "Let me know when a room opens in a topic I've studied (max 2 a day)" },
];

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [preview, setPreview] = useState<PreviewSettingState>({ available: false });

  useEffect(() => {
    if (!profile?.id) return;
    let live = true;
    void loadPreviewSetting(profile.id).then((s) => { if (live) setPreview(s); });
    return () => { live = false; };
  }, [profile?.id]);

  async function choosePreview(level: PreviewLevel) {
    if (!profile?.id || !preview.available || level === preview.level) return;
    const previous = preview;
    const next = { ...preview, level };
    setPreview(next);
    if (!(await savePreviewSetting(profile.id, next))) setPreview(previous);
  }
  // Before migration 194 only Name only / Nothing exist on the server.
  const levels = preview.available && preview.source === "legacy" ? PREVIEW_LEVELS.filter((l) => l.value !== "full" && l.value !== "hold") : PREVIEW_LEVELS;

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Notifications" />
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

        {preview.available ? (
          <View style={[styles.card, { marginTop: 16 }]} accessibilityRole="radiogroup" accessibilityLabel="Message notification previews">
            <Text style={styles.label}>Message previews</Text>
            <Text style={[styles.desc, { marginBottom: 6 }]}>What message notifications may show.</Text>
            {levels.map((l, i) => {
              const selected = preview.level === l.value;
              return (
                <TouchableOpacity
                  key={l.value}
                  style={[styles.row, i === levels.length - 1 && styles.rowLast]}
                  onPress={() => choosePreview(l.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${l.label}. ${l.desc}`}
                >
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={styles.label}>{l.label}</Text>
                    <Text style={styles.desc}>{l.desc}</Text>
                  </View>
                  <View style={[styles.radio, selected && { borderColor: colors.accentGreen }]}>
                    {selected ? <View style={[styles.radioDot, { backgroundColor: colors.accentGreen }]} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16 },
    row: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    rowLast: { borderBottomWidth: 0, paddingBottom: 0 },
    label: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    desc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 17 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
  });
}