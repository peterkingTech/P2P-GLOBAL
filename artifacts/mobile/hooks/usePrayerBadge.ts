import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";

// The More tab's badge: unread prayer notifications (invitations, gatherings, testimonies… —
// every type starting "prayer_") that arrived since the person last opened More → Prayer.
// Opening Prayer clears it (markPrayerSeen); reading the notifications clears them too.

const listeners = new Set<(at: string) => void>();
const key = (userId: string) => `prayer_seen_at_${userId}`;

/** Call when Prayer is shown: the badge clears on every screen. */
export async function markPrayerSeen(userId: string | undefined): Promise<void> {
  if (!userId) return;
  const at = new Date().toISOString();
  listeners.forEach((l) => l(at));
  await AsyncStorage.setItem(key(userId), at).catch(() => {});
}

export function usePrayerBadge(): number {
  const { profile } = useAuth();
  const { unreadNotificationCount, getMyNotifications } = useData();
  const userId = profile?.id;
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(key(userId)).then((v) => setSeenAt(v ?? "1970-01-01T00:00:00Z")).catch(() => setSeenAt("1970-01-01T00:00:00Z"));
    listeners.add(setSeenAt);
    return () => { listeners.delete(setSeenAt); };
  }, [userId]);

  const recount = useCallback(async () => {
    if (!userId || !seenAt || unreadNotificationCount === 0) { setCount(0); return; }
    try {
      const rows = await getMyNotifications();
      setCount(rows.filter((n) => !n.isRead && (n.notificationType ?? "").startsWith("prayer_") && n.createdAt > seenAt).length);
    } catch { /* offline: keep the last count */ }
  }, [userId, seenAt, unreadNotificationCount, getMyNotifications]);

  useEffect(() => { recount(); }, [recount]);
  return count;
}
