import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { computePositionFromClock } from "@/lib/familyApi";
import type { YouTubePlayerProps } from "./youTubePlayerTypes";
import { describeYouTubeError, DRIFT_CHECK_INTERVAL_MS, DRIFT_THRESHOLD_MS, NOTICEABLE_DRIFT_THRESHOLD_MS } from "./youTubePlayerTypes";

// A self-contained page loaded into the WebView — this is the standard,
// documented way to embed a controllable YouTube player natively (there is
// no first-party RN SDK): load the IFrame API script, construct a
// YT.Player against a div, and bridge its events back to React Native via
// window.ReactNativeWebView.postMessage. Commands flow the other direction
// via injectJavaScript. The page also self-reports its current playback
// time every 3s — injectJavaScript can't return a value back to RN on
// every platform, so periodic drift-checking needs the page to push its
// position rather than RN pulling it.
function buildHtml(externalId: string, autoplay: boolean, startSeconds: number, initialVolume: number) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#000;">
<div id="player"></div>
<script>
  var player;
  var tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
      videoId: "${externalId}",
      playerVars: { playsinline: 1, modestbranding: 1, rel: 0, autoplay: ${autoplay ? 1 : 0}, start: ${Math.max(0, Math.round(startSeconds))} },
      events: {
        onReady: function () { player.setVolume(${Math.round(Math.min(1, Math.max(0, initialVolume)) * 100)}); window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ready" })); },
        onError: function (e) { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "error", code: e.data })); },
        onStateChange: function (e) { if (e.data === 0) window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ended" })); }
      }
    });
    setInterval(function () {
      if (player && player.getCurrentTime) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "time", ms: Math.round(player.getCurrentTime() * 1000) }));
      }
    }, 3000);
  };
  window.p2pCommand = function (name, arg) {
    if (!player) return;
    if (name === "play") player.playVideo();
    else if (name === "pause") player.pauseVideo();
    else if (name === "seek") player.seekTo(arg, true);
    else if (name === "volume") player.setVolume(arg);
  };
</script>
</body></html>`;
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

  // Join-in-progress: the initial HTML embeds the expected position at
  // mount time directly (autoplay + start=), so the first paint already
  // starts near the shared position rather than at 0.
  const html = useMemo(() => buildHtml(externalId, clockRef.current.isPlaying, expectedNowMs() / 1000, volume), [externalId]);

  function handleMessage(event: { nativeEvent: { data: string } }) {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload.type === "ready") readyRef.current = true;
      else if (payload.type === "error") onError(describeYouTubeError(payload.code));
      else if (payload.type === "ended") onEnded?.();
      else if (payload.type === "time") lastReportedMs.current = payload.ms;
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
  // (see buildHtml's "time" postMessage) rather than blindly reseeking.
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
      // Real-device forensic fix — reproduced on the actual APK: YouTube's
      // IFrame API failed every single load with "Video player
      // configuration error / Error 153". Root cause: source={{ html }}
      // with no baseUrl gives the WebView an opaque/null origin, and the
      // IFrame API's postMessage handshake between this page and the
      // youtube.com iframe it creates validates origins — an opaque
      // origin breaks that handshake. baseUrl gives the page a real
      // origin the handshake can validate against.
      source={{ html, baseUrl: "https://www.youtube.com" }}
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
    />
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: "#000" },
});