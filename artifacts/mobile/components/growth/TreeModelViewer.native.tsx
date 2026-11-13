import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { treeViewerHtml } from "@/lib/treeViewerHtml";
import type { TreeModelViewerHandle, TreeModelViewerProps } from "./treeModelViewerTypes";

// iOS/Android: the three.js page runs in a WebView (WebGL 2). Model files are fetched by the page.
const TreeModelViewer = forwardRef<TreeModelViewerHandle, TreeModelViewerProps>(function TreeModelViewer(
  { standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts, onStatus, onSelect, reloadKey }, ref,
) {
  const web = useRef<WebView>(null);
  const html = useMemo(() => treeViewerHtml({ standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts }), [standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts]);
  useImperativeHandle(ref, () => ({
    zoom: (f) => web.current?.injectJavaScript(`window.__p2pZoom && window.__p2pZoom(${Number(f)}); true;`),
    reset: () => web.current?.injectJavaScript("window.__p2pReset && window.__p2pReset(); true;"),
  }), []);
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
