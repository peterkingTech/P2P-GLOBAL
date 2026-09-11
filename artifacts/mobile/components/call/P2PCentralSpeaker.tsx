import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RtcSurfaceView } from "@/lib/agoraNative";
import { P2PSpeakingRing } from "./P2PSpeakingRing";
import { P2PAudioWaveform } from "./P2PAudioWaveform";
import type { P2PCallColors } from "./p2pCallTheme";
import type { P2POrbitTile } from "./P2PParticipantNode";

// The center of the P2P circle — whoever is CURRENTLY speaking, never a
// fixed role. "Speaking" / name / role (role is secondary, small, and only
// shown if the caller actually has one to show — Direct Calls today has no
// role concept at all, so this stays blank there) are the primary label;
// there is no "Teacher"/"Host" framing built into this component. Colors
// are the caller's already-resolved theme (p2pCallTheme.ts).
export function P2PCentralSpeaker({
  tile, size, speaking, showWaveform, volume, colors,
}: {
  tile: P2POrbitTile; size: number; speaking: boolean; showWaveform?: boolean; volume?: number; colors: P2PCallColors;
}) {
  const initial = tile.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <P2PSpeakingRing active={speaking} size={size + 18} strong colors={colors} />
        <View
          style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface, borderColor: colors.accent }]}
          accessibilityLabel={`${tile.name}${speaking ? ", currently speaking" : ""}${tile.muted ? ", muted" : ""}`}
        >
          {tile.videoOn ? (
            <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: tile.uid }} zOrderMediaOverlay={tile.isSelf} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: colors.pillBg }]}>
              <Text style={[styles.avatarInitial, { fontSize: size * 0.3, color: colors.textPrimary }]}>{initial}</Text>
            </View>
          )}
          {tile.muted && (
            <View style={[styles.muteBadge, { backgroundColor: colors.bg.length === 7 ? `${colors.bg}D9` : "rgba(0,0,0,0.55)" }]} accessibilityElementsHidden importantForAccessibility="no">
              <Ionicons name="mic-off" size={16} color="#fff" />
            </View>
          )}
        </View>
      </View>

      {showWaveform && <P2PAudioWaveform active={speaking} volume={volume ?? 0} colors={colors} />}

      <View style={styles.labelWrap}>
        {speaking && (
          <View style={[styles.speakingPill, { backgroundColor: colors.pillBg }]}>
            <View style={[styles.speakingDot, { backgroundColor: colors.accent }]} />
            <Text style={[styles.speakingText, { color: colors.accent }]}>Speaking</Text>
          </View>
        )}
        <Text style={[styles.name, { color: colors.textPrimary }]}>{tile.isSelf ? "You" : tile.name}</Text>
        {!!tile.role && <Text style={[styles.role, { color: colors.textMuted }]}>{tile.role}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { overflow: "hidden", borderWidth: 1.5 },
  avatarFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontFamily: "Inter_700Bold" },
  muteBadge: { position: "absolute", bottom: 8, right: 8, borderRadius: 20, padding: 5 },
  labelWrap: { alignItems: "center", marginTop: 10, gap: 3 },
  speakingPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 2 },
  speakingDot: { width: 6, height: 6, borderRadius: 3 },
  speakingText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  name: { fontSize: 18, fontFamily: "Inter_700Bold" },
  role: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
