import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Modal, Platform } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import colors from "@/constants/colors";

interface PendingAlert {
  id: string; discipleId: string; discipleName: string; careType: string;
  messageSent: string | null; notifiedAt: string;
}

const OUTCOME_OPTIONS: { key: string; label: string }[] = [
  { key: "reached_them", label: "I reached them" },
  { key: "left_message", label: "Left a message" },
  { key: "no_answer", label: "No answer" },
];

export default function PastoralAlertScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();

  const [alerts, setAlerts] = useState<PendingAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [callingId, setCallingId] = useState<string | null>(null);
  const [outcomeAlert, setOutcomeAlert] = useState<PendingAlert | null>(null);
  const [submittingOutcome, setSubmittingOutcome] = useState(false);
  const justCalledRef = useRef<PendingAlert | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/pastoral-care/guide-alerts/${profile.id}`);
      setAlerts(await res.json());
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => {
    load();
    if (justCalledRef.current) {
      setOutcomeAlert(justCalledRef.current);
      justCalledRef.current = null;
    }
  }, [load]));

  async function callNow(alert: PendingAlert) {
    if (!profile?.id || callingId) return;
    setCallingId(alert.id);
    try {
      const channelRes = await fetch(`${getApiUrl()}/calls/peer-channel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentUserId: profile.id, otherUserId: alert.discipleId }),
      });
      const { channelName } = await channelRes.json();

      const startRes = await fetch(`${getApiUrl()}/calls/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, callType: "pastoral", callerId: profile.id, recipientId: alert.discipleId }),
      });
      const { callLogId, incomingCallId } = await startRes.json();

      justCalledRef.current = alert;
      router.push({
        pathname: "/call/audio" as any,
        params: {
          channelName, otherUserId: alert.discipleId, otherUserName: alert.discipleName,
          callType: "pastoral", isInitiator: "true", callId: incomingCallId, callLogId,
        },
      });
    } catch {
      justCalledRef.current = null;
    } finally {
      setCallingId(null);
    }
  }

  async function submitOutcome(outcome: string) {
    if (!outcomeAlert) return;
    setSubmittingOutcome(true);
    try {
      await fetch(`${getApiUrl()}/pastoral-care/call-outcome`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId: outcomeAlert.id, outcome }),
      });
      setAlerts((prev) => prev.filter((a) => a.id !== outcomeAlert.id));
      setOutcomeAlert(null);
    } finally {
      setSubmittingOutcome(false);
    }
  }

  const topPad = insets.top + (Platform.OS === "web" ? 20 : 0);

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Peer Guide Alerts</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : alerts.length === 0 ? (
        <View style={styles.centerFill}>
          <Ionicons name="checkmark-circle-outline" size={40} color={colors.borderBeige} />
          <Text style={styles.emptyText}>No pending check-ins right now.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          {alerts.map((a) => (
            <View key={a.id} style={styles.card}>
              <Text style={styles.cardName}>{a.discipleName}</Text>
              {a.messageSent ? <Text style={styles.cardMessage}>{a.messageSent}</Text> : null}
              <TouchableOpacity style={styles.callBtn} onPress={() => callNow(a)} disabled={!!callingId}>
                {callingId === a.id ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Text style={{ fontSize: 15 }}>📞</Text>
                    <Text style={styles.callBtnText}>Call {a.discipleName} Now</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!outcomeAlert} transparent animationType="fade" onRequestClose={() => setOutcomeAlert(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>How did the call with {outcomeAlert?.discipleName} go?</Text>
            {OUTCOME_OPTIONS.map((o) => (
              <TouchableOpacity key={o.key} style={styles.outcomeBtn} onPress={() => submitOutcome(o.key)} disabled={submittingOutcome}>
                <Text style={styles.outcomeBtnText}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.navBorder, gap: 12 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 16, gap: 10 },
  cardName: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  cardMessage: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
  callBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.accentGreen, borderRadius: 12, paddingVertical: 12 },
  callBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: "#fff", borderRadius: 18, padding: 22, width: "100%", gap: 10 },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 4, textAlign: "center" },
  outcomeBtn: { borderWidth: 1.5, borderColor: colors.accentGreen, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  outcomeBtnText: { color: colors.accentGreen, fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
});