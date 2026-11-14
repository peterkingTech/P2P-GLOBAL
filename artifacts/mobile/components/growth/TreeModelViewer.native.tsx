import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { treeViewerHtml } from "@/lib/treeViewerHtml";
import type { TreeModelViewerHandle, TreeModelViewerProps } from "./treeModelViewerTypes";

// iOS/Android: the three.js page runs in a WebView (WebGL 2). Model files are fetched by the page.
// Drawing pauses while `paused` (screen not focused) and while the app is in the background.
const TreeModelViewer = forwardRef<TreeModelViewerHandle, TreeModelViewerProps>(function TreeModelViewer(
  { standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts, onStatus, onSelect, reloadKey, wind, windFrame, compact, paused }, ref,
) {
  const web = useRef<WebView>(null);
  const html = useMemo(() => treeViewerHtml({ standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts, wind, windFrame, compact }),
    [standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts, wind, windFrame, compact]);
  const run = (js: string) => web.current?.injectJavaScript(`${js}; true;`);
  useImperativeHandle(ref, () => ({
    zoom: (f) => run(`window.__p2pZoom && window.__p2pZoom(${Number(f)})`),
    reset: () => run("window.__p2pReset && window.__p2pReset()"),
    view: (mode) => run(`window.__p2pView && window.__p2pView(${JSON.stringify(mode)})`),
    setWind: (on) => run(`window.__p2pWind && window.__p2pWind(${on ? "true" : "false"})`),
  }), []);
  const [inBackground, setInBackground] = useState(AppState.currentState !== "active");
  useEffect(() => { const sub = AppState.addEventListener("change", (s) => setInBackground(s !== "active")); return () => sub.remove(); }, []);
  const stop = !!paused || inBackground;
  useEffect(() => { run(`window.__p2pPause && window.__p2pPause(${stop ? "true" : "false"})`); }, [stop]);
  return (
    <WebView
      key={reloadKey}
      ref={web}
      style={[styles.web, { backgroundColor: background }]}
      source={{ html, baseUrl: "https://p2p.global/" }}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled
      cacheEnabled
      cacheMode="LOAD_DEFAULT"
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      setSupportMultipleWindows={false}
      onLoadEnd={() => { if (stop) run("window.__p2pPause && window.__p2pPause(true)"); }}
      onMessage={(e) => {
        try { const m = JSON.parse(e.nativeEvent.data); if (m?.type === "status") onStatus(m); else if (m?.type === "select") onSelect?.(m.id ?? null); } catch { /* not ours */ }
      }}
      onError={() => onStatus({ state: "error", message: "The 3D view couldn't start." })}
      onContentProcessDidTerminate={() => onStatus({ state: "error", message: "The 3D view was interrupted." })}
      onRenderProcessGone={() => onStatus({ state: "error", message: "The 3D view was interrupted." })}
    />
  );
});

export default TreeModelViewer;

const styles = StyleSheet.create({ web: { flex: 1 } });
