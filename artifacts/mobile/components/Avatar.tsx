import React, { useEffect, useState } from "react";
import { View, Text, Image, StyleSheet, ViewStyle } from "react-native";
import colors from "@/constants/colors";

interface AvatarProps {
  photoUrl?: string | null;
  name?: string | null;
  size?: number;
  style?: ViewStyle;
  borderWidth?: number;
}

export function Avatar({ photoUrl, name, size = 40, style, borderWidth = 0 }: AvatarProps) {
  const initial = (name || "?").charAt(0).toUpperCase();
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
  };

  if (photoUrl && !failed) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[styles.image, containerStyle as any, style]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.circle, containerStyle, style]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: "rgba(29,158,117,0.15)",
  },
  circle: {
    backgroundColor: "rgba(29,158,117,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    fontWeight: "700",
    color: colors.primaryGreen,
    fontFamily: "Inter_700Bold",
  },
});
