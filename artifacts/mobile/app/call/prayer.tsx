import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert, Linking } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useAgora } from "@/hooks/useAgora";
import { useAgoraEngine } from "@/hooks/useAgoraEngine";
import { uidFromUserId } from "@/lib/agoraUid";
import { useActiveSpeaker } from "@/hooks/useActiveSpeaker";
import { P2PParticipantOrbit } from "@/components/call/P2PParticipantOrbit";
import { P2PControlButton } from "@/components/call/P2PControlButton";
import { getP2PCallColors } from "@/components/call/p2pCallTheme";
import type { P2PCallColors } from "@/components/call/p2pCallTheme";
import type { P2POrbitTile } from "@/components/call/P2PParticipantNode";
import { getGathering, joinGathering, leaveGathering, type PrayerGathering, type PrayerGatheringParticipant } from "@/lib/prayerCoordinationApi";

function showAlert(title: string, message: string, onDismiss?: () => void) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    onDismiss?.();
  } else {
    Alert.alert(title, message, onDismiss ? [{ text: "OK", onPress: onDismiss }] : undefined);
  }
}

const JOIN_CHANNEL_TIMEOUT_MS = 15000;
const PEER_WAIT_TIMEOUT_MS = 45000;
// Same value as app/call/audio.tsx's identical constant — see that file's
// comment for why it isn't imported from "react-native-agora" directly.
const AGORA_CONNECTION_STATE_FAILED = 5;

// Prayer 2.0 Stage 3 — reuses the EXISTING, unmodified Direct Call engine
// (useAgora/useAgoraEngine, the same hooks app/call/audio.tsx uses) and the
// same P2P Signature Call Experience components. No new Agora
// implementation, no new token/App ID/channel-hashing logic — only the
// additive prayer_gathering_ channel-prefix check in calls.ts's existing
// /calls/token switch (see that file) authorizes this. This screen adds:
// a calm, untimed preparation step before ever touching Agora, and
// server-recorded join/leave (via /prayer/gatherings/:id/join|leave, fired
// from real onJoinChannelSuccess/navigation-away, never a bare button
// click) instead of Direct Calls' own call-log reporting, since a Prayer
// Gathering already has its own record (p2p_prayer_coord_gatherings/
// _participants) — a second p2p_call_logs row would duplicate, not reuse.
export default function PrayerCallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors, resolvedMode } = useTheme();
  const p2pColors = getP2PCallColors(colors, resolvedMode);
  const styles = makeStyles(p2pColors);
  const { gatheringId } = useLocalSearchParams<{ gatheringId: string }>();

  const [loading, setLoading] = useState(true);
  const [gathering, setGathering] = useState<PrayerGathering | null>(null);
  const [participants, setParticipants] = useState<PrayerGatheringParticipant[]>([]);
  const [phase, setPhase] = useState<"prep" | "call">("prep");
  // Reuses the exact same {reference} shape and bible.com tap-through
  // pattern already used by app/lesson/[id].tsx — see the Scripture
  // control button below.
  const scriptureRef = (gathering?.scriptureReference as { reference?: string } | null)?.reference ?? null;

  const myUid = useMemo(() => (profile?.id ? uidFromUserId(profile.id) : null), [profile?.id]);
  const { getToken } = useAgora();
  const [token, setToken] = useState<string | null>(null);
  const [tokenAppId, setTokenAppId] = useState<string | undefined>(undefined);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [muted, setMuted] = useState(false);
  const activeSpeaker = useActiveSpeaker();
  const [callState, setCallState] = useState<
    "requesting_token" | "joining_channel" | "waiting_for_peer" | "connected" | "failed" | "ended"
  >("requesting_token");
  const endedRef = useRef(false);
  const failureMessageRef = useRef<string>("Unable to connect. Please try again.");

  useEffect(() => {
    if (!gatheringId) return;
    (async () => {
      try {
        const { gathering: g, participants: p } = await getGathering(gatheringId);
        setGathering(g);
        setParticipants(p);
      } catch (e: any) {
        showAlert("Couldn't load this prayer gathering", e.message ?? "Please try again.", () => router.back());
      } finally {
        setLoading(false);
      }
    })();
  }, [gatheringId, router]);

  const otherParticipant = participants.find((p) => p.userId !== profile?.id);
  const otherName = otherParticipant?.displayName || "Peer";

  const handleLeave = useCallback(async (reason: "user" | "failed" = "user") => {
    if (endedRef.current) return;
    endedRef.current = true;
    setCallState("ended");
    if (gatheringId) {
      try { await leaveGathering(gatheringId); } catch { /* the gathering is ending either way */ }
    }
    if (reason === "failed") {
      showAlert("Prayer call failed", failureMessageRef.current, () => router.replace({ pathname: "/prayer/gathering/[id]", params: { id: gatheringId } } as any));
    } else {
      router.replace({ pathname: "/prayer/complete/[id]", params: { id: gatheringId } } as any);
    }
  }, [gatheringId, router]);

  const engineRef = useAgoraEngine({
    channelName: gathering?.channelName ?? "",
    token,
    uid: myUid,
    enableVideo: false,
    appId: tokenAppId,
    eventHandler: {
      onJoinChannelSuccess: (connection) => {
        console.log("CALL DEBUG prayer: onJoinChannelSuccess", { channelName: connection.channelId, uid: connection.localUid });
        setCallState((s) => (s === "connected" ? s : "waiting_for_peer"));
        if (gatheringId) void joinGathering(gatheringId).catch(() => {});
      },
      onConnectionStateChanged: (connection, state, reason) => {
        console.log("CALL DEBUG prayer: onConnectionStateChanged", { channelName: connection.channelId, state, reason });
        if (state === AGORA_CONNECTION_STATE_FAILED) {
          failureMessageRef.current = "The prayer call connection failed. Please try again.";
          setCallState((s) => (s === "ended" ? s : "failed"));
        }
      },
      onError: (err, msg) => console.warn("CALL DEBUG prayer: onError", { err, msg }),
      onTokenPrivilegeWillExpire: () => console.warn("CALL DEBUG prayer: token privilege about to expire"),
      onUserJoined: (connection, uid) => {
        console.log("CALL DEBUG prayer: onUserJoined", { channelName: connection.channelId, remoteUid: uid });
        setCallState("connected");
        setRemoteUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
      },
      onAudioVolumeIndication: (connection, speakers) => {
        activeSpeaker.reportVolume(speakers ?? []);
      },
      onUserOffline: (connection, uid) => {
        console.log("CALL DEBUG prayer: onUserOffline", { channelName: connection.channelId, remoteUid: uid });
        activeSpeaker.clearIfActive(uid);
        setRemoteUids((prev) => {
          const next = prev.filter((u) => u !== uid);
          if (next.length === 0) void handleLeave();
          return next;
        });
      },
    },
  });

  // Only requests a token (and thus only ever touches Agora at all) once
  // the user has actively tapped "Begin Prayer" — never automatically on
  // screen load, so the calm preparation step is never skipped or rushed.
  useEffect(() => {
    if (phase !== "call" || !myUid || !profile?.id || !gathering?.channelName) return;
    let cancelled = false;
    (async () => {
      try {
        const { token: t, appId } = await getToken(gathering.channelName!, myUid, profile.id);
        if (!cancelled) {
          setToken(t);
          setTokenAppId(appId);
          setCallState((s) => (s === "requesting_token" ? "joining_channel" : s));
        }
      } catch (e) {
        console.warn("CALL DEBUG prayer: token request FAILED", { error: e instanceof Error ? e.message : String(e) });
        if (!cancelled) { failureMessageRef.current = "Couldn't connect to the prayer call. Please try again."; setCallState("failed"); }
      }
    })();
    return () => { cancelled = true; };
  }, [phase, myUid, profile?.id, gathering?.channelName, getToken]);

  useEffect(() => {
    if (callState !== "joining_channel") return;
    const timer = setTimeout(() => {
      failureMessageRef.current = "Couldn't connect to the prayer call. Please check your connection and try again.";
      setCallState((s) => (s === "joining_channel" ? "failed" : s));
    }, JOIN_CHANNEL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [callState]);

  useEffect(() => {
    if (callState !== "waiting_for_peer") return;
    const timer = setTimeout(() => {
      failureMessageRef.current = `${otherName} hasn't joined yet. You can keep waiting or leave and try again later.`;
      // Unlike Direct Calls, a slow peer here isn't a hard failure — prayer
      // gatherings are scheduled in advance and either party may simply be
      // running a minute behind. Surface it gently instead of ending the
      // call outright.
    }, PEER_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [callState, otherName]);

  useEffect(() => {
    if (callState === "failed") void handleLeave("failed");
  }, [callState, handleLeave]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    engineRef.current?.muteLocalAudioStream(next);
  }

  const otherTiles: P2POrbitTile[] = remoteUids.map((uid) => ({ uid, isSelf: false, name: otherName, videoOn: false, muted: false }));
  const selfTile: P2POrbitTile = { uid: 0, isSelf: true, name: profile?.displayName || "You", videoOn: false, muted };
  const allTiles = [selfTile, ...otherTiles];
  const centerUid = activeSpeaker.activeUid ?? (remoteUids.length > 0 ? remoteUids[0] : 0);
  const centerTile = allTiles.find((t) => t.uid === centerUid) ?? selfTile;
  const orbitTiles = allTiles.filter((t) => t.uid !== centerTile.uid);

  if (loading) {
    return (
      <View style={[styles.screen, styles.centerFill]}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <ActivityIndicator color={p2pColors.accent} />
      </View>
    );
  }
  if (!gathering || !gathering.channelName) {
    return (
      <View style={[styles.screen, styles.centerFill]}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <Text style={styles.statusText}>This prayer gathering is not ready to join.</Text>
      </View>
    );
  }

  // ── Calm preparation step — no timer, no pressure. ──
  if (phase === "prep") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 30 }]}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <View style={styles.prepWrap}>
          <Text style={styles.prepEmoji}>🙏</Text>
          <Text style={styles.prepTitle}>Take a moment to prepare your heart.</Text>
          <Text style={styles.prepWith}>with {otherName}</Text>
          {!!gathering.prayerFocus && (
            <View style={styles.prepFocusCard}>
              <Text style={styles.prepFocusLabel}>Prayer Focus</Text>
              <Text style={styles.prepFocusText}>{gathering.prayerFocus}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.beginBtn} onPress={() => setPhase("call")}>
          <Text style={styles.beginBtnText}>Begin Prayer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.notYetBtn} onPress={() => router.back()}>
          <Text style={styles.notYetBtnText}>Not yet</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 30 }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => handleLeave()} accessibilityRole="button" accessibilityLabel="Leave prayer">
          <Ionicons name="chevron-back" size={22} color={p2pColors.textPrimary} />
        </TouchableOpacity>
        <View style={{ alignItems: "center" }}>
          <Text style={styles.brand}>🙏 Praying Together</Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.center}>
        <P2PParticipantOrbit
          centerTile={centerTile}
          orbitTiles={orbitTiles}
          speakingUids={activeSpeaker.speakingUids}
          showWaveform
          colors={p2pColors}
        />

        {callState !== "connected" && callState !== "ended" && (
          <View style={styles.statusRow}>
            <ActivityIndicator color={p2pColors.textPrimary} size="small" />
            <Text style={styles.statusText}>{callState === "waiting_for_peer" ? `Waiting for ${otherName}…` : "Connecting…"}</Text>
          </View>
        )}
      </View>

      {!!gathering.prayerFocus && (
        <View style={styles.focusPill}>
          <Ionicons name="heart" size={13} color={p2pColors.accent} />
          <Text style={styles.focusPillText} numberOfLines={2}>{gathering.prayerFocus}</Text>
        </View>
      )}

      <View style={styles.controlsRow}>
        <P2PControlButton onPress={toggleMute} active={muted} label={muted ? "Unmute" : "Mute"} accessibilityLabel="Mute microphone" colors={p2pColors}>
          <Ionicons name={muted ? "mic-off" : "mic"} size={22} color={muted ? p2pColors.accent : p2pColors.textPrimary} />
        </P2PControlButton>
        {!!scriptureRef && (
          // Reuses the exact same bible.com tap-through pattern already
          // used by app/lesson/[id].tsx — no in-app Bible reader, no
          // second Scripture representation, no new call functionality.
          <P2PControlButton
            onPress={() => Linking.openURL(`https://www.bible.com/search/bible?query=${encodeURIComponent(scriptureRef)}`).catch(() => {})}
            label="Scripture" accessibilityLabel="Open Scripture" colors={p2pColors}
          >
            <Ionicons name="book" size={20} color={p2pColors.textPrimary} />
          </P2PControlButton>
        )}
        <P2PControlButton onPress={() => handleLeave()} danger label="Leave" accessibilityLabel="Leave prayer" colors={p2pColors}>
          <Ionicons name="call" size={22} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
        </P2PControlButton>
      </View>
    </View>
  );
}

function makeStyles(p2p: P2PCallColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p2p.bg, alignItems: "center", justifyContent: "space-between" },
    centerFill: { alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", paddingHorizontal: 20 },
    brand: { color: p2p.textPrimary, fontSize: 15, fontFamily: "Inter_700Bold" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, width: "100%" },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 },
    statusText: { color: p2p.textMuted, fontSize: 14, fontFamily: "Inter_400Regular" },
    focusPill: {
      flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: p2p.pillBg, borderWidth: 1, borderColor: p2p.accentBorder,
      borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 14, maxWidth: "88%",
    },
    focusPillText: { flex: 1, color: p2p.textPrimary, fontSize: 13, fontFamily: "Inter_500Medium" },
    controlsRow: { flexDirection: "row", gap: 24 },
    prepWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 8 },
    prepEmoji: { fontSize: 48, marginBottom: 8 },
    prepTitle: { fontSize: 19, color: p2p.textPrimary, fontFamily: "Inter_700Bold", textAlign: "center", lineHeight: 26 },
    prepWith: { fontSize: 14, color: p2p.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    prepFocusCard: { backgroundColor: p2p.surface, borderWidth: 1, borderColor: p2p.surfaceBorder, borderRadius: 14, padding: 16, marginTop: 24, width: "100%" },
    prepFocusLabel: { fontSize: 11, color: p2p.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
    prepFocusText: { fontSize: 14, color: p2p.textPrimary, fontFamily: "Inter_400Regular", lineHeight: 20, textAlign: "center" },
    beginBtn: { backgroundColor: p2p.accent, borderRadius: 14, paddingVertical: 16, alignItems: "center", width: "100%" },
    beginBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
    notYetBtn: { paddingVertical: 14, alignItems: "center", width: "100%" },
    notYetBtnText: { color: p2p.textMuted, fontSize: 13, fontFamily: "Inter_500Medium" },
  });
}
