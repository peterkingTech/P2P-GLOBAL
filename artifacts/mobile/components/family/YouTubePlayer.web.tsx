import React, { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import type { YouTubePlayerProps } from "./youTubePlayerTypes";
import { describeYouTubeError } from "./youTubePlayerTypes";

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

export default function YouTubePlayer({ externalId, isPlaying, syncPositionMs, syncKey, onError }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new window.YT!.Player(containerRef.current, {
        videoId: externalId,
        playerVars: { playsinline: 1, modestbranding: 1, rel: 0, autoplay: isPlaying ? 1 : 0 },
        events: {
          onReady: () => {
            readyRef.current = true;
            playerRef.current.seekTo(Math.max(0, syncPositionMs) / 1000, true);
            if (isPlaying) playerRef.current.playVideo(); else playerRef.current.pauseVideo();
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

  // Resync exactly when a real command happened (syncKey change), not on a
  // continuous timer — see youTubePlayerTypes.ts's YouTubePlayerProps doc.
  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    playerRef.current.seekTo(Math.max(0, syncPositionMs) / 1000, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    if (isPlaying) playerRef.current.playVideo(); else playerRef.current.pauseVideo();
  }, [isPlaying]);

  return <View style={styles.wrap}><div ref={containerRef} style={{ width: "100%", height: "100%" }} /></View>;
}

const styles = StyleSheet.create({
  wrap: { width: "100%", aspectRatio: 16 / 9, borderRadius: 14, overflow: "hidden", backgroundColor: "#000" },
});