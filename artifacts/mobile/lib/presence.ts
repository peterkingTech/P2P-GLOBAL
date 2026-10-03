import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/contexts/AuthContext";

// Coarse buckets from p2p_get_activity_status (migration 171). The exact
// timestamp never leaves the server.
export type ActivityStatus = "online" | "recent" | "today" | "yesterday" | "week";

const HEARTBEAT_MS = 60_000;
const POLL_MS = 60_000;

export function activityLabel(status: ActivityStatus | undefined): string | null {
  switch (status) {
    case "online": return "Active now";
    case "recent": return "Active recently";
    case "today": return "Active today";
    case "yesterday": return "Active yesterday";
    case "week": return "Active this week";
    default: return null;
  }
}

// Keeps this user's presence fresh while the app is in the foreground, and
// marks them offline immediately on background. Failures are ignored: a
// missed heartbeat just means "Active recently" instead of "Active now".
export function usePresenceHeartbeat(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const touch = (online: boolean) => {
      void supabase.rpc("p2p_touch_presence", { p_online: online }).then(() => {}, () => {});
    };
    const start = () => {
      touch(true);
      if (!timer) timer = setInterval(() => touch(true), HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
      touch(false);
    };

    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else if (state === "background") stop();
    });
    return () => {
      sub.remove();
      if (timer) clearInterval(timer);
    };
  }, [userId]);
}

// Activity status for the given peers, refreshed while the calling screen
// is focused. Only peers the server allows (mutual relationship, both
// visible) come back; everyone else is simply absent from the map.
export function useActivityStatus(userIds: (string | null | undefined)[]): Record<string, ActivityStatus> {
  const [statuses, setStatuses] = useState<Record<string, ActivityStatus>>({});
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id))).sort();
  const key = ids.join(",");
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const load = useCallback(async () => {
    const current = idsRef.current;
    if (current.length === 0) { setStatuses({}); return; }
    const { data, error } = await supabase.rpc("p2p_get_activity_status", { p_target_ids: current });
    if (error || !Array.isArray(data)) return;
    const next: Record<string, ActivityStatus> = {};
    for (const row of data as { target_id: string; status: ActivityStatus }[]) next[row.target_id] = row.status;
    setStatuses(next);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => { void load(); }, POLL_MS);
      return () => clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, key]),
  );

  return statuses;
}

export async function getMyActivityVisibility(userId: string): Promise<boolean> {
  const { data } = await supabase.from("p2p_presence").select("show_activity_status").eq("user_id", userId).maybeSingle();
  return (data?.show_activity_status as boolean | undefined) ?? true;
}

export async function setMyActivityVisibility(visible: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("p2p_set_activity_visibility", { p_visible: visible });
  return !error;
}
