import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { getApiUrl } from "@/lib/apiUrl";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";

export const CRISIS_RESOURCES = [
  { label: "Call a crisis line", value: "[INSERT REGIONAL CRISIS LINE]" },
  { label: "Text a crisis line", value: "[INSERT REGIONAL CRISIS TEXT LINE]" },
  { label: "Emergency services", value: "[INSERT LOCAL EMERGENCY NUMBER, e.g. 911 / 999 / 112]" },
];

export function CrisisResourcesModal({
  visible,
  onClose,
  statusText,
}: {
  visible: boolean;
  onClose: () => void;
  statusText: string;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { submitHelpRequest } = useData();
  const [callingGuide, setCallingGuide] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);

  // Lets the person in crisis call their own assigned peer guide directly,
  // rather than waiting passively — reuses the same 1:1 call infrastructure
  // as messages/[id].tsx's phone icon, tagged call_type='crisis' so it's
  // uncancellable on the recipient's incoming screen (see incoming.tsx's
  // isCrisis handling) and interrupts any call they're already in (see
  // IncomingCallHost in _layout.tsx). Also logs a p2p_help_requests row so
  // this shows up in the moderation dashboard (admin/help-requests.tsx)
  // the same way every other crisis-tier alert does.
  async function callMyPeerGuide() {
    if (!profile?.id || callingGuide) return;
    setCallingGuide(true);
    setGuideError(null);
    try {
      const guideRes = await authedFetch(`/discipleship/my-peer-guide/${profile.id}`);
      if (!guideRes.ok) {
        // Safety-critical distinction: a request failure (auth/network) must
        // never be presented as "you have no peer guide" — that's a false
        // and potentially harmful message to show someone in crisis.
        setGuideError("Couldn't reach your peer guide right now. Please try again or use a crisis resource below.");
        return;
      }
      const { peerGuideId, peerGuideName } = await guideRes.json();
      if (!peerGuideId) {
        setGuideError("You don't have an assigned peer guide yet.");
        return;
      }

      void submitHelpRequest({ tier: "crisis", note: "Called their peer guide directly from the crisis screen." });

      const channelRes = await fetch(`${getApiUrl()}/calls/peer-channel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentUserId: profile.id, otherUserId: peerGuideId }),
      });
      const { channelName } = await channelRes.json();

      const startRes = await fetch(`${getApiUrl()}/calls/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, callType: "crisis", callerId: profile.id, recipientId: peerGuideId }),
      });
      const { callLogId, incomingCallId } = await startRes.json();

      onClose();
      router.push({
        pathname: "/call/audio" as any,
        params: {
          channelName, otherUserId: peerGuideId, otherUserName: peerGuideName ?? "Your peer guide",
          callType: "crisis", isInitiator: "true", callId: incomingCallId, callLogId,
        },
      });
    } catch {
      setGuideError("Couldn't start the call. Please try again.");
    } finally {
      setCallingGuide(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.sheetHeader}>
            <Ionicons name="heart" size={22} color="#B91C1C" />
            <Text style={styles.sheetTitle}>You are not alone</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.textMid} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetBody}>
              If you are in immediate danger or crisis, please reach out right now:
            </Text>
            {CRISIS_RESOURCES.map((r) => (
              <View key={r.label} style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>{r.label}</Text>
                <Text style={styles.resourceValue}>{r.value}</Text>
              </View>
            ))}

            <TouchableOpacity style={styles.callGuideBtn} onPress={callMyPeerGuide} disabled={callingGuide} activeOpacity={0.85}>
              {callingGuide ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Text style={{ fontSize: 15 }}>📞</Text>
                  <Text style={styles.callGuideBtnText}>Call My Peer Guide</Text>
                </>
              )}
            </TouchableOpacity>
            {guideError && <Text style={styles.guideErrorText}>{guideError}</Text>}

            <Text style={styles.disclaimer}>
              These are placeholders. Real, region-appropriate crisis line numbers must be
              added before this app launches to real users.
            </Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.lightCream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: "80%",
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  closeBtn: { padding: 4 },
  sheetBody: { fontSize: 14, color: colors.textMid, lineHeight: 20, marginBottom: 16, fontFamily: "Inter_400Regular" },
  resourceRow: {
    backgroundColor: "rgba(185,28,28,0.06)",
    borderWidth: 1, borderColor: "rgba(185,28,28,0.2)",
    borderRadius: 12, padding: 12, marginBottom: 10,
  },
  resourceLabel: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  resourceValue: { fontSize: 14, color: "#B91C1C", fontWeight: "700", marginTop: 4, fontFamily: "Inter_700Bold" },
  callGuideBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.accentGreen, borderRadius: 12, paddingVertical: 13, marginTop: 6,
  },
  callGuideBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  guideErrorText: { fontSize: 12, color: "#B91C1C", marginTop: 8, fontFamily: "Inter_400Regular", textAlign: "center" },
  disclaimer: { fontSize: 12, color: colors.textMuted, marginTop: 8, fontStyle: "italic", fontFamily: "Inter_400Regular" },
  statusText: { fontSize: 13, color: colors.accentGreen, marginTop: 16, fontFamily: "Inter_500Medium" },
});
