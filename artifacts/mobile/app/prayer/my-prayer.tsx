import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth, supabase } from "@/contexts/AuthContext";
import {
  getMyCommitments, getMyGatherings, getMyPrayerRequests, getMyInvitations, getPrayerRequest,
  type PrayerCommitment, type PrayerGathering, type PrayerCoordRequest,
} from "@/lib/prayerCoordinationApi";
import { relativeDayLabel, formatTimeInZone, deviceTimezone } from "@/lib/prayerTimeDisplay";

interface JournalPreview { id: string; prayer_text: string; is_answered: boolean; created_at: string }

const STATUS_LABEL: Record<string, string> = { open: "Open", answered: "Answered", cancelled: "Closed", expired: "Expired" };

// Prayer 2.0 Stage 4 — "My Prayer": everything a person is actually
// carrying, in one place. No streaks, no scores, no leaderboard — every
// number here is a real count of real rows (commitments, gatherings,
// requests), never a fabricated activity metric.
export default function MyPrayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const tz = deviceTimezone();

  const [loading, setLoading] = useState(true);
  const [commitments, setCommitments] = useState<PrayerCommitment[]>([]);
  const [gatherings, setGatherings] = useState<PrayerGathering[]>([]);
  const [requests, setRequests] = useState<PrayerCoordRequest[]>([]);
  const [journal, setJournal] = useState<JournalPreview[]>([]);
  const [requestTitles, setRequestTitles] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [c1, g1, r1, invites, { data: j1 }] = await Promise.all([
        getMyCommitments(), getMyGatherings(), getMyPrayerRequests(), getMyInvitations(),
        supabase.from("p2p_prayer_journal").select("id,prayer_text,is_answered,created_at").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(3),
      ]);
      setCommitments(c1.filter((x) => x.status === "active"));
      setGatherings(g1);
      setRequests(r1);
      setJournal((j1 ?? []) as JournalPreview[]);

      // Resolve titles for committed-to requests not among the user's own.
      const missingIds = c1.map((x) => x.requestId).filter((id) => !r1.some((r) => r.id === id));
      if (missingIds.length) {
        const titles: Record<string, string> = {};
        await Promise.all(missingIds.map(async (id) => {
          try {
            const req = await getPrayerRequest(id);
            titles[id] = req.title;
          } catch { /* request may have been removed/expired since committing */ }
        }));
        setRequestTitles(titles);
      }
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const upcoming = gatherings.filter((g) => g.status === "scheduled").sort((a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime());
  const recentCompleted = gatherings.filter((g) => g.status === "completed").sort((a, b) => new Date(b.scheduledStartAt).getTime() - new Date(a.scheduledStartAt).getTime()).slice(0, 5);
  const openRequests = requests.filter((r) => r.status === "open");
  const answeredRequests = requests.filter((r) => r.status === "answered");

  function requestTitleFor(id: string): string {
    return requests.find((r) => r.id === id)?.title ?? requestTitles[id] ?? "A prayer request";
  }

  if (loading) return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>🙏 My Prayer</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.sectionHeading}>PRAYER COMMITMENTS</Text>
        {commitments.length === 0 ? (
          <Text style={styles.mutedText}>You haven't committed to pray for anything yet.</Text>
        ) : (
          commitments.map((cm) => (
            <View key={cm.id} style={styles.row}>
              <Ionicons name="heart" size={16} color={c.accentGreen} />
              <Text style={styles.rowText} numberOfLines={1}>{requestTitleFor(cm.requestId)}</Text>
            </View>
          ))
        )}

        <Text style={[styles.sectionHeading, { marginTop: 22 }]}>UPCOMING PRAYER</Text>
        {upcoming.length === 0 ? (
          <Text style={styles.mutedText}>Nothing scheduled yet.</Text>
        ) : (
          upcoming.map((g) => (
            <TouchableOpacity key={g.id} style={styles.row} onPress={() => router.push({ pathname: "/prayer/gathering/[id]", params: { id: g.id } } as any)}>
              <Ionicons name="calendar" size={16} color={c.accentGreen} />
              <Text style={styles.rowText} numberOfLines={1}>{g.prayerFocus || "Prayer together"} · {relativeDayLabel(g.scheduledStartAt)} {formatTimeInZone(g.scheduledStartAt, tz)}</Text>
            </TouchableOpacity>
          ))
        )}

        <Text style={[styles.sectionHeading, { marginTop: 22 }]}>RECENT PRAYER GATHERINGS</Text>
        {recentCompleted.length === 0 ? (
          <Text style={styles.mutedText}>No completed prayer gatherings yet.</Text>
        ) : (
          recentCompleted.map((g) => (
            <View key={g.id} style={styles.row}>
              <Ionicons name="checkmark-circle" size={16} color={c.accentGreen} />
              <Text style={styles.rowText} numberOfLines={1}>{g.prayerFocus || "Prayer together"} · {relativeDayLabel(g.scheduledStartAt)}</Text>
            </View>
          ))
        )}

        <Text style={[styles.sectionHeading, { marginTop: 22 }]}>MY PRAYER REQUESTS</Text>
        {openRequests.length === 0 ? (
          <Text style={styles.mutedText}>No open requests.</Text>
        ) : (
          openRequests.map((r) => (
            <View key={r.id} style={styles.row}>
              <Ionicons name="megaphone-outline" size={16} color={c.accentGreen} />
              <Text style={styles.rowText} numberOfLines={1}>{r.title}</Text>
              <Text style={styles.statusPill}>{STATUS_LABEL[r.status]}</Text>
            </View>
          ))
        )}

        <Text style={[styles.sectionHeading, { marginTop: 22 }]}>ANSWERED PRAYERS</Text>
        {answeredRequests.length === 0 ? (
          <Text style={styles.mutedText}>None yet.</Text>
        ) : (
          answeredRequests.map((r) => (
            <View key={r.id} style={styles.row}>
              <Ionicons name="sparkles" size={16} color={c.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText} numberOfLines={1}>{r.title}</Text>
                {!!r.answerNote && <Text style={styles.rowSub} numberOfLines={2}>{r.answerNote}</Text>}
              </View>
              <TouchableOpacity
                onPress={() => router.push({ pathname: "/prayer/testimony/record", params: { requestId: r.id, requestTitle: r.title } } as any)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.viewAllText}>Share</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={[styles.sectionHeaderRow, { marginTop: 22 }]}>
          <Text style={styles.sectionHeading}>PRAYER JOURNAL</Text>
          <TouchableOpacity onPress={() => router.push("/prayer/journal" as any)}>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>
        {journal.length === 0 ? (
          <Text style={styles.mutedText}>No private reflections logged yet.</Text>
        ) : (
          journal.map((j) => (
            <View key={j.id} style={styles.row}>
              {j.is_answered && <Ionicons name="checkmark-circle" size={14} color={c.accentGreen} />}
              <Text style={styles.rowText} numberOfLines={1}>{j.prayer_text}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center", flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionHeading: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginBottom: 8 },
    viewAllText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    mutedText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    row: {
      flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderWidth: 1,
      borderColor: c.borderBeige, borderRadius: 12, padding: 12, marginBottom: 8,
    },
    rowText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rowSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    statusPill: {
      fontSize: 10, fontFamily: "Inter_700Bold", color: c.accentGreen,
      backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
    },
  });
}
