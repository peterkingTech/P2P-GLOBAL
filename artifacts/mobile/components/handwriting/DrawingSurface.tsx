import React, { useRef, useState } from "react";
import { View } from "react-native";
import Svg from "react-native-svg";
import { Gesture, GestureDetector, PointerType } from "react-native-gesture-handler";
import { PAGE, LIMITS, simplify, toPagePoint, hitsStroke, type Page, type Point, type Stroke, type Tool } from "@/lib/handwriting";
import { PageBackground, StrokeLayer, StrokePath } from "./DrawingView";

// The drawing input surface. One pointer draws; finger, stylus, Apple Pencil,
// mouse and pen all produce the same strokes. Pressure is used only when the
// device reports it (stylusData) — never faked. Palm rest: once a stylus has
// been used on this page, finger touches stop drawing (the "Move" tool still
// scrolls). This is the JavaScript surface used on every platform; a future
// native PencilKit surface for iPad can replace it behind the same props,
// producing the same strokes, so storage and submission don't change.

export type SurfaceTool = Tool | "eraser" | "hand";
export interface DrawingSurfaceProps {
  page: Page;
  width: number;               // on-screen width of the page (zoom included)
  tool: SurfaceTool;
  color: string;
  strokeWidthValue: number;
  onStroke: (s: Stroke) => void;
  onErase: (indices: number[]) => void;
  accessibilityLabel: string;
}

export default function DrawingSurface({ page, width, tool, color, strokeWidthValue, onStroke, onErase, accessibilityLabel }: DrawingSurfaceProps) {
  const height = (width * PAGE.height) / PAGE.width;
  const scale = PAGE.width / width;
  const [live, setLive] = useState<Point[] | null>(null);
  const pts = useRef<Point[]>([]);
  const ignore = useRef(false);
  const stylusSeen = useRef(false);
  const erased = useRef<Set<number>>(new Set());
  const frame = useRef<number | null>(null);

  const flush = () => { frame.current = null; setLive(pts.current.slice()); };
  const schedule = () => { if (frame.current == null) frame.current = requestAnimationFrame(flush); };

  const eraseAt = (p: Point) => {
    page.strokes.forEach((s, i) => { if (!erased.current.has(i) && hitsStroke(s, p, 12)) erased.current.add(i); });
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .maxPointers(1)
    .enabled(tool !== "hand")
    .onBegin((e) => {
      const isStylus = e.pointerType === PointerType.STYLUS;
      if (isStylus) stylusSeen.current = true;
      ignore.current = stylusSeen.current && e.pointerType === PointerType.TOUCH;
      if (ignore.current) return;
      const p = toPagePoint(e.x, e.y, scale, isStylus ? e.stylusData?.pressure : null);
      erased.current = new Set();
      if (tool === "eraser") { eraseAt(p); return; }
      pts.current = [p];
      schedule();
    })
    .onUpdate((e) => {
      if (ignore.current) return;
      const isStylus = e.pointerType === PointerType.STYLUS;
      const p = toPagePoint(e.x, e.y, scale, isStylus ? e.stylusData?.pressure : null);
      if (tool === "eraser") { eraseAt(p); return; }
      const last = pts.current[pts.current.length - 1];
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.8) return;
      if (pts.current.length >= LIMITS.pointsPerStroke) return;
      pts.current.push(p);
      schedule();
    })
    .onFinalize(() => {
      if (ignore.current) { ignore.current = false; return; }
      if (frame.current != null) { cancelAnimationFrame(frame.current); frame.current = null; }
      if (tool === "eraser") {
        if (erased.current.size) onErase([...erased.current]);
        erased.current = new Set();
        return;
      }
      const points = simplify(pts.current);
      pts.current = [];
      setLive(null);
      if (points.length && tool !== "hand") onStroke({ tool, color, width: strokeWidthValue, points });
    });

  const liveStroke: Stroke | null = live && tool !== "eraser" && tool !== "hand" ? { tool, color, width: strokeWidthValue, points: live } : null;
  return (
    <GestureDetector gesture={pan}>
      <View style={{ width, height }} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}
        accessibilityHint={tool === "hand" ? "Move tool: drag to scroll the page" : "Draw with a finger, stylus or mouse"}>
        <Svg width={width} height={height} viewBox={`0 0 ${PAGE.width} ${PAGE.height}`}>
          <PageBackground background={page.background} />
          <StrokeLayer strokes={page.strokes} />
          {liveStroke ? <StrokePath s={liveStroke} /> : null}
        </Svg>
      </View>
    </GestureDetector>
  );
}
