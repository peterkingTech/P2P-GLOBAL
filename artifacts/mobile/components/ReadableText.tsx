import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
  type TextProps,
  type TextStyle,
} from "react-native";
import { BALANCED_WRAP, keepScriptureReferencesTogether } from "@/lib/typography";

type Props = TextProps & {
  // Opt-in for short centred paragraphs (onboarding-style copy): lines are
  // evened out so the last line is never a lone word or tiny fragment.
  balance?: boolean;
};

// Drop-in <Text> for explanatory paragraphs, headings and Scripture
// references: balanced native wrapping (no lone last word) and Scripture
// references kept on one line. Purely presentational — the string it is
// given (usually a translation) is rendered as-is apart from the spaces
// inside a reference becoming non-breaking.
export default function ReadableText({ children, balance = false, ...props }: Props) {
  const content = bindReferences(children);
  // onTextLayout isn't reliable on react-native-web; web keeps native wrapping.
  if (balance && Platform.OS !== "web") return <BalancedText {...props}>{content}</BalancedText>;
  return (
    <Text {...BALANCED_WRAP} {...props}>
      {content}
    </Text>
  );
}

// Plain-string children ("— {s.reference}" arrives as ["— ", ref]) are
// joined first so a reference split across JSX pieces is still detected;
// nested elements (a <Text> span inside the paragraph) are left alone.
function bindReferences(children: React.ReactNode): React.ReactNode {
  const parts = React.Children.toArray(children);
  if (parts.every((p) => typeof p === "string" || typeof p === "number")) {
    return keepScriptureReferencesTogether(parts.join(""));
  }
  return parts.map((p) => (typeof p === "string" ? keepScriptureReferencesTogether(p) : p));
}

// Spacing/placement keys belong on the wrapper; everything else (font, colour,
// alignment, line height) stays on the text so the measuring copy matches.
const OUTER_KEYS = [
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "marginHorizontal", "marginVertical", "marginStart", "marginEnd", "alignSelf",
] as const;

// Never balance narrower than this share of the available width, so the
// paragraph doesn't collapse into a thin column.
const MIN_BALANCE_RATIO = 0.6;
// Stop the width search once the bracket is this tight (dp).
const PRECISION = 3;

// Balanced wrapping that is measured, not guessed — the RN equivalent of CSS
// `text-wrap: balance`. An invisible copy of the text is laid out at the full
// available width to learn its natural line count, then binary-searched for
// the narrowest width that still keeps that same count. Rendering at that
// width spreads the words evenly across the lines, so the last line can't be
// a stranded word ("borders.") and a bound Scripture reference moves down as
// one piece. Same font, size and line count as before — only the line
// breaks move — and it re-runs for every language, width and font scale.
function BalancedText({ children, style, onTextLayout, ...props }: TextProps) {
  const { fontScale } = useWindowDimensions();
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = { ...flat };
  for (const k of OUTER_KEYS) {
    if (k in inner) { outer[k] = inner[k]; delete inner[k]; }
  }
  const maxWidth = typeof inner.maxWidth === "number" ? inner.maxWidth : Infinity;
  delete inner.maxWidth;

  const [available, setAvailable] = useState<number | null>(null);
  const cap = available === null ? null : Math.floor(Math.min(available, maxWidth));
  const key = `${typeof children === "string" ? children : String(children)}|${cap}|${fontScale}`;

  const [probe, setProbe] = useState<number | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const search = useRef<{ key: string; target: number; lo: number; hi: number } | null>(null);

  // New text, width or font scale → measure again from the full width.
  useEffect(() => {
    search.current = null;
    setWidth(null);
    setProbe(cap);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Never leave the text invisible if a measurement doesn't come back.
  useEffect(() => {
    if (width !== null || cap === null) return;
    const t = setTimeout(() => { setWidth(cap); setProbe(null); }, 600);
    return () => clearTimeout(t);
  }, [width, cap]);

  function onProbeLayout(e: NativeSyntheticEvent<TextLayoutEventData>) {
    if (cap === null || probe === null) return;
    const lines = e.nativeEvent.lines.length;
    const s = search.current;
    if (!s || s.key !== key) {
      // First pass at the full width: its line count is the target.
      if (lines <= 1) { setWidth(cap); setProbe(null); return; }
      search.current = { key, target: lines, lo: Math.floor(cap * MIN_BALANCE_RATIO), hi: cap };
    } else if (lines <= s.target) {
      s.hi = probe;
    } else {
      s.lo = probe;
    }
    const cur = search.current!;
    if (cur.hi - cur.lo <= PRECISION) {
      setWidth(Math.ceil(cur.hi));
      setProbe(null);
      return;
    }
    setProbe(Math.round((cur.lo + cur.hi) / 2));
  }

  return (
    <View
      style={[styles.wrap, outer as object]}
      onLayout={(e: LayoutChangeEvent) => setAvailable(e.nativeEvent.layout.width)}
    >
      {probe !== null && (
        <Text
          // Remount per width: Fabric skips onTextLayout when the line
          // metrics repeat, which would otherwise stall the search.
          key={probe}
          {...BALANCED_WRAP}
          {...props}
          style={[inner, styles.probe, { width: probe }]}
          onTextLayout={onProbeLayout}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {children}
        </Text>
      )}
      <Text
        {...BALANCED_WRAP}
        {...props}
        style={[inner, width === null ? { maxWidth: cap ?? undefined, opacity: 0 } : { width }]}
        onTextLayout={onTextLayout}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Stretch to the parent's content width (that's what we measure) and
  // centre the text inside it, matching how the plain <Text> sat before.
  wrap: { alignSelf: "stretch", alignItems: "center" },
  probe: { position: "absolute", top: 0, opacity: 0 },
});
