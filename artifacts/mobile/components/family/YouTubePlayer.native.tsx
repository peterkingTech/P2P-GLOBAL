import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import type { YouTubePlayerProps } from "./youTubePlayerTypes";
import { describeYouTubeError } from "./youTubePlayerTypes";

// A self-contained page loaded into the WebView — this is the standard,
// documented way to embed a controllable YouTube player natively (there is
// no first-party RN SDK): load the IFrame API script, construct a
// YT.Player against a div, and bridge its events back to React Native via
// window.ReactNativeWebView.postMessage. Commands flow the other direction
// via injectJavaScript below.
function buildHtml(externalId: string, autoplay: boolean, startSeconds: number) {
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
        onReady: function () { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ready" })); },
        onError: function (e) { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "error", code: e.data })); }
      }
    });
  };
  window.p2pCommand = function (name, arg) {
    if (!player) return;
    if (name === "play") player.playVideo();
    else if (name === "pause") player.pauseVideo();
    else if (name === "seek") player.seekTo(arg, true);
  };
</script>
</body></html>`;
}

export default function YouTubePlayer({ externalId, isPlaying, syncPositionMs, syncKey, onError }: YouTubePlayerProps) {
  const webviewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const html = useMemo(() => buildHtml(externalId, isPlaying, syncPositionMs / 1000), [externalId]);

  function handleMessage(event: { nativeEvent: { data: string } }) {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload.type === "ready") readyRef.current = true;
      else if (payload.type === "error") onError(describeYouTubeError(payload.code));
    } catch { /* ignore malformed bridge messages */ }
  }

  useEffect(() => {
    if (!readyRef.current) return;
    webviewRef.current?.injectJavaScript(`window.p2pCommand("seek", ${Math.max(0, syncPositionMs) / 1000}); true;`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  useEffect(() => {
    if (!readyRef.current) return;
    webviewRef.current?.injectJavaScript(`window.p2pCommand("${isPlaying ? "play" : "pause"}"); true;`);
  }, [isPlaying]);

  return (
    <WebView
      ref={webviewRef}
      style={styles.wrap}
      source={{ html }}
      onMessage={handleMessage}
      javaScriptEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      originWhitelist={["*"]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: "#000" },
});