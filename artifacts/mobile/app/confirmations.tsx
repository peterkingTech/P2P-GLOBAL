import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, ActivityIndicator, Image } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData, PendingPeerConfirmation, PeerConfirmationType } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";
import { timeAgo } from "@/lib/timeFormat";
import { Avatar } from "@/components/Avatar";

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
        <Avatar photoUrl={item.actorPhotoUrl} fallbackIcon={ACTION_ICON[item.confirmationType]} size={36} style={styles.avatar} />
        <View style={{ flex: 1 }}>
          <Text style={styles.actionText}>
            <Text style={styles.actorName}>{item.actorName}</Text> {ACTION_LABEL[item.confirmationType]}
          </Text>
          <Text style={styles.timeText}>{timeAgo(item.createdAt, "ago")}</Text>
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
        <AppButton label="Not quite" onPress={() => handle("decline")} variant="secondary" disabled={submitting !== null} loading={submitting === "decline"} style={{ flex: 1 }} palette="fixedLight" />
        <AppButton label="Yes, confirm" onPress={() => handle("confirm")} icon="checkmark" disabled={submitting !== null} loading={submitting === "confirm"} style={{ flex: 1 }} palette="fixedLight" />
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
        <TouchableOpacity accessibilityLabel="Back" accessibilityRole="button" hitSlop={10} onPress={() => router.back()} style={styles.backBtn}>
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
});
