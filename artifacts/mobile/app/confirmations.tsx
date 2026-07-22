import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, ActivityIndicator, Image } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData, PendingPeerConfirmation, PeerConfirmationType } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const ACTION_LABEL: Record<PeerConfirmationType, string> = {
  encouragement: "left you encouraging feedback",
  compassion: "prayed for you",
  service: "helped you through a lesson",
  fellowship: "had a peer discussion session with you",
  unity: "",
  global: "",
};

const ACTION_ICON: Record<PeerConfirmationType, keyof typeof Ionicons.glyphMap> = {
  encouragement: "chatbubble-ellipses",
  compassion: "heart",
  service: "hand-left",
  fellowship: "people",
  unity: "globe",
  global: "globe",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function ConfirmationCard({ item }: { item: PendingPeerConfirmation }) {
  const { confirmPeer, declinePeer } = useData();
  const [submitting, setSubmitting] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(action: "confirm" | "decline") {
    if (submitting) return;
    setSubmitting(action);
    setError(null);
    const err = action === "confirm" ? await confirmPeer(item.id) : await declinePeer(item.id);
    setSubmitting(null);
    if (err) setError(err);
    else if (action === "confirm") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Haptics.selectionAsync();
  }

  const expiryDays = item.expiresAt ? daysUntil(item.expiresAt) : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {item.actorPhotoUrl ? (
          <Image source={{ uri: item.actorPhotoUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Ionicons name={ACTION_ICON[item.confirmationType]} size={16} color={colors.accentGreen} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.actionText}>
            <Text style={styles.actorName}>{item.actorName}</Text> {ACTION_LABEL[item.confirmationType]}
          </Text>
          <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
        </View>
        {expiryDays !== null && expiryDays <= 3 && (
          <View style={styles.expiryBadge}>
            <Ionicons name="time-outline" size={11} color={colors.amber} />
            <Text style={styles.expiryText}>{expiryDays <= 0 ? "expires today" : `${expiryDays}d left`}</Text>
          </View>
        )}
      </View>

      {item.contextSummary && (
        <Text style={styles.contextText} numberOfLines={2}>{item.contextSummary}</Text>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.declineBtn]}
          onPress={() => handle("decline")}
          disabled={submitting !== null}
          activeOpacity={0.85}
        >
          {submitting === "decline" ? (
            <ActivityIndicator color={colors.textMuted} size="small" />
          ) : (
            <Text style={styles.declineBtnText}>Not quite</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.confirmBtn]}
          onPress={() => handle("confirm")}
          disabled={submitting !== null}
          activeOpacity={0.85}
        >
          {submitting === "confirm" ? (
            <ActivityIndicator color={colors.cream} size="small" />
          ) : (
            <>
              <Ionicons name="checkmark" size={15} color={colors.cream} />
              <Text style={styles.confirmBtnText}>Yes, confirm</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ConfirmationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { pendingConfirmations } = useData();

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pending Confirmations</Text>
      </View>

      {pendingConfirmations.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-done-circle" size={48} color={colors.borderBeige} />
          <Text style={styles.emptyTitle}>No pending confirmations</Text>
          <Text style={styles.emptySub}>Keep encouraging your peers!</Text>
        </View>
      ) : (
        <FlatList
          data={pendingConfirmations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ConfirmationCard item={item} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginTop: 8 },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },

  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
  actorName: { fontWeight: "700", fontFamily: "Inter_700Bold" },
  timeText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
  expiryBadge: {
    flexDirection: "row", gap: 3, alignItems: "center",
    backgroundColor: "rgba(217,164,65,0.12)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  expiryText: { fontSize: 10, color: colors.amber, fontFamily: "Inter_500Medium" },

  contextText: {
    fontSize: 13, color: colors.textMid, fontStyle: "italic", lineHeight: 19,
    fontFamily: "Inter_400Regular", marginBottom: 12,
    backgroundColor: colors.cardBeige, borderRadius: 10, padding: 10,
  },
  errorText: { fontSize: 12, color: "#C0392B", marginBottom: 10, fontFamily: "Inter_400Regular" },

  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: { flex: 1, height: 40, borderRadius: 10, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  declineBtn: { backgroundColor: colors.cardBeige, borderWidth: 1, borderColor: colors.borderBeige },
  declineBtnText: { fontSize: 13, fontWeight: "600", color: colors.textMuted, fontFamily: "Inter_600SemiBold" },
  confirmBtn: { backgroundColor: colors.primaryGreen },
  confirmBtnText: { fontSize: 13, fontWeight: "600", color: colors.cream, fontFamily: "Inter_600SemiBold" },
});
