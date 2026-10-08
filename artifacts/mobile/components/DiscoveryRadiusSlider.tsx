import React, { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, PanResponder, I18nManager, LayoutChangeEvent } from "react-native";
import colors from "@/constants/colors";

// Discovery Search radius. Snaps to fixed stops (evenly spaced on the track,
// so the short distances stay easy to pick) and reports a new value only
// when the finger lifts — dragging never fires a search per frame.
export const RADIUS_STOPS_KM = [5, 10, 25, 50, 100, 250, 500, 1000] as const;
export const DEFAULT_RADIUS_KM = 50;

const THUMB = 26;

function nearestStopIndex(km: number): number {
  let best = 0;
  RADIUS_STOPS_KM.forEach((s, i) => { if (Math.abs(s - km) < Math.abs(RADIUS_STOPS_KM[best] - km)) best = i; });
  return best;
}

interface Props {
  valueKm: number;
  onChange: (km: number) => void;
  // Already-translated strings from the screen.
  label: string;
  formatKm: (km: number) => string;
  disabled?: boolean;
}

export default function DiscoveryRadiusSlider({ valueKm, onChange, label, formatKm, disabled }: Props) {
  const committedIndex = nearestStopIndex(valueKm);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const index = dragIndex ?? committedIndex;
  const last = RADIUS_STOPS_KM.length - 1;
  const rtl = I18nManager.isRTL;

  // Refs so the PanResponder (created once) always sees current values.
  const state = useRef({ width: 0, startIndex: committedIndex, dragIndex: committedIndex, committedIndex, disabled, onChange });
  state.current.width = width;
  state.current.committedIndex = committedIndex;
  state.current.disabled = disabled;
  state.current.onChange = onChange;

  const indexFromX = (x: number) => {
    const usable = Math.max(1, state.current.width - THUMB);
    let ratio = Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
    if (rtl) ratio = 1 - ratio;
    return Math.round(ratio * last);
  };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !state.current.disabled,
    onMoveShouldSetPanResponder: (_e, g) => !state.current.disabled && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const i = indexFromX(e.nativeEvent.locationX);
      state.current.startIndex = i;
      state.current.dragIndex = i;
      setDragIndex(i);
    },
    onPanResponderMove: (_e, g) => {
      const usable = Math.max(1, state.current.width - THUMB);
      const step = usable / last;
      const delta = Math.round((rtl ? -g.dx : g.dx) / step);
      const i = Math.min(last, Math.max(0, state.current.startIndex + delta));
      if (i !== state.current.dragIndex) {
        state.current.dragIndex = i;
        setDragIndex(i);
      }
    },
    onPanResponderRelease: () => {
      const i = state.current.dragIndex;
      setDragIndex(null);
      if (i !== state.current.committedIndex) state.current.onChange(RADIUS_STOPS_KM[i]);
    },
    onPanResponderTerminate: () => setDragIndex(null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rtl, last]);

  const step = (dir: 1 | -1) => {
    const i = Math.min(last, Math.max(0, committedIndex + dir));
    if (i !== committedIndex) onChange(RADIUS_STOPS_KM[i]);
  };

  const usable = Math.max(0, width - THUMB);
  const pos = (index / last) * usable;
  const thumbOffset = rtl ? usable - pos : pos;
  const fillStart = rtl ? thumbOffset + THUMB / 2 : THUMB / 2;
  const fillWidth = rtl ? usable - thumbOffset : thumbOffset;

  return (
    <View style={[styles.wrap, disabled && { opacity: 0.5 }]}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{formatKm(RADIUS_STOPS_KM[index])}</Text>
      </View>
      <View
        style={styles.touchArea}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: formatKm(RADIUS_STOPS_KM[committedIndex]) }}
        accessibilityState={{ disabled: !!disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          if (disabled) return;
          if (e.nativeEvent.actionName === "increment") step(1);
          else if (e.nativeEvent.actionName === "decrement") step(-1);
        }}
        {...pan.panHandlers}
      >
        <View pointerEvents="none" style={[styles.track, { left: THUMB / 2, right: THUMB / 2 }]} />
        {width > 0 && <View pointerEvents="none" style={[styles.fill, { left: fillStart, width: fillWidth }]} />}
        {width > 0 && RADIUS_STOPS_KM.map((s, i) => {
          const x = (i / last) * usable;
          return <View key={s} pointerEvents="none" style={[styles.tick, { left: (rtl ? usable - x : x) + THUMB / 2 - 2 }, i <= index && styles.tickActive]} />;
        })}
        {width > 0 && <View pointerEvents="none" style={[styles.thumb, { left: thumbOffset }, dragIndex !== null && styles.thumbActive]} />}
      </View>
      <View style={styles.ends}>
        <Text style={styles.endText}>{formatKm(RADIUS_STOPS_KM[rtl ? last : 0])}</Text>
        <Text style={styles.endText}>{formatKm(RADIUS_STOPS_KM[rtl ? 0 : last])}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  value: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  // Positions below are computed physically (RTL handled in code), so the
  // track itself is laid out LTR to stop React Native swapping left/right.
  touchArea: { height: 40, justifyContent: "center", direction: "ltr" },
  track: { position: "absolute", height: 4, borderRadius: 2, backgroundColor: colors.borderBeige },
  fill: { position: "absolute", height: 4, borderRadius: 2, backgroundColor: colors.primaryGreen },
  tick: { position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textMuted, opacity: 0.5 },
  tickActive: { backgroundColor: "#fff", opacity: 1 },
  thumb: {
    position: "absolute", width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.primaryGreen,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  thumbActive: { transform: [{ scale: 1.12 }] },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  endText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
