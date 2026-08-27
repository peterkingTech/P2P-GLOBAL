import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { useData, AppNotification } from "@/contexts/DataContext";
import { getCurrentGroupStudy } from "@/lib/groupStudy";
import SettingsSubHeader from "@/components/SettingsSubHeader";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  study_leader_transfer: "school-outline",
  circle_session_start: "people-outline",
  study_invitation_received: "mail-unread-outline",
  study_invitation_accepted: "checkmark-circle-outline",
  study_invitation_declined: "close-circle-outline",
  study_participant_removed: "exit-outline",
  study_ended: "flag-outline",
};

// Every Study Together notification type shares this prefix — one rule
// covers the whole lifecycle (invitation received/accepted/declined,
// leader transfer, removed, ended) without listing each type by name here,
// so a future addition to the family is categorized automatically.
function categoryFor(type: string | null): { emoji: string; label: string } | null {
  if (type?.startsWith("study_")) return { emoji: "📖", label: "Study Together" };
  return null;
}

// Types with a live destination worth checking before navigating — every
// other type (accepted/declined/removed) is informational-only, matching
// C7's original reasoning: there's no honest "current state" screen to send
// the user to for something that already fully happened.
const NAVIGABLE_TYPES = new Set(["study_leader_transfer", "study_invitation_received", "study_ended"]);

// Study Together C7 — minimal production Notification Center. No prior
// browsable inbox existed in the app (p2p_notifications previously drove
// only a single narrow realtime trigger for circle_session_start); this is
// the first general-purpose list/read UI for it, deliberately kept small
// per the spec's own anti-spam instruction rather than a full social feed.
export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { getMyNotifications, markNotificationRead, markAllNotificationsRead } = useData();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const hasUnread = notifications.some((n) => !n.isRead);

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((x) => ({ ...x, isRead: true })));
    await markAllNotificationsRead();
  }

  const load = useCallback(async () => {
    setLoading(true);
    setNotifications(await getMyNotifications());
    setLoading(false);
  }, [getMyNotifications]);

  useEffect(() => { load(); }, [load]);

  async function handlePress(n: AppNotification) {
    if (!n.isRead) {
      markNotificationRead(n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
    }

    // C7.6 — deep link, with an honest fallback if the session/call has
    // since ended rather than navigating into a broken/stale screen. Shared
    // across every navigable Study Together type (leader transfer, an
    // invitation worth reopening, or a just-ended session) since all three
    // resolve to the same "is this call still live" check and the same
    // call-screen destination.
    if (NAVIGABLE_TYPES.has(n.notificationType ?? "") && n.data?.callId) {
      setNavigatingId(n.id);
      try {
        const current = await getCurrentGroupStudy(n.data.callId as string);
        if (current.callEnded || !current.channelName) {
          showAlert("Session ended", "This study session is no longer active.");
        } else {
          router.push({
            pathname: current.callType === "video" ? "/call/video" : "/call/audio",
            params: {
              channelName: current.channelName, callLogId: n.data.callId as string,
              conversationId: current.conversationId ?? "", callType: current.callType ?? "audio",
              isInitiator: "false",
            },
          } as any);
        }
      } catch {
        showAlert("Couldn't open this", "This study session may no longer be available.");
      } finally {
        setNavigatingId(null);
      }
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <SettingsSubHeader title="Notifications" />
      {hasUnread && (
        <TouchableOpacity style={styles.markAllRow} onPress={handleMarkAllRead}>
          <Text style={styles.markAllText}>Mark all as read</Text>
        </TouchableOpacity>
      )}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 30 }} />
        ) : notifications.length === 0 ? (
          <Text style={styles.emptyText}>No notifications yet.</Text>
        ) : (
          notifications.map((n) => {
            const category = categoryFor(n.notificationType);
            return (
              <TouchableOpacity
                key={n.id}
                style={[styles.row, !n.isRead && styles.rowUnread]}
                onPress={() => handlePress(n)}
                disabled={navigatingId === n.id}
                activeOpacity={0.8}
              >
                <Ionicons name={TYPE_ICON[n.notificationType ?? ""] ?? "notifications-outline"} size={20} color={n.isRead ? colors.textMuted : colors.accentGreen} />
                <View style={{ flex: 1 }}>
                  {category && <Text style={styles.categoryLabel}>{category.emoji} {category.label}</Text>}
                  <Text style={[styles.rowTitle, !n.isRead && styles.rowTitleUnread]}>{n.title}</Text>
                  {n.message && <Text style={styles.rowMessage} numberOfLines={2}>{n.message}</Text>}
                  <Text style={styles.rowDate}>{new Date(n.createdAt).toLocaleString()}</Text>
                </View>
                {navigatingId === n.id ? <ActivityIndicator size="small" color={colors.accentGreen} /> : !n.isRead && <View style={styles.unreadDot} />}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    content: { paddingHorizontal: 20, paddingTop: 16, gap: 10 },
    emptyText: { color: c.textMuted, fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 40 },
    markAllRow: { alignItems: "flex-end", paddingHorizontal: 20, paddingTop: 10 },
    markAllText: { color: c.accentGreen, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    categoryLabel: { fontSize: 11, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", marginBottom: 2 },
    row: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14,
    },
    rowUnread: { borderColor: c.accentGreen },
    rowTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rowTitleUnread: { fontWeight: "700", fontFamily: "Inter_700Bold" },
    rowMessage: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    rowDate: { fontSize: 10, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accentGreen },
  });
}