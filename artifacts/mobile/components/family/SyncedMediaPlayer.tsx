import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { Audio, Video, ResizeMode } from "expo-av";
import colors from "@/constants/colors";
import { computeWorshipPositionMs, type WorshipSession } from "@/lib/familyApi";
import { rampVolume } from "@/lib/togetherAudio/mixer";
import YouTubePlayer from "./YouTubePlayer";

// Reconciles local playback against the session's server-anchored clock
// periodically (not continuously) — small drift is corrected with a seek,
// matching the product spec's "gently corrected, don't constantly restart
// for tiny clock differences" requirement. This is deliberately simpler
// than frame-perfect A/V sync: worship is not a synchronized-lecture app,
// a natural "together enough" feel is the goal. Applies to the legacy raw-
// file path only — YouTubePlayer has its own (simpler) sync-on-command model.
const RECONCILE_INTERVAL_MS = 4000;
const DRIFT_THRESHOLD_MS = 1500;

interface Props {
  session: WorshipSession;
  // TogetherAudio's Media layer — effectiveMediaVolume(prefs) from the
  // caller. Ramped locally (see the effect below) so a big Audio Balance
  // move lands as a quick fade, never an audible pop.
  mediaVolume?: number;
}

export default function SyncedMediaPlayer({ session, mediaVolume = 1 }: Props) {
  const videoRef = useRef<Video | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const lastMediaUrl = useRef<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [displayedVolume, setDisplayedVolume] = useState(mediaVolume);
  const rampCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    rampCancelRef.current?.();
    rampCancelRef.current = rampVolume(displayedVolume, mediaVolume, 150, setDisplayedVolume);
    return () => rampCancelRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaVolume]);

  useEffect(() => {
    soundRef.current?.setVolumeAsync(displayedVolume).catch(() => {});
  }, [displayedVolume]);

  async function reconcile() {
    const targetMs = computeWorshipPositionMs(session);
    try {
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
    } catch {
      // A drift-correction tick failing (e.g. the underlying stream
      // dropped) isn't itself the user-facing error — the load effect
      // below is what sets errorMessage. Swallow here so one bad tick
      // doesn't produce an unhandled rejection.
    }
  }

  useEffect(() => {
    if (session.mediaProvider === "youtube") return; // YouTubePlayer owns its own sync loop
    reconcile();
    const interval = setInterval(reconcile, RECONCILE_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mediaProvider, session.isPlaying, session.playbackBaseServerTime, session.playbackBasePositionMs, session.mediaUrl]);

  useEffect(() => {
    if (session.mediaProvider === "youtube" || session.mediaType !== "audio" || !session.mediaUrl) return;
    let cancelled = false;
    if (lastMediaUrl.current === session.mediaUrl && soundRef.current) return;
    lastMediaUrl.current = session.mediaUrl;
    (async () => {
      try {
        await soundRef.current?.unloadAsync().catch(() => {});
        const { sound } = await Audio.Sound.createAsync(
          { uri: session.mediaUrl! },
          { shouldPlay: session.isPlaying, positionMillis: Math.max(0, computeWorshipPositionMs(session)), volume: displayedVolume }
        );
        if (!cancelled) { soundRef.current = sound; setErrorMessage(null); }
        else await sound.unloadAsync();
      } catch {
        // The exact class of bug this fixes: an unplayable/invalid URL
        // (e.g. a page URL instead of a direct audio file) previously
        // reached here as an unhandled promise rejection. Now it's a
        // caught, user-facing message instead of a browser crash.
        if (!cancelled) setErrorMessage("This audio couldn't be loaded. Check the link and try again.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mediaProvider, session.mediaUrl, session.mediaType]);

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  useEffect(() => { setErrorMessage(null); }, [session.mediaUrl, session.mediaId, session.mediaProvider]);

  if (session.mediaProvider === "youtube" && session.mediaId) {
    return (
      <View style={styles.wrapOuter}>
        <YouTubePlayer
          externalId={session.mediaId}
          isPlaying={session.isPlaying}
          basePositionMs={session.playbackBasePositionMs}
          baseServerTimeIso={session.playbackBaseServerTime}
          playbackRate={session.playbackRate}
          volume={displayedVolume}
          onError={setErrorMessage}
        />
        {errorMessage && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}
      </View>
    );
  }

  if (!session.mediaUrl && !session.mediaProvider) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderIcon}>🎵</Text>
        <Text style={styles.placeholderText}>No Shared Media selected yet</Text>
      </View>
    );
  }

  if (errorMessage) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderIcon}>⚠️</Text>
        <Text style={styles.placeholderText}>{errorMessage}</Text>
      </View>
    );
  }

  if (session.mediaType === "video") {
    return (
      <Video
        ref={videoRef}
        source={{ uri: session.mediaUrl! }}
        style={styles.video}
        resizeMode={ResizeMode.CONTAIN}
        useNativeControls={false}
        onLoad={() => reconcile()}
        onError={() => setErrorMessage("This video couldn't be loaded. Check the link and try again.")}
        shouldPlay={session.isPlaying}
        volume={displayedVolume}
      />
    );
  }

  return (
    <View style={styles.audioBox}>
      <ActivityIndicator color={colors.accentGreen} size="small" style={{ opacity: session.isPlaying ? 0 : 1 }} />
      <Text style={styles.placeholderIcon}>{session.isPlaying ? "🎵" : "⏸️"}</Text>
      <Text style={styles.placeholderText}>{session.isPlaying ? "Shared Media playing" : "Paused"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapOuter: { width: "100%" },
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
  placeholderText: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 16 },
  errorOverlay: {
    position: "absolute", bottom: 10, left: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(0,0,0,0.75)", borderRadius: 10, padding: 10,
  },
  errorIcon: { fontSize: 14 },
  errorText: { color: "#fff", fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
});