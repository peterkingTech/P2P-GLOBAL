import { useEffect, useMemo, useRef } from "react";
import { useLocalSearchParams, usePathname } from "expo-router";
import { setActiveGathering, clearActiveGathering } from "@/lib/activeGathering";

/**
 * A 1:1 call screen publishes itself while the call is live, so a screen
 * opened ON TOP of it (the Bible reader, from Study Together) shows the
 * "Call in progress" Return bar with the same mic toggle. Purely a mirror
 * of the call's own state: it never starts, joins, mutes or ends anything —
 * the bar's mic button calls the screen's own toggleMute.
 */
export function usePublishActiveCall({ callKey, live, muted, toggleMute }: {
  callKey: string | null | undefined;
  live: boolean;
  muted: boolean;
  toggleMute: () => void;
}) {
  const pathname = usePathname();
  const raw = useLocalSearchParams();
  const toggleRef = useRef(toggleMute);
  toggleRef.current = toggleMute;
  // Route params as plain strings (what dismissTo needs to find this screen).
  const paramsKey = JSON.stringify(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")));
  const params = useMemo(() => JSON.parse(paramsKey) as Record<string, string>, [paramsKey]);
  const sessionId = callKey ? `call:${callKey}` : null;

  useEffect(() => {
    if (!sessionId) return;
    if (!live) { clearActiveGathering(sessionId); return; }
    setActiveGathering({
      sessionId, kind: "call",
      returnTo: { pathname, params },
      voiceConnected: true, micMuted: muted, toggleMic: () => toggleRef.current(),
      sharedPassage: null,
    });
  }, [sessionId, live, muted, pathname, params]);
  useEffect(() => () => { if (sessionId) clearActiveGathering(sessionId); }, [sessionId]);
}
