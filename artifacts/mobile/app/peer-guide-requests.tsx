import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";

// Where a peer guide sees and Accept/Decline's incoming "Connect" requests
// from GET/PUT /discipleship/pending-requests|request (see discipleship.ts).
// Reached from the Connect hub's "Pending Peer Guide Requests" tile.

interface PendingRequest {
  id: string;
  learnerId: string;
  learnerName: string;
  learnerPhotoUrl: string | null;
  learnerCountry: string | null;
  message: string | null;
  source: "smart_match" | "direct";
  requestedAt: string;
  expiresAt: string | null;
}

export default function PeerGuideRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();

  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const res = await authedFetch(`/discipleship/pending-requests/${profile.id}`);
      const data = res.ok ? await res.json() : [];
      setRequests(Array.isArray(data) ? data : []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function respond(requestId: string, decision: "accept" | "decline") {
    if (!profile?.id) return;
    setRespondingId(requestId);
    try {
      await authedFetch(`/discipleship/request/${requestId}/respond`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: profile.id, decision }),
      });
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } finally {
      setRespondingId(null);
    }
  }

  const topPad = insets.top;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerBarTitle}>Peer Guide Requests</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} />
        ) : requests.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-done-circle-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyStateText}>No pending requests right now.</Text>
          </View>
        ) : (
          requests.map((r) => (
            <View key={r.id} style={styles.requestCard}>
              <View style={styles.requestHeader}>
                {r.learnerPhotoUrl ? (
                  <Image source={{ uri: r.learnerPhotoUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarInitial}>{r.learnerName.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.learnerName}>{r.learnerName}</Text>
                  <Text style={styles.learnerMeta}>{r.learnerCountry ?? "Location not set"}</Text>
                </View>
              </View>

              <Text style={styles.requestBody}>
                {r.source === "direct"
                  ? `${r.learnerName} wants you to be their Peer Guide.`
                  : `${r.learnerName} is looking for a peer guide and you are a great match. Will you walk alongside them?`}
              </Text>
              {r.message && (
                <View style={styles.messagePreview}>
                  <Text style={styles.messagePreviewText}>"{r.message}"</Text>
                </View>
              )}

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.declineBtn}
                  onPress={() => respond(r.id, "decline")}
                  disabled={respondingId === r.id}
                >
                  <Text style={styles.declineBtnText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.acceptBtn}
                  onPress={() => respond(r.id, "accept")}
                  disabled={respondingId === r.id}
                >
                  {respondingId === r.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptBtnText}>Accept</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige, gap: 12 },
  headerBarTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  scroll: { padding: 20, gap: 12 },
  emptyState: { alignItems: "center", paddingVertical: 40, gap: 12 },
  emptyStateText: { fontSize: 13, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },

  requestCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 16, padding: 16, marginBottom: 12,
  },
  requestHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: "#fff", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  learnerName: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  learnerMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  requestBody: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 10 },
  messagePreview: { backgroundColor: colors.lightCream, borderRadius: 10, padding: 12, marginBottom: 14 },
  messagePreviewText: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", fontStyle: "italic", lineHeight: 19 },

  actionsRow: { flexDirection: "row", gap: 10 },
  declineBtn: {
    flex: 1, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: colors.borderBeige,
  },
  declineBtnText: { fontSize: 14, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  acceptBtn: {
    flex: 1, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryGreen,
  },
  acceptBtnText: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
});