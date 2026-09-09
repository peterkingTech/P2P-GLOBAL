import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { uidFromUserId } from "@/lib/agoraUid";
import { effectiveParticipantVolume } from "@/lib/togetherAudio/mixer";
import type { TogetherAudioPrefs } from "@/lib/togetherAudio/types";

// Voice Space — Together's optional voice layer over the EXISTING, proven
// Agora infrastructure. This file does not touch useAgora, useAgoraEngine,
// any call screen, or the token route's core logic — it's a new caller of
// them, exactly the pattern app/call/group.tsx already establishes.
//
// Deliberately never imports any VALUE from "react-native-agora" (only via
// useAgoraEngine/useAgora, which are already platform-split for this) —
// a top-level value import from that package breaks the web Metro bundle,
// the exact regression this session already caused and fixed once in
// app/call/audio.tsx/video.tsx. AGORA_CONNECTION_STATE_FAILED below is a
// local numeric constant for the same reason, confirmed against the
// package's real type defs (ConnectionStateType.ConnectionStateFailed = 5).
const AGORA_CONNECTION_STATE_FAILED = 5;
const JOIN_TIMEOUT_MS = 15000; // matches the 1:1 calling fix's own join-timeout precedent
const SPEAKING_VOLUME_THRESHOLD = 40; // same threshold group.tsx/room.tsx already use

export type VoicePhase = "idle" | "connecting" | "connected" | "failed";

export interface VoiceCompanionState {
  userId: string;
  name: string;
  connected: boolean;
  speaking: boolean;
  muted: boolean;
}

interface Companion {
  userId: string;
  name: string;
}

export function useVoiceSpace(channelName: string, myUserId: string | undefined, companions: Companion[], audioPrefs: TogetherAudioPrefs) {
  const { getToken } = useAgora();
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenAppId, setTokenAppId] = useState<string | undefined>(undefined);
  const [micMuted, setMicMuted] = useState(false);
  const [listening, setListening] = useState(true);
  const [presentUids, setPresentUids] = useState<Set<number>>(new Set());
  const [speakingUids, setSpeakingUids] = useState<Set<number>>(new Set());
  const [mutedUids, setMutedUids] = useState<Set<number>>(new Set());
  const attemptRef = useRef(0);

  const myUid = useMemo(() => (myUserId ? uidFromUserId(myUserId) : null), [myUserId]);

  // uid <-> companion lookup — Agora only ever gives us back a numeric uid,
  // never the real user id, on join/leave/speaking events.
  const uidToCompanion = useMemo(() => {
    const map = new Map<number, Companion>();
    companions.forEach((c) => map.set(uidFromUserId(c.userId), c));
    return map;
  }, [companions]);

  const fetchToken = useCallback(async () => {
    if (!myUid || !myUserId) return;
    setErrorMessage(null);
    setPhase("connecting");
    try {
      const { token: t, appId } = await getToken(channelName, myUid, myUserId);
      setToken(t);
      setTokenAppId(appId);
    } catch (e: any) {
      setPhase("failed");
      setErrorMessage(e?.message ?? "Couldn't connect to Voice.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, myUid, myUserId, getToken]);

  const join = useCallback(() => {
    if (active) return;
    attemptRef.current += 1;
    setActive(true);
    fetchToken();
  }, [active, fetchToken]);

  const retry = useCallback(() => {
    attemptRef.current += 1;
    setToken(null);
    setPresentUids(new Set());
    setSpeakingUids(new Set());
    setMutedUids(new Set());
    fetchToken();
  }, [fetchToken]);

  const leave = useCallback(() => {
    setActive(false);
    setPhase("idle");
    setErrorMessage(null);
    setToken(null);
    setPresentUids(new Set());
    setSpeakingUids(new Set());
    setMutedUids(new Set());
    setMicMuted(false);
    setListening(true);
  }, []);

  // Bounded join timeout — never leaves the UI on an infinite "Connecting..."
  useEffect(() => {
    if (phase !== "connecting") return;
    const attempt = attemptRef.current;
    const timer = setTimeout(() => {
      if (attemptRef.current !== attempt) return; // a retry/leave already superseded this attempt
      setPhase((p) => (p === "connecting" ? "failed" : p));
      setErrorMessage("Unable to connect to Voice.");
    }, JOIN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const engineRef = useAgoraEngine({
    channelName: active ? channelName : "",
    token: active ? token : null,
    uid: active ? myUid : null,
    enableVideo: false,
    appId: tokenAppId,
    eventHandler: {
      onJoinChannelSuccess: () => setPhase("connected"),
      onUserJoined: (_c, uid) => setPresentUids((prev) => (prev.has(uid) ? prev : new Set(prev).add(uid))),
      onUserOffline: (_c, uid) => {
        setPresentUids((prev) => { const n = new Set(prev); n.delete(uid); return n; });
        setSpeakingUids((prev) => { const n = new Set(prev); n.delete(uid); return n; });
      },
      onUserMuteAudio: (_c, uid, muted) => {
        setMutedUids((prev) => {
          const n = new Set(prev);
          if (muted) n.add(uid); else n.delete(uid);
          return n;
        });
      },
      onAudioVolumeIndication: (_c, speakers) => {
        const loud = new Set((speakers ?? []).filter((s) => (s.volume ?? 0) > SPEAKING_VOLUME_THRESHOLD).map((s) => s.uid ?? 0));
        setSpeakingUids(loud);
      },
      onConnectionStateChanged: (_c, state) => {
        if (state === AGORA_CONNECTION_STATE_FAILED) {
          setPhase((p) => (p === "idle" ? p : "failed"));
          setErrorMessage("The Voice connection failed.");
        }
      },
      onError: (err) => console.log("VOICE SPACE error", err),
    },
  });

  useEffect(() => {
    if (phase !== "connected") return;
    engineRef.current?.enableAudioVolumeIndication(500, 3, true);
  }, [engineRef, phase]);

  // TogetherAudio integration — Voice Space's own personal-volume commands
  // to the real Agora engine, per known present companion. Media stays on
  // its own completely separate path (SyncedMediaPlayer/YouTubePlayer).
  useEffect(() => {
    if (phase !== "connected" || !engineRef.current) return;
    presentUids.forEach((uid) => {
      const companion = uidToCompanion.get(uid);
      if (!companion) return;
      const v = effectiveParticipantVolume(audioPrefs, companion.userId);
      engineRef.current?.adjustUserPlaybackSignalVolume(uid, Math.round(v * 100));
    });
  }, [phase, engineRef, presentUids, uidToCompanion, audioPrefs]);

  const toggleMic = useCallback(() => {
    const next = !micMuted;
    setMicMuted(next);
    engineRef.current?.muteLocalAudioStream(next);
  }, [engineRef, micMuted]);

  // "Listening" — stop hearing Voice Space entirely, independent of Media
  // and independent of one's own microphone (spec's explicit requirement).
  const toggleListening = useCallback(() => {
    const next = !listening;
    setListening(next);
    engineRef.current?.muteAllRemoteAudioStreams(!next);
  }, [engineRef, listening]);

  const companionStates: VoiceCompanionState[] = useMemo(
    () =>
      companions.map((c) => {
        const uid = uidFromUserId(c.userId);
        return {
          userId: c.userId,
          name: c.name,
          connected: presentUids.has(uid),
          speaking: speakingUids.has(uid),
          muted: mutedUids.has(uid),
        };
      }),
    [companions, presentUids, speakingUids, mutedUids]
  );

  return { phase, errorMessage, join, retry, leave, micMuted, toggleMic, listening, toggleListening, companionStates };
}