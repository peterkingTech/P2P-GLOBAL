import React, { useEffect, useState } from "react";
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle, ImageStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";

// The app's one round profile picture. Every screen that shows a person uses
// this (it used to be re-drawn by hand in ~20 places, most without a fallback
// for a photo that fails to load). Story artwork and other content images
// are NOT avatars — they use their own components and are never forced into
// a circle.
interface AvatarProps {
  photoUrl?: string | null;
  /** Used for the initial shown when there is no photo. */
  name?: string | null;
  size?: number;
  /** Shown instead of the initial when there is no photo (e.g. a notification type icon). */
  fallbackIcon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  borderWidth?: number;
  accessibilityLabel?: string;
}

export function Avatar({ photoUrl, name, size = 40, fallbackIcon, style, borderWidth = 0, accessibilityLabel }: AvatarProps) {
  const { colors } = useTheme();
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  // A photo URL that no longer loads (deleted file, expired link, offline)
  // falls back to the initial instead of leaving an empty circle. Reset when
  // the URL changes so a new photo gets its own chance to load.
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [photoUrl]);
  const containerStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth,
    borderColor: colors.accentGreen,
    backgroundColor: "rgba(29,158,117,0.15)",
  };
  const a11y = accessibilityLabel
    ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel }
    : { accessibilityElementsHidden: true, importantForAccessibility: "no" as const };

  if (photoUrl && !failed) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[containerStyle as ImageStyle, style as StyleProp<ImageStyle>]}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
        {...a11y}
      />
    );
  }

  return (
    <View style={[styles.circle, containerStyle, style]} {...a11y}>
      {fallbackIcon
        ? <Ionicons name={fallbackIcon} size={Math.round(size * 0.45)} color={colors.primaryGreen} />
        : <Text style={[styles.initial, { fontSize: size * 0.4, color: colors.primaryGreen }]}>{initial}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
