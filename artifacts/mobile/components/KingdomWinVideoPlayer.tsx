import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Dimensions } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { getKingdomWinMediaSignedUrl } from "@/lib/kingdomWinsApi";
import colors from "@/constants/colors";

// Sibling of components/MissionVideoPlayer.tsx / TestimonyVideoPlayer.tsx,
// sourced from the separate "kingdom-wins-media" bucket (migration 150).
interface Props { mediaPath: string }

const SCREEN_WIDTH = Dimensions.get("window").width;
const VIDEO_HEIGHT = Math.round((SCREEN_WIDTH - 40) * (9 / 16));

export default function KingdomWinVideoPlayer({ mediaPath }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Must be called unconditionally (hook rules) even though this component
  // has early returns below for the loading/error states.
  const player = useVideoPlayer(signedUrl ? { uri: signedUrl } : null);

  useEffect(() => {
    let cancelled = false;
    getKingdomWinMediaSignedUrl(mediaPath).then((url) => {
      if (cancelled) return;
      if (url) setSignedUrl(url); else setLoadError(true);
    });
    return () => { cancelled = true; };
  }, [mediaPath]);

  if (loadError) {
    return (
      <View style={styles.errorBox}>
        <Ionicons name="alert-circle-outline" size={16} color={colors.textMuted} />
        <Text style={styles.errorText}>Could not load video</Text>
      </View>
    );
  }
  if (!signedUrl) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.accentGreen} size="small" />
        <Text style={styles.loadingText}>Loading video…</Text>
      </View>
    );
  }
  return (
    <View style={styles.videoBox}>
      <VideoView player={player} style={[styles.video, { height: VIDEO_HEIGHT }]} nativeControls contentFit="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingBox: { flexDirection: "row", gap: 8, alignItems: "center", padding: 12, borderRadius: 10, backgroundColor: colors.cardBeige, borderWidth: 1, borderColor: colors.borderBeige },
  loadingText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  errorBox: { flexDirection: "row", gap: 6, alignItems: "center", padding: 10, borderRadius: 8, backgroundColor: colors.cardBeige },
  errorText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  videoBox: { gap: 6 },
  video: { width: "100%", borderRadius: 10, backgroundColor: colors.textDark },
});
