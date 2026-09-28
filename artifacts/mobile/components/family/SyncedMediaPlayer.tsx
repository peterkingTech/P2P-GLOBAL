import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
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
  // "Return to Live" — bumped by the worship screen on a tap; forces an
  // immediate reconcile instead of waiting for the next periodic check.
  resyncNonce?: number;
  onDriftStatus?: (isBehind: boolean) => void;
  onEnded?: () => void;
}

const NOTICEABLE_DRIFT_THRESHOLD_MS = 4000;

export default function SyncedMediaPlayer({ session, mediaVolume = 1, resyncNonce, onDriftStatus, onEnded }: Props) {
  const soundRef = useRef<AudioPlayer | null>(null);
  const audioReadyRef = useRef(false);
  const lastMediaUrl = useRef<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [displayedVolume, setDisplayedVolume] = useState(mediaVolume);
  const rampCancelRef = useRef<(() => void) | null>(null);

  // Must be called unconditionally (hook rules) even though this component
  // has several early returns below (youtube branch, no-media placeholder,
  // error state) before the raw-file video actually renders. Source is null
  // whenever this isn't a raw-file video session (youtube/audio/no-media),
  // in which case this player simply sits unused — useVideoPlayer accepts
  // a null source. It automatically recreates when the source object
  // changes (keyed internally on JSON.stringify(source)), so no manual
  // "did the URL change" tracking is needed for video the way it still is
  // for audio below (createAudioPlayer is imperative, not hook-managed).
  const videoPlayer = useVideoPlayer(
    session.mediaType === "video" && session.mediaProvider !== "youtube" && session.mediaUrl
      ? { uri: session.mediaUrl }
      : null
  );

  useEffect(() => {
    rampCancelRef.current?.();
    rampCancelRef.current = rampVolume(displayedVolume, mediaVolume, 150, setDisplayedVolume);
    return () => rampCancelRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaVolume]);

  useEffect(() => {
    if (soundRef.current) soundRef.current.volume = displayedVolume;
    if (videoPlayer) videoPlayer.volume = displayedVolume;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedVolume]);

  // expo-video's player.currentTime/.playing and expo-audio's
  // player.currentTime/.playing are live, synchronously-readable properties
  // (confirmed directly against both packages' installed type declarations)
  // — unlike expo-av's getStatusAsync(), no async status fetch is needed to
  // read current position/playback state before deciding whether to
  // correct. Seeking: video's `currentTime =` assignment is documented as
  // performing a real seek; audio's currentTime is a plain settable
  // property too, but since expo-audio *also* ships a dedicated async
  // seekTo(seconds) method specifically for seeking (with tolerance
  // parameters), that explicit, purpose-built method is used for audio
  // instead of relying on property-assignment semantics that aren't
  // separately documented as a "real seek" the way video's are.
  async function reconcile() {
    const targetMs = computeWorshipPositionMs(session);
    try {
      if (session.mediaType === "video" && videoPlayer) {
        if (videoPlayer.status !== "readyToPlay") return;
        const currentMs = videoPlayer.currentTime * 1000;
        const drift = Math.abs(currentMs - targetMs);
        if (drift > DRIFT_THRESHOLD_MS) videoPlayer.currentTime = Math.max(0, targetMs) / 1000;
        if (session.isPlaying && !videoPlayer.playing) videoPlayer.play();
        if (!session.isPlaying && videoPlayer.playing) videoPlayer.pause();
        onDriftStatus?.(drift > NOTICEABLE_DRIFT_THRESHOLD_MS);
      } else if (session.mediaType === "audio" && soundRef.current) {
        const sound = soundRef.current;
        if (!sound.isLoaded) return;
        const currentMs = sound.currentTime * 1000;
        const drift = Math.abs(currentMs - targetMs);
        if (drift > DRIFT_THRESHOLD_MS) await sound.seekTo(Math.max(0, targetMs) / 1000);
        if (session.isPlaying && !sound.playing) sound.play();
        if (!session.isPlaying && sound.playing) sound.pause();
        onDriftStatus?.(drift > NOTICEABLE_DRIFT_THRESHOLD_MS);
      }
    } catch {
      // A drift-correction tick failing (e.g. the underlying stream
      // dropped) isn't itself the user-facing error — the load effect
      // below is what sets errorMessage. Swallow here so one bad tick
      // doesn't produce an unhandled rejection.
    }
  }

  // Mirrors the original onLoad={() => reconcile()} / onError callbacks —
  // the video player has no such props (VideoView only takes `player`),
  // so this listens to the player's own statusChange event instead.
  useEventListener(videoPlayer, "statusChange", ({ status, error }) => {
    if (status === "error") {
      setErrorMessage(error?.message ?? "This video couldn't be loaded. Check the link and try again.");
      return;
    }
    if (status === "readyToPlay") reconcile();
  });

  // Mirrors the original onPlaybackStatusUpdate's didJustFinish check.
  useEventListener(videoPlayer, "playToEnd", () => { onEnded?.(); });

  useEffect(() => {
    if (session.mediaProvider === "youtube") return; // YouTubePlayer owns its own sync loop
    reconcile();
    const interval = setInterval(reconcile, RECONCILE_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mediaProvider, session.isPlaying, session.playbackBaseServerTime, session.playbackBasePositionMs, session.mediaUrl]);

  // "Return to Live" for the legacy raw-file path.
  useEffect(() => {
    if (resyncNonce === undefined || session.mediaProvider === "youtube") return;
    reconcile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resyncNonce]);

  // createAudioPlayer is synchronous (unlike expo-av's async createAsync),
  // so the "effect re-ran while creation was still in flight" race the
  // original `cancelled` flag guarded against no longer has a window to
  // occur in — the player is created and assigned within the same tick.
  // Initial position/play-state (previously passed as createAsync options)
  // and load-error detection (previously a thrown exception) both move to
  // the status listener instead: expo-audio has no shouldPlay/positionMillis
  // creation options, and surfaces load failures via `status.error` on the
  // async status event rather than throwing synchronously from creation.
  useEffect(() => {
    if (session.mediaProvider === "youtube" || session.mediaType !== "audio" || !session.mediaUrl) return;
    if (lastMediaUrl.current === session.mediaUrl && soundRef.current) return;
    lastMediaUrl.current = session.mediaUrl;
    soundRef.current?.remove();
    audioReadyRef.current = false;
    try {
      const sound = createAudioPlayer({ uri: session.mediaUrl });
      sound.volume = displayedVolume;
      sound.addListener("playbackStatusUpdate", (status: AudioStatus) => {
        if (status.error) {
          // The exact class of bug this fixes: an unplayable/invalid URL
          // (e.g. a page URL instead of a direct audio file) previously
          // reached here as an unhandled promise rejection. Now it's a
          // caught, user-facing message instead of a browser crash.
          setErrorMessage("This audio couldn't be loaded. Check the link and try again.");
          return;
        }
        if (!status.isLoaded) return;
        if (!audioReadyRef.current) {
          audioReadyRef.current = true;
          sound.currentTime = Math.max(0, computeWorshipPositionMs(session)) / 1000;
          if (session.isPlaying) sound.play();
          setErrorMessage(null);
        }
        if (status.didJustFinish) onEnded?.();
      });
      soundRef.current = sound;
    } catch {
      setErrorMessage("This audio couldn't be loaded. Check the link and try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mediaProvider, session.mediaUrl, session.mediaType]);

  useEffect(() => () => { soundRef.current?.remove(); }, []);

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
          resyncNonce={resyncNonce}
          onDriftStatus={onDriftStatus}
          onEnded={onEnded}
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
        <Text style={styles.placeholderText}>No Media selected yet</Text>
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
    // Load/error/finish/shouldPlay/volume are all handled above via
    // useVideoPlayer + useEventListener + the volume effect — VideoView
    // itself only takes the player instance and display props.
    return (
      <VideoView player={videoPlayer} style={styles.video} contentFit="contain" nativeControls={false} />
    );
  }

  return (
    <View style={styles.audioBox}>
      <ActivityIndicator color={colors.accentGreen} size="small" style={{ opacity: session.isPlaying ? 0 : 1 }} />
      <Text style={styles.placeholderIcon}>{session.isPlaying ? "🎵" : "⏸️"}</Text>
      <Text style={styles.placeholderText}>{session.isPlaying ? "Media playing" : "Paused"}</Text>
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