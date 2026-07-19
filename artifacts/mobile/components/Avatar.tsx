import React from "react";
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
  const containerStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth,
    borderColor: colors.accentGreen,
  };

  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[styles.image, containerStyle as any, style]}
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
