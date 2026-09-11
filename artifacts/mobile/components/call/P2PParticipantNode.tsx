import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RtcSurfaceView } from "@/lib/agoraNative";
import { P2PSpeakingRing } from "./P2PSpeakingRing";
import type { P2PCallColors } from "./p2pCallTheme";

export interface P2POrbitTile {
  uid: number; // 0 = local self, matching this codebase's existing convention (ParticipantGrid.tsx, video.tsx group grid)
  isSelf: boolean;
  name: string;
  role?: string | null;
  videoOn: boolean;
  muted: boolean;
  raisedHand?: boolean;
  reaction?: string | null;
}

// A single orbiting participant — video when available, a graceful avatar
// fallback otherwise (initial letter, never an empty/black rectangle).
// Camera-permission-unavailable and no-frames-yet both fall through to the
// same avatar path as camera-off, per the "graceful fallback" requirement.
// Colors are the caller's already-resolved theme (p2pCallTheme.ts) — this
// component never hardcodes a color itself.
export function P2PParticipantNode({ tile, size, speaking, colors }: { tile: P2POrbitTile; size: number; speaking: boolean; colors: P2PCallColors }) {
  const initial = tile.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <P2PSpeakingRing active={speaking} size={size + 10} colors={colors} />
      <View
        style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface, borderColor: colors.accentBorder }]}
        accessibilityLabel={`${tile.name}${tile.muted ? ", muted" : ""}${speaking ? ", speaking" : ""}${tile.raisedHand ? ", hand raised" : ""}`}
      >
        {tile.videoOn ? (
          <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: tile.uid }} zOrderMediaOverlay={tile.isSelf} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: colors.pillBg }]}>
            <Text style={[styles.avatarInitial, { fontSize: size * 0.36, color: colors.textPrimary }]}>{initial}</Text>
          </View>
        )}

        {tile.muted && (
          <View style={[styles.muteBadge, { backgroundColor: withScrimOn(colors.bg) }]} accessibilityElementsHidden importantForAccessibility="no">
            <Ionicons name="mic-off" size={Math.max(10, size * 0.16)} color="#fff" />
          </View>
        )}
        {tile.raisedHand && (
          <View style={[styles.handBadge, { backgroundColor: withScrimOn(colors.bg) }]} accessibilityElementsHidden importantForAccessibility="no">
            <Text style={{ fontSize: Math.max(10, size * 0.18) }}>✋</Text>
          </View>
        )}
        {!!tile.reaction && (
          <View style={styles.reactionBadge} accessibilityElementsHidden importantForAccessibility="no">
            <Text style={{ fontSize: Math.max(12, size * 0.22) }}>{tile.reaction}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.name, { color: colors.textMuted }]} numberOfLines={1}>{tile.isSelf ? "You" : tile.name}</Text>
    </View>
  );
}

// A small scrim behind badge icons so a white mic-off/hand glyph stays
// legible whether the tile behind it is light or dark — always a
// semi-transparent version of the current screen background, never a
// fixed color.
function withScrimOn(bg: string) {
  return bg.length === 7 ? `${bg}D9` : "rgba(0,0,0,0.55)";
}

const styles = StyleSheet.create({
  circle: { overflow: "hidden", borderWidth: 1 },
  avatarFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontFamily: "Inter_700Bold" },
  muteBadge: { position: "absolute", bottom: 2, right: 2, borderRadius: 20, padding: 3 },
  handBadge: { position: "absolute", top: 2, right: 2, borderRadius: 20, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  reactionBadge: { position: "absolute", top: -4, alignSelf: "center" },
  name: { marginTop: 4, fontSize: 11, fontFamily: "Inter_500Medium", maxWidth: 76, textAlign: "center" },
});
