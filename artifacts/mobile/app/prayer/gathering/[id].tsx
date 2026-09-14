import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform, Alert, Linking } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { getGathering, cancelGathering, type PrayerGathering, type PrayerGatheringParticipant } from "@/lib/prayerCoordinationApi";
import { deviceTimezone, zoneShortLabel, formatTimeInZone, relativeDayLabel } from "@/lib/prayerTimeDisplay";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// A gathering created here reuses the EXISTING Direct Call infrastructure
// once it actually starts (channel_name/call_log_id, populated by a later
// stage) — this screen deliberately does not implement any call/voice
// logic itself; it only displays schedule/participant/focus state and
// gates when "Enter Prayer" becomes available. The real join action is
// wired in a later stage, not here.
export default function PrayerGatheringScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [gathering, setGathering] = useState<PrayerGathering | null>(null);
  const [participants, setParticipants] = useState<PrayerGatheringParticipant[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { gathering: g, participants: p } = await getGathering(id);
      setGathering(g);
      setParticipants(p);
    } catch (e: any) {
      showAlert("Couldn't load this prayer gathering", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleCancel() {
    if (!gathering) return;
    setBusy(true);
    try {
      await cancelGathering(gathering.id);
      router.back();
    } catch (e: any) {
      showAlert("Couldn't cancel this gathering", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleEnter() {
    if (!gathering) return;
    // Reuses the existing, unmodified Direct Call engine (app/call/prayer.tsx
    // wraps the same useAgora/useAgoraEngine hooks app/call/audio.tsx does) —
    // this is navigation into that screen, not a new call technology.
    router.push({ pathname: "/call/prayer", params: { gatheringId: gathering.id } } as any);
  }

  if (loading && !gathering) {
    return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  }
  if (!gathering) {
    return <View style={[styles.screen, styles.centerFill]}><Text style={styles.emptyText}>This prayer gathering is not available.</Text></View>;
  }

  const myTz = deviceTimezone();
  const startMs = new Date(gathering.scheduledStartAt).getTime();
  const endMs = new Date(gathering.scheduledEndAt).getTime();
  const nowMs = now.getTime();
  const withinWindow = nowMs >= startMs - 5 * 60 * 1000 && nowMs <= endMs;
  const canEnter = withinWindow && ["scheduled", "starting", "live"].includes(gathering.status);

  let stateLabel = "📅 Upcoming";
  if (gathering.status === "cancelled") stateLabel = "Cancelled";
  else if (gathering.status === "completed") stateLabel = "Prayer Complete";
  else if (gathering.status === "expired") stateLabel = "Expired";
  else if (gathering.status === "live") stateLabel = "🙏 Praying together";
  else if (nowMs > endMs) stateLabel = "Missed";
  else if (nowMs >= startMs - 10 * 60 * 1000 && nowMs < startMs) stateLabel = "⏳ Starting soon";
  else if (withinWindow) stateLabel = "🟢 Ready to enter";

  const otherParticipant = participants.find((p) => p.userId !== profile?.id);
  const me = participants.find((p) => p.userId === profile?.id);
  // Reuses the exact same {reference} shape and bible.com tap-through
  // pattern already used by app/lesson/[id].tsx — no in-app Bible reader,
  // no second Scripture representation.
  const scriptureRef = (gathering.scriptureReference as { reference?: string } | null)?.reference ?? null;
  const isHost = gathering.hostId === profile?.id;

  function countdownText(): string | null {
    if (nowMs >= startMs) return null;
    const totalSec = Math.max(0, Math.floor((startMs - nowMs) / 1000));
    const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  const countdown = countdownText();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Prayer Gathering</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.stateWrap}>
          <Text style={styles.stateLabel}>{stateLabel}</Text>
        </View>

        <Text style={styles.participantsLine}>
          {(isHost ? "You" : me?.displayName ?? "You")} + {otherParticipant?.displayName ?? "…"}
        </Text>

        <View style={styles.timeCard}>
          <Text style={styles.timeDay}>{relativeDayLabel(gathering.scheduledStartAt)}</Text>
          <Text style={styles.timeValue}>
            {formatTimeInZone(gathering.scheduledStartAt, myTz)}–{formatTimeInZone(gathering.scheduledEndAt, myTz)}
          </Text>
          <Text style={styles.timeZoneLabel}>{zoneShortLabel(myTz)}</Text>
          {countdown && <Text style={styles.countdown}>Starts in {countdown}</Text>}
        </View>

        {!!gathering.prayerFocus && (
          <View style={styles.focusCard}>
            <Text style={styles.focusLabel}>Prayer Focus</Text>
            <Text style={styles.focusText}>{gathering.prayerFocus}</Text>
          </View>
        )}

        {!!scriptureRef && (
          <TouchableOpacity
            style={styles.scriptureRow}
            onPress={() => Linking.openURL(`https://www.bible.com/search/bible?query=${encodeURIComponent(scriptureRef)}`).catch(() => {})}
          >
            <Ionicons name="book" size={16} color={c.accentGreen} />
            <Text style={styles.scriptureText}>{scriptureRef}</Text>
            <Ionicons name="open-outline" size={14} color={c.textMuted} />
          </TouchableOpacity>
        )}

        <View style={styles.rosterCard}>
          {participants.map((p) => (
            <View key={p.id} style={styles.rosterRow}>
              <View style={styles.rosterAvatar}><Text style={styles.rosterAvatarText}>{p.displayName.charAt(0)}</Text></View>
              <Text style={styles.rosterName}>{p.userId === profile?.id ? "You" : p.displayName}</Text>
              <Text style={styles.rosterStatus}>{p.status === "joined" ? "In prayer" : p.status === "left" ? "Left" : "Invited"}</Text>
            </View>
          ))}
        </View>

        {["scheduled", "starting"].includes(gathering.status) && (
          <TouchableOpacity
            style={[styles.enterBtn, !canEnter && styles.enterBtnDisabled]}
            onPress={handleEnter}
            disabled={!canEnter}
          >
            <Ionicons name="mic" size={18} color={canEnter ? "#fff" : c.textMuted} />
            <Text style={[styles.enterBtnText, !canEnter && styles.enterBtnTextDisabled]}>Enter Prayer</Text>
          </TouchableOpacity>
        )}

        {gathering.status === "scheduled" && (
          <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} disabled={busy}>
            {busy ? <ActivityIndicator color="#DC2626" size="small" /> : <Text style={styles.cancelBtnText}>Cancel Gathering</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center", flex: 1 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 },
    title: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    stateWrap: { alignItems: "center", marginTop: 12, marginBottom: 6 },
    stateLabel: { fontSize: 14, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    participantsLine: { fontSize: 20, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 18 },
    timeCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 16, padding: 18, alignItems: "center" },
    timeDay: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
    timeValue: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    timeZoneLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 2 },
    countdown: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold", marginTop: 10 },
    focusCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginTop: 14 },
    focusLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
    focusText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
    scriptureRow: {
      flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1,
      borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginTop: 10,
    },
    scriptureText: { flex: 1, fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    rosterCard: { marginTop: 14, gap: 8 },
    rosterRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, padding: 12 },
    rosterAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center" },
    rosterAvatarText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    rosterName: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rosterStatus: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    enterBtn: {
      flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
      backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 15, marginTop: 24,
    },
    enterBtnDisabled: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    enterBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    enterBtnTextDisabled: { color: c.textMuted },
    cancelBtn: { borderWidth: 1.5, borderColor: "#DC2626", borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 12 },
    cancelBtnText: { color: "#DC2626", fontSize: 13, fontFamily: "Inter_700Bold" },
  });
}
