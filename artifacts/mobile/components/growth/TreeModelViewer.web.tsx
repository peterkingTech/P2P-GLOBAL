import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { treeViewerHtml } from "@/lib/treeViewerHtml";
import type { TreeModelViewerHandle, TreeModelViewerProps } from "./treeModelViewerTypes";

// Web: the same three.js page in an iframe; it reports back with window.postMessage.
const TreeModelViewer = forwardRef<TreeModelViewerHandle, TreeModelViewerProps>(function TreeModelViewer(
  { standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts, onStatus, onSelect, reloadKey }, ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => treeViewerHtml({ standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts }), [standardUrl, detailedUrl, background, reduceMotion, frontOnly, noCloseUp, parts]);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = (e.data as { p2pTreeViewer?: { type?: string; id?: string | null } })?.p2pTreeViewer;
      if (m?.type === "status") statusRef.current(m as never);
      else if (m?.type === "select") selectRef.current?.(m.id ?? null);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  useImperativeHandle(ref, () => ({
    zoom: (f) => (frame.current?.contentWindow as unknown as { __p2pZoom?: (n: number) => void })?.__p2pZoom?.(f),
    reset: () => (frame.current?.contentWindow as unknown as { __p2pReset?: () => void })?.__p2pReset?.(),
  }), []);
  return (
    <iframe
      key={reloadKey}
      ref={frame}
      title="3D model"
      srcDoc={html}
      style={{ border: 0, width: "100%", height: "100%", display: "block", background }}
    />
  );
});

export default TreeModelViewer;
