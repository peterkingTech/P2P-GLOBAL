import React, { useState } from "react";
import { View, StyleSheet, LayoutChangeEvent } from "react-native";
import { P2PCentralSpeaker } from "./P2PCentralSpeaker";
import { P2PParticipantNode } from "./P2PParticipantNode";
import type { P2POrbitTile } from "./P2PParticipantNode";
import type { P2PCallColors } from "./p2pCallTheme";

// THE P2P PARTICIPANT CIRCLE — the product's visual signature. Renders
// whichever participant is CURRENTLY the active speaker large in the
// center (never a fixed role — see P2PCentralSpeaker's own comment), with
// every other participant arranged evenly around it. Positions are
// computed from the actual measured container size and live participant
// count — nothing here is a fixed number of hardcoded slots, so 2 through
// 12+ participants all lay out correctly (section 9 of the mandate).
//
// This component owns ONLY presentation: which tile is "active" comes from
// useActiveSpeaker.ts, which itself only consumes the existing, unmodified
// Agora onAudioVolumeIndication callback. No Agora/session/call-state
// logic lives here. Colors are the caller's already-resolved theme
// (p2pCallTheme.ts) — this orbit is recognizable by its SHAPE and motion
// in any theme, not by a fixed palette.
export function P2PParticipantOrbit({
  centerTile, orbitTiles, speakingUids, showWaveform, activeVolume, colors,
}: {
  centerTile: P2POrbitTile;
  orbitTiles: P2POrbitTile[];
  speakingUids: ReadonlySet<number>;
  showWaveform?: boolean;
  activeVolume?: number;
  colors: P2PCallColors;
}) {
  const [box, setBox] = useState({ width: 0, height: 0 });

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    if (width !== box.width || height !== box.height) setBox({ width, height });
  }

  const n = orbitTiles.length;
  // Node size shrinks gracefully as the group grows — see section 25: this
  // app's own real ceiling for a Direct/Study-Together call is 6
  // participants total (5 in the orbit; canAddPeople caps remoteUids at 5
  // in audio.tsx/video.tsx today), well within one comfortable ring, but
  // the math itself does not assume that ceiling and degrades sensibly
  // beyond it rather than hardcoding a slot count.
  const nodeSize = n <= 1 ? 84 : n <= 3 ? 76 : n <= 5 ? 64 : n <= 8 ? 56 : 46;
  const centerSize = n === 0 ? 168 : n <= 3 ? 152 : 136;

  const maxRadius = box.width > 0 && box.height > 0
    ? Math.max(0, Math.min(box.width, box.height) / 2 - nodeSize / 2 - 8)
    : 0;
  // A lone second participant reads better as a small secondary circle
  // near the center (mirroring the mandate's own 2-person example: "Large
  // central active participant + small local participant orbit/secondary
  // circle") than as a single point awkwardly parked at the top of an
  // otherwise-empty ring.
  const radius = n === 1 ? Math.min(maxRadius, centerSize / 2 + nodeSize / 2 + 20) : maxRadius;

  return (
    <View style={styles.container} onLayout={onLayout}>
      {box.width > 0 && (
        <>
          <View style={styles.centerWrap}>
            <P2PCentralSpeaker
              tile={centerTile}
              size={centerSize}
              speaking={speakingUids.has(centerTile.uid)}
              showWaveform={showWaveform}
              volume={activeVolume}
              colors={colors}
            />
          </View>
          {orbitTiles.map((tile, i) => {
            // Start at the top (12 o'clock) and go clockwise, matching the
            // mandate's own diagrams (participants shown above and below).
            const angle = n === 1 ? Math.PI / 2 : (2 * Math.PI * i) / n - Math.PI / 2;
            const cx = box.width / 2 + radius * Math.cos(angle);
            const cy = box.height / 2 + radius * Math.sin(angle);
            return (
              <View key={tile.uid} style={[styles.orbitNode, { left: cx - nodeSize / 2, top: cy - nodeSize / 2 }]}>
                <P2PParticipantNode tile={tile} size={nodeSize} speaking={speakingUids.has(tile.uid)} colors={colors} />
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: "100%" },
  centerWrap: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  orbitNode: { position: "absolute" },
});
