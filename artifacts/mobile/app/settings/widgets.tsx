import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Switch, Platform, DeviceEventEmitter } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { AppButton, FilterChip, IconButton } from "@/components/ui";
import { DEFAULT_WIDGET_PREFS, type WidgetPrefs } from "@/lib/widgetSnapshot";
import { hasInstalledWidgets, lastWidgetSync, loadWidgetPrefs, saveWidgetPrefs, widgetsSupported } from "@/lib/widgetSync";
import { WIDGET_PREFS_CHANGED } from "@/components/widgets/WidgetSyncHost";
import { DEFAULT_JOURNAL_REMINDER, loadJournalReminder, saveJournalReminder, syncDailyReminders } from "@/lib/dailyReminders";
import { formatDate, timeAgo } from "@/lib/timeFormat";
import { showAlert } from "@/lib/alerts";

// Widgets & Offline — what the home-screen widgets show, how to add them, the
// privacy switches, the Discipleship Journal reminder and what works offline.
// Widgets are added through the phone's own widget picker; the app can't place
// them itself.

const IOS_WIDGETS = [
  ["Daily Greeting", "Morning, afternoon or evening, with today's verse"],
  ["Daily Bible Verse", "Today's Scripture; tap to read it in the Bible"],
  ["Kingdom School", "Continue learning and your Core Curriculum progress"],
  ["Continue a Lesson", "Straight back to your current lesson"],
  ["Core Curriculum Progress", "Modules finished (also on the Lock Screen)"],
  ["Learning Plans", "Your active Learning Plan"],
  ["Kingdom Stories", "Continue the story you are reading"],
  ["My Learning", "Work to do, reviews and feedback"],
  ["Study Together", "Your shared study and next Gathering"],
  ["Prayer & Journal", "A moment to pray or reflect"],
] as const;
const ANDROID_WIDGETS = [
  ["Greeting & Scripture", "Greeting for the time of day and today's verse"],
  ["Kingdom School", "Continue learning and your Core Curriculum progress"],
  ["Learning Plans", "Your active Learning Plan"],
  ["Kingdom Stories", "Continue the story you are reading"],
  ["My Learning", "Work to do, reviews and feedback"],
  ["Study Together", "Your shared study or next Gathering"],
  ["Prayer & Journal", "Tap for Prayer, or the action line for your journal"],
] as const;
const NOT_YET = [
  ["Bible reading plans (weekly, monthly, yearly)", "P2P doesn't have reading plans yet. A widget will follow when they exist."],
  ["Scripture by topic", "Topic passages come from the licensed Bible, which isn't stored for widgets."],
  ["Family Gatherings", "Family Gatherings aren't scheduled ahead, so there's no date to show. Church Gatherings are shown."],
] as const;
const JOURNAL_TIMES = ["07:00", "12:00", "18:00", "20:00", "21:00"];

export default function WidgetsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState<WidgetPrefs>(DEFAULT_WIDGET_PREFS);
  const [journal, setJournal] = useState(DEFAULT_JOURNAL_REMINDER);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const supported = widgetsSupported();

  useEffect(() => {
    if (!profile?.id) return;
    loadWidgetPrefs(profile.id).then(setPrefs);
    loadJournalReminder(profile.id).then(setJournal);
  }, [profile?.id]);
  useFocusEffect(useCallback(() => {
    hasInstalledWidgets().then(setInstalled);
    lastWidgetSync().then(setLastSync);
  }, []));

  function updatePrefs(next: WidgetPrefs) {
    setPrefs(next);
    if (!profile?.id) return;
    void saveWidgetPrefs(profile.id, next).then(() => DeviceEventEmitter.emit(WIDGET_PREFS_CHANGED));
  }

  async function updateJournal(next: { enabled: boolean; time: string }) {
    setJournal(next);
    if (!profile?.id) return;
    await saveJournalReminder(profile.id, next);
    const r = await syncDailyReminders(profile.id, profile, next.enabled);
    if (next.enabled && r.status === "permission_denied") {
      showAlert("Notifications are off", "Allow notifications for P2P Global in your phone's Settings to get this reminder.");
    }
  }

  const Row = ({ title, sub, value, onChange }: { title: string; sub: string; value: boolean; onChange: (v: boolean) => void }) => (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.meta}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={title}
        trackColor={{ false: c.borderBeige, true: c.accentGreen }} thumbColor="#fff" />
    </View>
  );

  const list = Platform.OS === "ios" ? IOS_WIDGETS : ANDROID_WIDGETS;

  return (
    <View style={[s.screen, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 8) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <View style={s.header}>
          <IconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="Back" color={c.textDark} />
          <Text style={s.title} accessibilityRole="header">Widgets & Offline</Text>
        </View>

        {/* Status */}
        <View style={s.card}>
          {!supported ? (
            <Text style={s.body}>
              {Platform.OS === "web"
                ? "Widgets are for the P2P Global app on iPhone and Android."
                : "This version of the app doesn't include widgets yet. Update P2P Global to get them."}
            </Text>
          ) : (
            <>
              <Text style={s.body}>{installed ? "You have P2P widgets on your home screen." : "No P2P widgets on your home screen yet."}</Text>
              <Text style={s.meta}>
                {lastSync ? `Widgets last updated ${timeAgo(lastSync, "ago")} (${formatDate(lastSync, "dateTime")}). They update when you open the app.` : "Widgets update each time you open the app."}
              </Text>
            </>
          )}
        </View>

        {/* How to add */}
        <Text style={s.section} accessibilityRole="header">Add a widget</Text>
        <Text style={s.body}>
          {Platform.OS === "ios"
            ? "Touch and hold an empty area of your Home Screen, tap Edit → Add Widget (or +), search for P2P Global, choose a widget and size, then tap Add Widget. For the Lock Screen: touch and hold it, tap Customize → Lock Screen, then tap the widget area."
            : "Touch and hold an empty area of your home screen, tap Widgets, find P2P Global, then drag a widget onto your home screen."}
        </Text>

        <Text style={s.section} accessibilityRole="header">Widgets</Text>
        {list.map(([name, desc]) => (
          <View key={name} style={s.item}>
            <Text style={s.rowTitle}>{name}</Text>
            <Text style={s.meta}>{desc}</Text>
          </View>
        ))}
        <Text style={[s.meta, { marginTop: 8 }]}>Not available yet:</Text>
        {NOT_YET.map(([name, why]) => (
          <Text key={name} style={s.meta}>• {name} — {why}</Text>
        ))}

        {/* Privacy */}
        <Text style={s.section} accessibilityRole="header">Privacy</Text>
        <Text style={[s.meta, { marginBottom: 8 }]}>Anyone holding your phone can see widgets. Your prayers, journal, messages and answers are never shown on them.</Text>
        <Row title="Use my first name" sub="Off: the greeting says “Welcome”." value={prefs.personalGreeting} onChange={(v) => updatePrefs({ ...prefs, personalGreeting: v })} />
        <Row title="Community details" sub="Show your study's family or church name and your next church Gathering." value={prefs.showCommunity} onChange={(v) => updatePrefs({ ...prefs, showCommunity: v })} />
        {Platform.OS === "ios" && (
          <Row title="Details on the Lock Screen" sub="Off: Lock Screen widgets show only general text, like “Continue learning”." value={prefs.lockScreenDetails} onChange={(v) => updatePrefs({ ...prefs, lockScreenDetails: v })} />
        )}

        {/* Reminders */}
        <Text style={s.section} accessibilityRole="header">Reminders</Text>
        <Row title="Discipleship Journal reminder" sub="A daily nudge to reflect. It never shows your entries." value={journal.enabled} onChange={(v) => void updateJournal({ ...journal, enabled: v })} />
        {journal.enabled && (
          <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Journal reminder time">
            {JOURNAL_TIMES.map((t) => (
              <FilterChip key={t} label={t} selection="single" selected={journal.time === t} onPress={() => void updateJournal({ ...journal, time: t })} />
            ))}
          </View>
        )}
        <AppButton label="Prayer reminders" onPress={() => router.push("/settings/prayer" as any)} variant="tertiary" icon="chevron-forward" iconPosition="trailing"
          accessibilityLabel="Prayer reminders: morning confession and prayer journal" />

        {/* Offline */}
        <Text style={s.section} accessibilityRole="header">Offline</Text>
        <Text style={s.body}>Works without internet:</Text>
        <Text style={s.meta}>• The greeting and today's verse (worked out on your phone)</Text>
        <Text style={s.meta}>• Your last synced lesson, plan, story, study and Gathering — marked “may be out of date” after a day</Text>
        <Text style={s.meta}>• Your daily reminders, once set</Text>
        <Text style={[s.body, { marginTop: 8 }]}>Needs internet:</Text>
        <Text style={s.meta}>• Opening full lessons, Kingdom Stories and Bible chapters — they aren't downloaded to your phone</Text>
        <Text style={s.meta}>• Today's verse is shown in English from P2P's own verse list; licensed Bible translations aren't stored on widgets</Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: -8, marginBottom: 8 },
    title: { fontSize: 22, lineHeight: 28, color: c.textDark, fontFamily: "Inter_700Bold" },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 22, marginBottom: 8 },
    card: { padding: 14, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, gap: 4 },
    body: { fontSize: 14, lineHeight: 20, color: c.textDark, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12, lineHeight: 17, color: c.textMuted, fontFamily: "Inter_400Regular" },
    item: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    rowTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  });
}
