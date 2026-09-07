import React, { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { computePositionFromClock } from "@/lib/familyApi";
import type { YouTubePlayerProps } from "./youTubePlayerTypes";
import { describeYouTubeError, DRIFT_CHECK_INTERVAL_MS, DRIFT_THRESHOLD_MS } from "./youTubePlayerTypes";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Loaded once per page, shared by every mounted player — the YT script
// itself defines window.YT globally and calls onYouTubeIframeAPIReady when
// ready, which is the API's own required integration shape, not something
// this file invented.
let apiReadyPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiReadyPromise;
}

export default function YouTubePlayer({ externalId, isPlaying, basePositionMs, baseServerTimeIso, playbackRate, volume, onError }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);
  // Always holds the latest clock — read by the periodic drift-check
  // interval, which is created once and must never see a stale closure.
  const clockRef = useRef({ basePositionMs, baseServerTimeIso, playbackRate, isPlaying });
  clockRef.current = { basePositionMs, baseServerTimeIso, playbackRate, isPlaying };

  function expectedNowMs() {
    const c = clockRef.current;
    return computePositionFromClock(c.basePositionMs, c.baseServerTimeIso, c.playbackRate, c.isPlaying);
  }

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new window.YT!.Player(containerRef.current, {
        videoId: externalId,
        playerVars: { playsinline: 1, modestbranding: 1, rel: 0, autoplay: clockRef.current.isPlaying ? 1 : 0 },
        events: {
          onReady: () => {
            readyRef.current = true;
            // Join-in-progress: the position computed right now already
            // accounts for however long the gathering has been playing.
            playerRef.current.seekTo(Math.max(0, expectedNowMs()) / 1000, true);
            playerRef.current.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
            if (clockRef.current.isPlaying) playerRef.current.playVideo(); else playerRef.current.pauseVideo();
          },
          onError: (e: { data: number }) => onError(describeYouTubeError(e.data)),
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalId]);

  // Resync immediately whenever a real command happened (a new
  // baseServerTimeIso means the Guide played/paused/sought/changed media).
  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    playerRef.current.seekTo(Math.max(0, expectedNowMs()) / 1000, true);
    if (isPlaying) playerRef.current.playVideo(); else playerRef.current.pauseVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseServerTimeIso, isPlaying]);

  // TogetherAudio's Media volume — SyncedMediaPlayer already ramps the
  // value it hands down here, so this just applies it directly.
  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    playerRef.current.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  }, [volume]);

  // Ongoing drift correction — the actual fix for section 7/8: without
  // this, a Companion who buffered or manually scrubbed the embed would
  // simply stay out of sync until the Guide's next command.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!readyRef.current || !playerRef.current || typeof playerRef.current.getCurrentTime !== "function") return;
      const actualMs = playerRef.current.getCurrentTime() * 1000;
      const expectedMs = expectedNowMs();
      if (Math.abs(actualMs - expectedMs) > DRIFT_THRESHOLD_MS) {
        playerRef.current.seekTo(Math.max(0, expectedMs) / 1000, true);
      }
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return <View style={styles.wrap}><div ref={containerRef} style={{ width: "100%", height: "100%" }} /></View>;
}

const styles = StyleSheet.create({
  wrap: { width: "100%", aspectRatio: 16 / 9, borderRadius: 14, overflow: "hidden", backgroundColor: "#000" },
});