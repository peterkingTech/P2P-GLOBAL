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
  // YOUTUBE DEBUG — forensic instrumentation for Error 152. Surfaces
  // in-page JS errors and the IFrame script's own load failure, neither
  // of which the YT.Player onError callback below would ever see (that
  // only fires for player-level errors after the API has already loaded).
  window.onerror = function (msg, src, line, col, err) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "jserror", msg: String(msg), src: String(src), line: line }));
  };
  var player;
  var tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  tag.onerror = function () { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "scripterror", src: tag.src })); };
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = function () {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "apiready" }));
    player = new YT.Player('player', {
      videoId: "${externalId}",
      playerVars: { playsinline: 1, modestbranding: 1, rel: 0, autoplay: ${autoplay ? 1 : 0}, start: ${Math.max(0, Math.round(startSeconds))} },
      events: {
        onReady: function () { player.setVolume(${Math.round(Math.min(1, Math.max(0, initialVolume)) * 100)}); window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ready" })); },
        onError: function (e) {
          var extra = {};
          try { extra.state = player.getPlayerState(); } catch (ignored) {}
          try { extra.videoUrl = player.getVideoUrl ? player.getVideoUrl() : null; } catch (ignored) {}
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: "error", code: e.data, extra: extra }));
        },
        onStateChange: function (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: "state", state: e.data }));
          if (e.data === 0) window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ended" }));
        }
      }
    });
    setInterval(function () {
      if (player && player.getCurrentTime) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "time", ms: Math.round(player.getCurrentTime() * 1000) }));
      }
    }, 3000);
  };
  // YOUTUBE DEBUG — if onYouTubeIframeAPIReady never fires at all, that by
  // itself is evidence the iframe_api script never actually executed
  // (network-level failure), distinct from the player loading and then
  // erroring.
  setTimeout(function () {
    if (!player) window.ReactNativeWebView.postMessage(JSON.stringify({ type: "apitimeout" }));
  }, 8000);
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