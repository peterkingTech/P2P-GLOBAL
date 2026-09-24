import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RtcSurfaceView } from "@/lib/agoraNative";
import type { P2PCallColors } from "./p2pCallTheme";
import type { P2POrbitTile } from "./P2PParticipantNode";
import { P2PAudioWaveform } from "./P2PAudioWaveform";

// Conventional rectangular replacement for P2PParticipantOrbit — same
// P2POrbitTile[]/speakingUids/colors data every call screen already
// computes from the unmodified Agora state (see audio.tsx/video.tsx);
// this only changes how that data is arranged on screen.
//
// Two layouts, chosen purely by participant count (never by who's
// speaking — active-speaker state is shown as a highlighted tile border,
// not by swapping which tile is large, matching standard calling-app
// conventions rather than the old orbit's "center = active speaker"):
//   - 1 other participant (the normal 1:1 case, incl. Study Together's
//     2-person call): large main tile for the other person, small
//     picture-in-picture tile for self — video calls only; audio calls
//     have no self tile at all (mute state already lives on the control
//     bar, matching a conventional phone call screen).
//   - 2+ other participants: a responsive rectangular grid, self included.
export function P2PRectStage({
  tiles,
  speakingUids,
  colors,
  showWaveform,
  renderVideo = true,
}: {
  tiles: P2POrbitTile[];
  speakingUids: ReadonlySet<number>;
  colors: P2PCallColors;
  showWaveform?: boolean;
  /** false for audio calls: tiles never render a video surface, always the avatar fallback. */
  renderVideo?: boolean;
}) {
  const self = tiles.find((t) => t.isSelf) ?? tiles[0];
  const others = tiles.filter((t) => !t.isSelf);

  if (others.length <= 1) {
    const other = others[0] ?? null;
    const otherSpeaking = !!other && speakingUids.has(other.uid);
    return (
      <View style={styles.mainWrap}>
        {other ? (
          <Tile tile={other} colors={colors} speaking={otherSpeaking} renderVideo={renderVideo} variant="main" />
        ) : (
          <View style={[styles.tile, styles.mainWrap, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}>
            <Ionicons name="person" size={48} color={colors.textMuted} />
          </View>
        )}
        {showWaveform && (
          <View style={styles.waveformDock} pointerEvents="none">
            <P2PAudioWaveform active={otherSpeaking} volume={0} colors={colors} />
          </View>
        )}
        {renderVideo && (
          <View style={[styles.pipTile, { borderColor: colors.surfaceBorder }]}>
            <Tile tile={self} colors={colors} speaking={speakingUids.has(self.uid)} renderVideo={renderVideo} variant="pip" />
          </View>
        )}
      </View>
    );
  }

  const totalTiles = 1 + others.length;
  const columns = totalTiles <= 4 ? 2 : 3;
  return (
    <View style={styles.grid}>
      {tiles.map((t) => (
        <View key={t.uid} style={[styles.gridCell, { width: `${100 / columns}%` }]}>
          <Tile tile={t} colors={colors} speaking={speakingUids.has(t.uid)} renderVideo={renderVideo} variant="grid" />
        </View>
      ))}
    </View>
  );
}

function Tile({
  tile, colors, speaking, renderVideo, variant,
}: {
  tile: P2POrbitTile; colors: P2PCallColors; speaking: boolean; renderVideo: boolean; variant: "main" | "pip" | "grid";
}) {
  const initial = tile.name.trim().charAt(0).toUpperCase() || "?";
  const showVideo = renderVideo && tile.videoOn;
  const initialSize = variant === "main" ? 44 : variant === "pip" ? 18 : 28;

  return (
    <View
      style={[
        styles.tile,
        variant === "main" && styles.mainWrap,
        variant === "grid" && styles.gridTile,
        {
          backgroundColor: colors.surface,
          borderColor: speaking ? colors.accent : colors.surfaceBorder,
          borderWidth: speaking ? 2 : 1,
        },
      ]}
      accessibilityLabel={`${tile.isSelf ? "You" : tile.name}${tile.muted ? ", muted" : ""}${speaking ? ", speaking" : ""}${tile.raisedHand ? ", hand raised" : ""}`}
    >
      {showVideo ? (
        <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: tile.uid }} zOrderMediaOverlay={tile.isSelf} />
      ) : tile.photoUrl ? (
        <Image source={{ uri: tile.photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.avatarFallback, { backgroundColor: colors.pillBg }]}>
          <Text style={[styles.avatarInitial, { color: colors.textPrimary, fontSize: initialSize }]}>{initial}</Text>
        </View>
      )}
      {variant !== "pip" && (
        <View style={styles.tileFooter}>
          <Text style={styles.tileName} numberOfLines={1}>{tile.isSelf ? "You" : tile.name}</Text>
          {tile.muted && <Ionicons name="mic-off" size={12} color="#fff" style={styles.footerIcon} />}
          {tile.raisedHand && <Text style={styles.footerHand}>✋</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mainWrap: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
  waveformDock: { position: "absolute", bottom: 16, alignSelf: "center" },
  pipTile: {
    position: "absolute", top: 16, right: 16, width: 92, height: 122,
    borderRadius: 14, overflow: "hidden", borderWidth: 2,
  },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", padding: 8, alignContent: "flex-start" },
  gridCell: { aspectRatio: 0.82, padding: 4 },
  gridTile: { flex: 1 },
  tile: { borderRadius: 14, overflow: "hidden" },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontFamily: "Inter_700Bold" },
  tileFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 8, paddingVertical: 6,
  },
  tileName: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium", flexShrink: 1 },
  footerIcon: { marginLeft: 4 },
  footerHand: { fontSize: 12, marginLeft: 4 },
});
