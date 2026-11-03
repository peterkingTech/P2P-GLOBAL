import React from "react";
import { View, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { ARTWORK_FILL } from "@/constants/artwork";
import { resolveCover } from "@/constants/libraryCovers";
import { darken, withAlpha } from "@/lib/colorUtils";

/**
 * A playlist / collection cover: built-in artwork or a theme colour, with a
 * soft second tone and the kind's symbol. Decorative — the title next to it
 * is what screen readers announce.
 */
export default function CoverArt({ cover, kind, size, radius }: {
  cover: { kind: string; ref: string } | null | undefined; kind: "collection" | "playlist"; size: number; radius?: number;
}) {
  const { colors: c } = useTheme();
  const r = resolveCover(cover, kind, c);
  const rad = radius ?? Math.round(size * 0.14);
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: rad, backgroundColor: r.background, borderColor: withAlpha(c.textMuted, 0.25) }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {r.image ? <Image source={r.image} style={ARTWORK_FILL} resizeMode="cover" /> : (
        <>
          <View style={[styles.glow, { width: size * 1.1, height: size * 1.1, borderRadius: size, backgroundColor: darken(r.background, 0.28), right: -size * 0.45, bottom: -size * 0.45 }]} />
          <View style={[styles.ring, { width: size * 0.56, height: size * 0.56, borderRadius: size, backgroundColor: withAlpha("#FFFFFF", 0.14) }]}>
            <Ionicons name={r.icon as any} size={Math.round(size * 0.3)} color="#fff" />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // A faint edge keeps dark covers visible on dark themes.
  box: { overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  glow: { position: "absolute" },
  ring: { alignItems: "center", justifyContent: "center" },
});
