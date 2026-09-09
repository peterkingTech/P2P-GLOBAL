import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Real-device forensic fix — YouTube Error 152 ("video unavailable")
// reproduced on the actual APK on two separate devices with two unrelated,
// definitely-embeddable videos, persisting after the earlier baseUrl fix
// (which resolved a *different* error, 153) and after a custom User-Agent
// (which didn't help). Root cause, confirmed against multiple independent
// reports of this exact "152-4" signature in native WebView embeds:
// react-native-webview's source={{ html, baseUrl }} uses Android's
// loadDataWithBaseURL, which gives the page a synthetic document origin
// for JS purposes (fixing the postMessage handshake behind Error 153) but
// does NOT make the WebView's actual native HTTP layer send a real
// Referer header on the page's own sub-resource requests — YouTube's
// playback backend requires that header to verify embed identity and
// serves "video unavailable" without it. Loading this same page via a
// real https:// network navigation (this route) makes the WebView send
// standard, real Referer headers the way any normal cross-origin page
// load would, which loadDataWithBaseURL's synthetic load never did.
const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

router.get("/youtube-embed", (req, res) => {
  const videoId = String(req.query.v ?? "");
  if (!ID_PATTERN.test(videoId)) {
    res.status(400).type("text/plain").send("Invalid video id");
    return;
  }
  const autoplay = req.query.autoplay === "1" ? 1 : 0;
  const startSeconds = Math.max(0, Math.round(Number(req.query.start) || 0));
  const rawVolume = Number(req.query.volume);
  const volumePercent = Math.round(Math.min(1, Math.max(0, Number.isFinite(rawVolume) ? rawVolume : 1)) * 100);

  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#000;">
<div id="player"></div>
<script>
  window.onerror = function (msg, src, line, col, err) {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "jserror", msg: String(msg), src: String(src), line: line }));
  };
  var player;
  var tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  tag.onerror = function () { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "scripterror", src: tag.src })); };
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = function () {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "apiready" }));
    player = new YT.Player('player', {
      videoId: "${videoId}",
      playerVars: { playsinline: 1, modestbranding: 1, rel: 0, autoplay: ${autoplay}, start: ${startSeconds} },
      events: {
        onReady: function () { player.setVolume(${volumePercent}); window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ready" })); },
        onError: function (e) {
          var extra = {};
          try { extra.state = player.getPlayerState(); } catch (ignored) {}
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "error", code: e.data, extra: extra }));
        },
        onStateChange: function (e) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "state", state: e.data }));
          if (e.data === 0) window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ended" }));
        }
      }
    });
    setInterval(function () {
      if (player && player.getCurrentTime) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "time", ms: Math.round(player.getCurrentTime() * 1000) }));
      }
    }, 3000);
  };
  setTimeout(function () {
    if (!player) window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "apitimeout" }));
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

  res.set("Cache-Control", "no-store");
  res.type("html").send(html);
});

export default router;
