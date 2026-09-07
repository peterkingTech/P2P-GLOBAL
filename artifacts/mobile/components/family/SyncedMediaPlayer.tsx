import React, { useEffect, useRef } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { Audio, Video, ResizeMode, AVPlaybackStatus } from "expo-av";
import colors from "@/constants/colors";
import { computeWorshipPositionMs, type WorshipSession } from "@/lib/familyApi";

// Reconciles local playback against the session's server-anchored clock
// periodically (not continuously) — small drift is corrected with a seek,
// matching the product spec's "gently corrected, don't constantly restart
// for tiny clock differences" requirement. This is deliberately simpler
// than frame-perfect A/V sync: worship is not a synchronized-lecture app,
// a natural "together enough" feel is the goal.
const RECONCILE_INTERVAL_MS = 4000;
const DRIFT_THRESHOLD_MS = 1500;

interface Props {
  session: WorshipSession;
}

export default function SyncedMediaPlayer({ session }: Props) {
  const videoRef = useRef<Video | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const lastMediaUrl = useRef<string | null>(null);

  async function reconcile() {
    const targetMs = computeWorshipPositionMs(session);
    if (session.mediaType === "video" && videoRef.current) {
      const status = await videoRef.current.getStatusAsync();
      if (!status.isLoaded) return;
      const drift = Math.abs((status.positionMillis ?? 0) - targetMs);
      if (drift > DRIFT_THRESHOLD_MS) await videoRef.current.setPositionAsync(Math.max(0, targetMs));
      if (session.isPlaying && !status.isPlaying) await videoRef.current.playAsync();
      if (!session.isPlaying && status.isPlaying) await videoRef.current.pauseAsync();
    } else if (session.mediaType === "audio" && soundRef.current) {
      const status = await soundRef.current.getStatusAsync();
      if (!status.isLoaded) return;
      const drift = Math.abs((status.positionMillis ?? 0) - targetMs);
      if (drift > DRIFT_THRESHOLD_MS) await soundRef.current.setPositionAsync(Math.max(0, targetMs));
      if (session.isPlaying && !status.isPlaying) await soundRef.current.playAsync();
      if (!session.isPlaying && status.isPlaying) await soundRef.current.pauseAsync();
    }
  }

  useEffect(() => {
    reconcile();
    const interval = setInterval(reconcile, RECONCILE_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isPlaying, session.playbackBaseServerTime, session.playbackBasePositionMs, session.mediaUrl]);

  useEffect(() => {
    if (session.mediaType !== "audio" || !session.mediaUrl) return;
    let cancelled = false;
    if (lastMediaUrl.current === session.mediaUrl && soundRef.current) return;
    lastMediaUrl.current = session.mediaUrl;
    (async () => {
      await soundRef.current?.unloadAsync().catch(() => {});
      const { sound } = await Audio.Sound.createAsync({ uri: session.mediaUrl! }, { shouldPlay: session.isPlaying, positionMillis: Math.max(0, computeWorshipPositionMs(session)) });
      if (!cancelled) soundRef.current = sound;
      else await sound.unloadAsync();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mediaUrl, session.mediaType]);

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  if (!session.mediaUrl) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderIcon}>🎵</Text>
        <Text style={styles.placeholderText}>No worship media selected yet</Text>
      </View>
    );
  }

  if (session.mediaType === "video") {
    return (
      <Video
        ref={videoRef}
        source={{ uri: session.mediaUrl }}
        style={styles.video}
        resizeMode={ResizeMode.CONTAIN}
        useNativeControls={false}
        onLoad={() => reconcile()}
        shouldPlay={session.isPlaying}
      />
    );
  }

  return (
    <View style={styles.audioBox}>
      <ActivityIndicator color={colors.accentGreen} size="small" style={{ opacity: session.isPlaying ? 0 : 1 }} />
      <Text style={styles.placeholderIcon}>{session.isPlaying ? "🎵" : "⏸️"}</Text>
      <Text style={styles.placeholderText}>{session.isPlaying ? "Worship music playing" : "Paused"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000", borderRadius: 14 },
  placeholder: {
    width: "100%", aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  audioBox: {
    width: "100%", aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  placeholderIcon: { fontSize: 32 },
  placeholderText: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: "Inter_400Regular" },
});