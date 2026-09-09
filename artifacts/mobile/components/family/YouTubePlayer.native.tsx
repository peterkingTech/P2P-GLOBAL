import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { computePositionFromClock } from "@/lib/familyApi";
import type { YouTubePlayerProps } from "./youTubePlayerTypes";
import { describeYouTubeError, DRIFT_CHECK_INTERVAL_MS, DRIFT_THRESHOLD_MS, NOTICEABLE_DRIFT_THRESHOLD_MS } from "./youTubePlayerTypes";

// Real-device forensic fix — Error 152 ("video unavailable") persisted
// after the earlier baseUrl fix (which resolved a *different* error, 153)
// and after a custom User-Agent (which didn't help), reproduced on two
// separate devices with two unrelated, definitely-embeddable videos. Root
// cause, confirmed against multiple independent reports of this exact
// "152-4" signature in native WebView embeds: source={{ html, baseUrl }}
// uses Android's loadDataWithBaseURL, which gives the page a synthetic
// document origin for JS purposes (fixing the postMessage handshake
// behind Error 153) but does NOT make the WebView's native HTTP layer
// send a real Referer header on the page's own sub-resource requests —
// YouTube's playback backend requires that header and serves "video
// unavailable" without it. The page itself (IFrame API bootstrap +
// event → postMessage bridge, identical to what used to be inlined here)
// now lives server-side at GET /youtube-embed and is loaded via a real
// https:// network navigation instead, which makes the WebView send
// standard Referer headers the way any normal page load would.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "";

function buildEmbedUrl(externalId: string, autoplay: boolean, startSeconds: number, initialVolume: number) {
  const params = new URLSearchParams({
    v: externalId,
    autoplay: autoplay ? "1" : "0",
    start: String(Math.max(0, Math.round(startSeconds))),
    volume: String(Math.min(1, Math.max(0, initialVolume))),
  });
  return `${API_BASE_URL}/youtube-embed?${params.toString()}`;
}

export default function YouTubePlayer({ externalId, isPlaying, basePositionMs, baseServerTimeIso, playbackRate, volume, resyncNonce, onDriftStatus, onEnded, onError }: YouTubePlayerProps) {
  const webviewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const lastReportedMs = useRef<number | null>(null);
  const clockRef = useRef({ basePositionMs, baseServerTimeIso, playbackRate, isPlaying });
  clockRef.current = { basePositionMs, baseServerTimeIso, playbackRate, isPlaying };

  function expectedNowMs() {
    const c = clockRef.current;
    return computePositionFromClock(c.basePositionMs, c.baseServerTimeIso, c.playbackRate, c.isPlaying);
  }

  // Join-in-progress: the initial URL embeds the expected position at
  // mount time directly (autoplay + start=), so the first paint already
  // starts near the shared position rather than at 0.
  const embedUrl = useMemo(() => buildEmbedUrl(externalId, clockRef.current.isPlaying, expectedNowMs() / 1000, volume), [externalId]);

  function handleMessage(event: { nativeEvent: { data: string } }) {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload.type === "ready") readyRef.current = true;
      else if (payload.type === "error") {
        // YOUTUBE DEBUG — no secrets in this payload: just the numeric
        // YouTube player error code and player state, nothing user- or
        // account-identifying.
        console.warn("YOUTUBE DEBUG player onError", { externalId, code: payload.code, extra: payload.extra });
        onError(describeYouTubeError(payload.code));
      }
      else if (payload.type === "ended") onEnded?.();
      else if (payload.type === "time") lastReportedMs.current = payload.ms;
      else if (payload.type === "apiready") console.log("YOUTUBE DEBUG iframe_api script executed and called back", { externalId });
      else if (payload.type === "apitimeout") console.warn("YOUTUBE DEBUG iframe_api never called onYouTubeIframeAPIReady within 8s", { externalId });
      else if (payload.type === "scripterror") console.warn("YOUTUBE DEBUG iframe_api script tag failed to load", { externalId, src: payload.src });
      else if (payload.type === "jserror") console.warn("YOUTUBE DEBUG in-page JS error", { externalId, msg: payload.msg, src: payload.src, line: payload.line });
      else if (payload.type === "state") console.log("YOUTUBE DEBUG player state change", { externalId, state: payload.state });
    } catch { /* ignore malformed bridge messages */ }
  }

  // Resync immediately whenever a real command happened.
  useEffect(() => {
    if (!readyRef.current) return;
    webviewRef.current?.injectJavaScript(`window.p2pCommand("seek", ${Math.max(0, expectedNowMs()) / 1000}); true;`);
    webviewRef.current?.injectJavaScript(`window.p2pCommand("${isPlaying ? "play" : "pause"}"); true;`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseServerTimeIso, isPlaying]);

  // TogetherAudio's Media volume — SyncedMediaPlayer already ramps the
  // value it hands down here, so this just applies it directly.
  useEffect(() => {
    if (!readyRef.current) return;
    webviewRef.current?.injectJavaScript(`window.p2pCommand("volume", ${Math.round(Math.min(1, Math.max(0, volume)) * 100)}); true;`);
  }, [volume]);

  // "Return to Live" — same immediate-resync-on-command path as above,
  // triggered by the worship screen bumping resyncNonce on a tap.
  useEffect(() => {
    if (resyncNonce === undefined || !readyRef.current) return;
    webviewRef.current?.injectJavaScript(`window.p2pCommand("seek", ${Math.max(0, expectedNowMs()) / 1000}); true;`);
    webviewRef.current?.injectJavaScript(`window.p2pCommand("${isPlaying ? "play" : "pause"}"); true;`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resyncNonce]);

  // Ongoing drift correction, using the page's own self-reported position
  // (see the server-side embed page's "time" postMessage) rather than
  // blindly reseeking.
  // Also reports "noticeably behind" status for the Return to Live banner.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!readyRef.current || lastReportedMs.current == null) return;
      const expectedMs = expectedNowMs();
      const gap = Math.abs(lastReportedMs.current - expectedMs);
      if (gap > DRIFT_THRESHOLD_MS) {
        webviewRef.current?.injectJavaScript(`window.p2pCommand("seek", ${Math.max(0, expectedMs) / 1000}); true;`);
      }
      onDriftStatus?.(gap > NOTICEABLE_DRIFT_THRESHOLD_MS);
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WebView
      ref={webviewRef}
      style={styles.wrap}
      // See buildEmbedUrl above — a real https:// navigation to our own
      // server-rendered embed page, not loadDataWithBaseURL, is the fix
      // for Error 152 (missing Referer header on sub-resource requests).
      source={{ uri: embedUrl }}
      onMessage={handleMessage}
      javaScriptEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      originWhitelist={["*"]}
      domStorageEnabled
      thirdPartyCookiesEnabled
      // Real-device forensic fix #2 — after the baseUrl fix above resolved
      // Error 153, playback still failed with YouTube's own "video
      // unavailable / Error 152" on two unrelated, definitely-embeddable
      // videos, reproduced identically on two separate devices. Android
      // WebView's default UA string carries a "; wv)" marker identifying
      // it as an embedded WebView rather than the Chrome browser itself;
      // YouTube's playback backend is known to reject/degrade requests
      // carrying that marker. Overriding to a stock mobile Chrome UA
      // (no "wv" marker) is the documented workaround.
      userAgent="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
      // YOUTUBE DEBUG — these are native WebViewClient-level callbacks
      // (Android's onReceivedHttpError / onReceivedError), which fire for
      // EVERY resource load in the WebView including ones made by nested
      // iframes YouTube's own script creates — visibility our in-page JS
      // (window.onerror, etc.) structurally cannot have, since a nested
      // cross-origin iframe is a separate JS context. This is the only way
      // to see whether a specific YouTube/ad/tracking sub-request is
      // actually failing at the network level, and with what status code.
      onHttpError={(e) => {
        const { url, statusCode, description } = e.nativeEvent;
        console.warn("YOUTUBE DEBUG native onHttpError", { externalId, url, statusCode, description });
      }}
      onError={(e) => {
        const { url, code, description } = e.nativeEvent;
        console.warn("YOUTUBE DEBUG native onError (page load)", { externalId, url, code, description });
      }}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: "#000" },
});