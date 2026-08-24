import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RtcSurfaceView } from "@/lib/agoraNative";

// Minimal reusable adaptive video grid for Study Together C1's group
// calling foundation — visual pattern reused verbatim from call/group.tsx
// (Peer Circles), not reinvented, per the "one maintainable calling
// architecture" requirement. Only used when a call has more than one
// remote participant; the existing 1:1 video screen's fullscreen-remote +
// PIP-local layout is untouched for the 2-person case.

export interface GridTile {
  uid: number; // 0 = local
  name: string;
  isSelf: boolean;
  videoOn: boolean;
}

export function ParticipantGrid({ tiles }: { tiles: GridTile[] }) {
  return (
    <View style={styles.grid}>
      {tiles.map((t) => (
        <View key={t.uid} style={styles.tile}>
          {t.videoOn ? (
            <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: t.uid }} zOrderMediaOverlay={t.isSelf} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.tileAvatarWrap]}>
              <Ionicons name="person" size={32} color="rgba(255,255,255,0.4)" />
            </View>
          )}
          <View style={styles.tileFooter}>
            <Text style={styles.tileName} numberOfLines={1}>{t.name}{t.isSelf ? " (You)" : ""}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", padding: 6, alignContent: "flex-start" },
  tile: {
    width: "47%", aspectRatio: 0.9, margin: "1.5%", borderRadius: 14,
    overflow: "hidden", backgroundColor: "#141F19",
  },
  tileAvatarWrap: { alignItems: "center", justifyContent: "center", backgroundColor: "#1A241E" },
  tileFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 8, paddingVertical: 6,
  },
  tileName: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium" },
});