import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import {
  getInvitation, acceptInvitation, declineInvitation, cancelInvitation, type PrayerInvitation,
} from "@/lib/prayerCoordinationApi";
import { deviceTimezone, zoneShortLabel, formatTimeInZone, relativeDayLabel, formatDuration } from "@/lib/prayerTimeDisplay";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting response", accepted: "Accepted", declined: "Declined", cancelled: "Cancelled", expired: "Expired",
};

// Never falsely equates two timezones — the viewer's own local time is
// always computed from their device's real timezone; the other party's
// local time (when known) is computed the same way, from the same UTC
// instant, in their own zone. If it's genuinely the same clock time, that
// is what will show; if not, both are shown honestly, side by side.
export default function PrayerInvitationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<PrayerInvitation | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setInvitation(await getInvitation(id));
    } catch (e: any) {
      showAlert("Couldn't load this invitation", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isRecipient = invitation?.recipientId === profile?.id;
  const myTz = deviceTimezone();
  const otherTz = invitation ? (isRecipient ? invitation.requesterTimezone : invitation.recipientTimezone) : null;
  const otherName = invitation ? (isRecipient ? invitation.requesterName : invitation.recipientName) : null;

  async function handleAccept() {
    if (!invitation) return;
    setBusy(true);
    try {
      const result = await acceptInvitation(invitation.id);
      router.replace({ pathname: "/prayer/gathering/[id]", params: { id: result.gathering.id } } as any);
    } catch (e: any) {
      showAlert("Couldn't accept this invitation", e.message ?? "Please try again.");
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function handleDecline() {
    if (!invitation) return;
    setBusy(true);
    try {
      await declineInvitation(invitation.id);
      router.back();
    } catch (e: any) {
      showAlert("Couldn't decline this invitation", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function handleCancel() {
    if (!invitation) return;
    setBusy(true);
    try {
      await cancelInvitation(invitation.id);
      router.back();
    } catch (e: any) {
      showAlert("Couldn't cancel this invitation", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !invitation) {
    return <View style={[styles.screen, styles.centerFill]}><ActivityIndicator color={c.accentGreen} /></View>;
  }
  if (!invitation) {
    return <View style={[styles.screen, styles.centerFill]}><Text style={styles.emptyText}>This invitation is not available.</Text></View>;
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Prayer Invitation</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.iconWrap}><Text style={{ fontSize: 40 }}>🙏</Text></View>

        <Text style={styles.headline}>
          {isRecipient
            ? `${otherName ?? "Someone"} would like to pray with you.`
            : `You invited ${otherName ?? "someone"} to pray.`}
        </Text>

        <View style={styles.timeCard}>
          <Text style={styles.timeDay}>{relativeDayLabel(invitation.proposedStartAt)}</Text>
          <View style={styles.timeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.timeValue}>{formatTimeInZone(invitation.proposedStartAt, myTz)}</Text>
              <Text style={styles.timeZoneLabel}>You · {zoneShortLabel(myTz)}</Text>
            </View>
            {otherTz && (
              <View style={{ flex: 1 }}>
                <Text style={styles.timeValue}>{formatTimeInZone(invitation.proposedStartAt, otherTz)}</Text>
                <Text style={styles.timeZoneLabel}>{otherName ?? "Them"} · {zoneShortLabel(otherTz)}</Text>
              </View>
            )}
          </View>
          <Text style={styles.durationText}>{formatDuration(invitation.proposedStartAt, invitation.proposedEndAt)}</Text>
        </View>

        {!!invitation.message && (
          <View style={styles.focusCard}>
            <Text style={styles.focusLabel}>Focus</Text>
            <Text style={styles.focusText}>{invitation.message}</Text>
          </View>
        )}

        {invitation.status !== "pending" && (
          <Text style={styles.statusPill}>{STATUS_LABEL[invitation.status]}</Text>
        )}

        {invitation.status === "pending" && isRecipient && (
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.declineBtn} onPress={handleDecline} disabled={busy}>
              <Text style={styles.declineBtnText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptBtnText}>Accept</Text>}
            </TouchableOpacity>
          </View>
        )}
        {invitation.status === "pending" && !isRecipient && (
          <TouchableOpacity style={styles.cancelInviteBtn} onPress={handleCancel} disabled={busy}>
            {busy ? <ActivityIndicator color="#DC2626" size="small" /> : <Text style={styles.cancelInviteBtnText}>Cancel Invitation</Text>}
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
    iconWrap: { alignItems: "center", marginTop: 12, marginBottom: 8 },
    headline: { fontSize: 16, color: c.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center", lineHeight: 22, marginBottom: 20 },
    timeCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 16, padding: 18, alignItems: "center" },
    timeDay: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
    timeRow: { flexDirection: "row", width: "100%", gap: 12 },
    timeValue: { fontSize: 26, color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    timeZoneLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 2 },
    durationText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 12 },
    focusCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, marginTop: 14 },
    focusLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
    focusText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
    statusPill: {
      alignSelf: "center", marginTop: 20, fontSize: 12, fontFamily: "Inter_700Bold", color: c.textMuted,
      backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    },
    actionsRow: { flexDirection: "row", gap: 12, marginTop: 28 },
    declineBtn: { flex: 1, borderWidth: 1.5, borderColor: "#DC2626", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
    declineBtnText: { color: "#DC2626", fontSize: 15, fontFamily: "Inter_700Bold" },
    acceptBtn: { flex: 1, backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
    acceptBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    cancelInviteBtn: { borderWidth: 1.5, borderColor: "#DC2626", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 28 },
    cancelInviteBtnText: { color: "#DC2626", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
