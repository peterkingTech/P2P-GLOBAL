import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { treeViewerHtml } from "@/lib/treeViewerHtml";
import type { TreeModelViewerHandle, TreeModelViewerProps } from "./treeModelViewerTypes";

// Web: the same three.js page in an iframe; it reports back with window.postMessage. The page pauses
// itself when the browser tab is hidden; `paused` pauses it while its screen isn't the one in view.
type ViewerWindow = { __p2pZoom?: (n: number) => void; __p2pReset?: () => void; __p2pView?: (m: string) => void; __p2pWind?: (on: boolean) => void; __p2pPause?: (p: boolean) => void };
const TreeModelViewer = forwardRef<TreeModelViewerHandle, TreeModelViewerProps>(function TreeModelViewer(
  { standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts, onStatus, onSelect, reloadKey, wind, windFrame, compact, paused }, ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => treeViewerHtml({ standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts, wind, windFrame, compact }),
    [standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts, wind, windFrame, compact]);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const pausedRef = useRef(!!paused);
  pausedRef.current = !!paused;
  const win = () => frame.current?.contentWindow as unknown as ViewerWindow | undefined;
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = (e.data as { p2pTreeViewer?: { type?: string; id?: string | null } })?.p2pTreeViewer;
      if (m?.type === "status") { statusRef.current(m as never); if (pausedRef.current) win()?.__p2pPause?.(true); }
      else if (m?.type === "select") selectRef.current?.(m.id ?? null);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  useEffect(() => { win()?.__p2pPause?.(!!paused); }, [paused]);
  useImperativeHandle(ref, () => ({
    zoom: (f) => win()?.__p2pZoom?.(f),
    reset: () => win()?.__p2pReset?.(),
    view: (mode) => win()?.__p2pView?.(mode),
    setWind: (on) => win()?.__p2pWind?.(on),
  }), []);
  return (
    <iframe
      key={reloadKey}
      ref={frame}
      title="3D model"
      srcDoc={html}
      style={{ border: 0, width: "100%", height: "100%", display: "block", background, pointerEvents: compact ? "none" : undefined }}
    />
  );
});

export default TreeModelViewer;
