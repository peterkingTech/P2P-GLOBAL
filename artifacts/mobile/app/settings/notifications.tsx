import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Switch, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, UserProfile } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import { loadPreviewSetting, savePreviewSetting, PREVIEW_LEVELS, type PreviewLevel, type PreviewSettingState } from "@/lib/messagePreviewSetting";
import { loadAdminOverdueSetting, saveAdminOverdueSetting, type AdminOverdueState } from "@/lib/adminOverdueSetting";

// Phone alerts by category. The server (api-server lib/notificationCategories.ts)
// is what honours these: off = no push for that category; the notification
// still appears in the in-app Notification Center. The master switch
// (notificationsEnabled) silences every category at once.
const TOGGLES: { key: keyof UserProfile; label: string; desc: string }[] = [
  { key: "notifyMessages", label: "Messages", desc: "New messages and replies" },
  { key: "notifyGroups", label: "Community", desc: "Connections, circles, family, church and Study Together" },
  { key: "notifyPrayer", label: "Prayer", desc: "Prayer invitations and gatherings" },
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
  const [adminOverdue, setAdminOverdue] = useState<AdminOverdueState>({ available: false });
  const isSuperAdmin = profile?.role === "super_admin";
  const masterOn = profile?.notificationsEnabled ?? true;

  useEffect(() => {
    if (!profile?.id) return;
    let live = true;
    void loadPreviewSetting(profile.id).then((s) => { if (live) setPreview(s); });
    if (isSuperAdmin) void loadAdminOverdueSetting(profile.id).then((s) => { if (live) setAdminOverdue(s); });
    return () => { live = false; };
  }, [profile?.id, isSuperAdmin]);

  async function toggleAdminOverdue(on: boolean) {
    if (!profile?.id || !adminOverdue.available) return;
    const previous = adminOverdue;
    setAdminOverdue({ available: true, on });
    if (!(await saveAdminOverdueSetting(profile.id, on))) setAdminOverdue(previous);
  }

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
        <View style={[styles.card, { marginBottom: 16 }]}>
          <View style={[styles.row, styles.rowLast, { paddingTop: 0 }]}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.label}>Phone notifications</Text>
              <Text style={styles.desc}>Turn off to silence every category below at once</Text>
            </View>
            <Switch
              value={masterOn}
              onValueChange={(v) => { updateProfile({ notificationsEnabled: v }); }}
              trackColor={{ false: colors.borderBeige, true: colors.accentGreen }}
              thumbColor="#fff"
              accessibilityLabel="Phone notifications"
            />
          </View>
        </View>

        <View style={[styles.card, !masterOn && styles.cardDimmed]} accessibilityState={{ disabled: !masterOn }}>
          {TOGGLES.map((t, i) => (
            <View key={t.key} style={[styles.row, i === TOGGLES.length - 1 && !(isSuperAdmin && adminOverdue.available) && styles.rowLast]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.label}>{t.label}</Text>
                <Text style={styles.desc}>{t.desc}</Text>
              </View>
              <Switch
                value={(profile?.[t.key] as boolean) ?? true}
                onValueChange={(v) => { updateProfile({ [t.key]: v } as Partial<UserProfile>); }}
                disabled={!masterOn}
                trackColor={{ false: colors.borderBeige, true: colors.accentGreen }}
                thumbColor="#fff"
                accessibilityLabel={t.label}
              />
            </View>
          ))}
          {isSuperAdmin && adminOverdue.available ? (
            <View style={[styles.row, styles.rowLast]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.label}>Overdue reminders (super admin)</Text>
                <Text style={styles.desc}>Contact messages unread for 24+ hours and overdue admin reports</Text>
              </View>
              <Switch
                value={adminOverdue.on}
                onValueChange={(v) => { void toggleAdminOverdue(v); }}
                disabled={!masterOn}
                trackColor={{ false: colors.borderBeige, true: colors.accentGreen }}
                thumbColor="#fff"
                accessibilityLabel="Overdue reminders"
              />
            </View>
          ) : null}
        </View>
        <Text style={styles.footnote}>
          Calls, missed calls and account or safety alerts always come through. Turning a category off only stops the phone alert — it still appears in Notifications.
        </Text>

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
    cardDimmed: { opacity: 0.5 },
    row: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    rowLast: { borderBottomWidth: 0, paddingBottom: 0 },
    label: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    desc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 17 },
    footnote: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 10, paddingHorizontal: 4 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
  });
}