import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import SettingsSubHeader from "@/components/SettingsSubHeader";
import DateOfBirthInput from "@/components/DateOfBirthInput";
import { authedFetch } from "@/lib/adminFetch";
import { isValidCalendarDate, parseDMY } from "@/lib/dateOfBirth";

// Settings → Account → Account status. Stage 1: shows the status and lets the
// user take a reversible break. Everything is decided by the server
// (POST /account/deactivate); this screen never sets a status locally.
// Permanent deletion is deliberately not offered here yet.

type BreakChoice = "week" | "month" | "quarter" | "date" | "open";

const DAY_MS = 24 * 60 * 60 * 1000;

const CHOICES: { key: BreakChoice; label: string; detail: string }[] = [
  { key: "week", label: "1 week", detail: "Back automatically after 7 days" },
  { key: "month", label: "30 days", detail: "Back automatically after 30 days" },
  { key: "quarter", label: "90 days", detail: "Back automatically after 90 days" },
  { key: "date", label: "Choose a date", detail: "Pick the day you'd like to return" },
  { key: "open", label: "Until I reactivate", detail: "Come back whenever you're ready" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export default function AccountStatusScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { accountStatus, refreshAccountStatus } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [choice, setChoice] = useState<BreakChoice | null>(null);
  const [customDate, setCustomDate] = useState("");
  const [saving, setSaving] = useState(false);

  // null = indefinite; undefined = not a valid selection yet.
  function untilFor(c: BreakChoice | null): string | null | undefined {
    if (!c) return undefined;
    if (c === "open") return null;
    if (c === "week") return new Date(Date.now() + 7 * DAY_MS).toISOString();
    if (c === "month") return new Date(Date.now() + 30 * DAY_MS).toISOString();
    if (c === "quarter") return new Date(Date.now() + 90 * DAY_MS).toISOString();
    const d = parseDMY(customDate);
    if (!d || !isValidCalendarDate(d.year, d.month, d.day)) return undefined;
    // Morning of the chosen day, local time.
    return new Date(d.year, d.month - 1, d.day, 9, 0, 0).toISOString();
  }

  function confirmBreak() {
    const until = untilFor(choice);
    if (until === undefined) {
      Alert.alert("Choose a date", "Please enter the date you'd like to return, as DD.MM.YYYY.");
      return;
    }
    const when = until ? `until ${formatDate(until)}` : "until you reactivate";
    Alert.alert(
      "Take a break?",
      `Your account will be paused ${when}.\n\nYour journey, progress, Family Circles, Peer Circles and messages all stay exactly as they are, and you'll get no notifications while you're away. You can sign in and reactivate at any time.`,
      [
        { text: "Not now", style: "cancel" },
        { text: "Take a break", onPress: () => submit(until) },
      ],
    );
  }

  async function submit(until: string | null) {
    setSaving(true);
    try {
      const res = await authedFetch("/account/deactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ until }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert("Couldn't pause your account", body.error ?? "Please try again later.");
        return;
      }
      // AuthGate moves to the "taking a break" screen once this reads it.
      await refreshAccountStatus();
    } catch {
      Alert.alert("Couldn't pause your account", "Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const isActive = !accountStatus || accountStatus.status === "active";

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Account status" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Account status</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: isActive ? colors.accentGreen : colors.textMuted }]} />
            <Text style={styles.statusText}>{isActive ? "Active" : "Taking a break"}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Take a break</Text>
          <Text style={styles.body}>
            If you need some time away, you can pause your account. Nothing is lost: your journey,
            progress, Family Circles, Peer Circles and messages stay as they are, and notifications pause until
            you return.
          </Text>

          {CHOICES.map((c) => {
            const selected = choice === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setChoice(c.key)}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.accentGreen : colors.textMuted} />
                <View style={styles.optionTextWrap}>
                  <Text style={styles.optionLabel}>{c.label}</Text>
                  <Text style={styles.optionDetail}>{c.detail}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {choice === "date" && (
            <View style={styles.dateWrap}>
              <Text style={styles.fieldLabel}>Return date</Text>
              <DateOfBirthInput value={customDate} onChangeText={setCustomDate} style={styles.input} />
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, (!choice || saving) && styles.primaryBtnDisabled]}
            onPress={confirmBreak}
            disabled={!choice || saving}
          >
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Take a break</Text>}
          </TouchableOpacity>
        </View>

        {/* Kept separate from "Take a break": deletion is permanent. */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Delete account permanently</Text>
          <Text style={styles.body}>
            Permanently removes your account and your journey after a 14-day period in which you can
            change your mind. This can't be undone once it's carried out.
          </Text>
          <TouchableOpacity style={styles.deleteLink} onPress={() => router.push("/settings/delete-account" as any)}>
            <Text style={styles.deleteLinkText}>Delete my account…</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 20 },
    card: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 16,
    },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: c.textMid, marginBottom: 8, fontFamily: "Inter_600SemiBold" },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    statusDot: { width: 10, height: 10, borderRadius: 5 },
    statusText: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    sectionTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
    body: { fontSize: 13, lineHeight: 20, color: c.textMid, fontFamily: "Inter_400Regular", marginBottom: 12 },
    option: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12,
      borderWidth: 1, borderColor: c.borderBeige, marginBottom: 8,
    },
    optionSelected: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
    optionTextWrap: { flex: 1 },
    optionLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    optionDetail: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    dateWrap: { marginTop: 4 },
    input: {
      backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige,
      borderRadius: 10, padding: 12, color: c.textDark, fontSize: 14,
      fontFamily: "Inter_400Regular", marginBottom: 6,
    },
    primaryBtn: {
      backgroundColor: c.accentGreen, borderRadius: 12, minHeight: 46, marginTop: 8,
      alignItems: "center", justifyContent: "center", paddingHorizontal: 16,
    },
    primaryBtnDisabled: { opacity: 0.5 },
    deleteLink: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: "#B91C1C", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
    deleteLinkText: { color: "#B91C1C", fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center" },
    primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold", textAlign: "center" },
  });
}
