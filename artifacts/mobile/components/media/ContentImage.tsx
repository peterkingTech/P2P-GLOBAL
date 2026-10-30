import React, { useEffect, useState } from "react";
import { View, Image, StyleProp, ImageStyle, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// The app's one content picture with a fallback — module, curriculum, plan
// and learning artwork (NOT profile pictures: those are components/Avatar).
// No photo, or one that fails to load, shows the feature's icon on a soft
// wash of its colour instead of an empty box, so a broken link can never
// leave a hole or crash a screen. Decorative: hidden from screen readers
// (the card's own label names the content).
export interface ContentImageProps {
  uri?: string | null;
  /** Box style — the picture fills it. */
  style: StyleProp<ImageStyle>;
  /** Extra style for the fallback box (e.g. centring, its own background). */
  fallbackStyle?: StyleProp<ViewStyle>;
  fallbackIcon?: keyof typeof Ionicons.glyphMap;
  /** Icon colour; the fallback background is this colour at low opacity unless fallbackStyle sets one. */
  color: string;
  iconSize?: number;
  /** Default "cover" (fill the box, cropping the edges). */
  resizeMode?: "cover" | "contain";
}

export default function ContentImage({ uri, style, fallbackStyle, fallbackIcon = "book-outline", color, iconSize = 26, resizeMode = "cover" }: ContentImageProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  if (uri && !failed) {
    return (
      <Image source={{ uri }} style={style} resizeMode={resizeMode} onError={() => setFailed(true)}
        accessibilityElementsHidden importantForAccessibility="no" />
    );
  }
  const wash = color.startsWith("#") && color.length === 7 ? `${color}1f` : undefined;
  return (
    <View style={[style as StyleProp<ViewStyle>, { alignItems: "center", justifyContent: "center", backgroundColor: wash }, fallbackStyle]}
      accessibilityElementsHidden importantForAccessibility="no">
      <Ionicons name={fallbackIcon} size={iconSize} color={color} />
    </View>
  );
}
