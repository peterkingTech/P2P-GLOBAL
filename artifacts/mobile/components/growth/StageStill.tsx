import React, { useState } from "react";
import { Image, Text, View, StyleSheet } from "react-native";
import { STAGES, STAGE_IMAGES } from "@/constants/stages";

// A personal growth stage shown as the still of its 3D model (transparent background).
// If the image can't load (offline, first run) the stage's emoji stands in.
export default function StageStill({ stageIndex, size }: { stageIndex: number; size: number }) {
  const [failed, setFailed] = useState(false);
  const stage = STAGES[stageIndex];
  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel={stage.name}>
      {!failed ? (
        <Image source={STAGE_IMAGES[stageIndex]} style={{ width: size, height: size }} resizeMode="contain" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.fallback}><Text style={{ fontSize: size * 0.4 }}>{stage.emoji}</Text></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fallback: { flex: 1, alignItems: "center", justifyContent: "center" } });
