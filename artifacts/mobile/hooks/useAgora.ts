import { useState, useCallback } from "react";
import { getApiUrl } from "@/lib/apiUrl";

// Note: no `AgoraUIKit` import here — that's a separate package
// (agora-rn-uikit), not exported by react-native-agora itself. Call screens
// (app/call/audio.tsx, video.tsx, group.tsx, room.tsx) use the raw engine
// API (createAgoraRtcEngine) directly, since that's what actually renders
// video surfaces and manages the connection; this hook only owns fetching a
// token and holding the resulting call config.
const APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID || "";

export type CallType = "audio" | "video";

export interface AgoraConfig {
  channelName: string;
  token: string;
  uid: number;
  appId: string;
}

export function useAgora() {
  const [isInCall, setIsInCall] = useState(false);
  const [config, setConfig] = useState<AgoraConfig | null>(null);

  // No Authorization header — this API has no auth-token middleware
  // (see api-server/src/routes/calls.ts); every route here takes the
  // caller's identity directly in the request body, same as the rest of
  // this app's non-admin endpoints.
  //
  // userId is optional and only enforced server-side for p2p_ peer
  // channels (Study Together C1's group-calling authorization) — Peer
  // Circle/Break Room callers (group.tsx, room.tsx) don't need to pass it
  // and are completely unaffected.
  const getToken = useCallback(async (channelName: string, uid: number, userId?: string): Promise<string> => {
    const apiUrl = getApiUrl();
    const response = await fetch(`${apiUrl}/calls/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName, uid, userId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to get token");
    return data.token as string;
  }, []);

  const startCall = useCallback(async (channelName: string, uid: number) => {
    const token = await getToken(channelName, uid);
    setConfig({ channelName, token, uid, appId: APP_ID });
    setIsInCall(true);
  }, [getToken]);

  const endCall = useCallback(() => {
    setIsInCall(false);
    setConfig(null);
  }, []);

  return { isInCall, config, getToken, startCall, endCall, appId: APP_ID };
}