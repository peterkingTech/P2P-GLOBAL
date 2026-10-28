import React, { memo } from "react";
import Svg, { Path, Line, Rect } from "react-native-svg";
import { PAGE, strokePath, strokeWidth, strokeOpacity, type Page, type Stroke } from "@/lib/handwriting";

// Draws one page of a drawing document — the same renderer for the learner,
// the peer evaluator and group reviewers. Data in, picture out: nothing from
// the document is ever treated as markup.

const LINE_GAP = 50;
const PAPER = "#fffdf7", RULE = "#d9e3ec", MARGIN = "#f3c4c4";

export function PageBackground({ background }: { background: Page["background"] }) {
  const lines: React.ReactNode[] = [];
  if (background === "lined" || background === "grid") {
    for (let y = LINE_GAP * 2; y < PAGE.height; y += LINE_GAP) lines.push(<Line key={`h${y}`} x1={0} y1={y} x2={PAGE.width} y2={y} stroke={RULE} strokeWidth={1.5} />);
  }
  if (background === "grid") {
    for (let x = LINE_GAP; x < PAGE.width; x += LINE_GAP) lines.push(<Line key={`v${x}`} x1={x} y1={0} x2={x} y2={PAGE.height} stroke={RULE} strokeWidth={1.5} />);
  }
  if (background === "lined") lines.push(<Line key="margin" x1={90} y1={0} x2={90} y2={PAGE.height} stroke={MARGIN} strokeWidth={2} />);
  return <>
    <Rect x={0} y={0} width={PAGE.width} height={PAGE.height} fill={PAPER} />
    {lines}
  </>;
}

export const StrokePath = memo(function StrokePath({ s }: { s: Stroke }) {
  return <Path d={strokePath(s.points)} stroke={s.color} strokeWidth={strokeWidth(s)} strokeOpacity={strokeOpacity(s.tool)}
    strokeLinecap="round" strokeLinejoin="round" fill="none" />;
});

/** Finished strokes don't re-render while a new one is being drawn. */
export const StrokeLayer = memo(function StrokeLayer({ strokes }: { strokes: Stroke[] }) {
  return <>{strokes.map((s, i) => <StrokePath key={i} s={s} />)}</>;
});

export default function DrawingView({ page, width, label }: { page: Page; width: number; label?: string }) {
  const height = (width * PAGE.height) / PAGE.width;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${PAGE.width} ${PAGE.height}`} accessible accessibilityRole="image" accessibilityLabel={label ?? "Drawing"}>
      <PageBackground background={page.background} />
      <StrokeLayer strokes={page.strokes} />
    </Svg>
  );
}
