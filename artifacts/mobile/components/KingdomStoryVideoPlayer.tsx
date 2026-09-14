import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Dimensions } from "react-native";
import { Video, ResizeMode } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { getKingdomStoryMediaSignedUrl } from "@/lib/kingdomStoriesApi";
import colors from "@/constants/colors";

// Sibling of components/KingdomWinVideoPlayer.tsx / MissionVideoPlayer.tsx,
// sourced from the separate "kingdom-stories-media" bucket (migration 152).
interface Props { mediaPath: string }

const SCREEN_WIDTH = Dimensions.get("window").width;
const VIDEO_HEIGHT = Math.round((SCREEN_WIDTH - 40) * (9 / 16));

export default function KingdomStoryVideoPlayer({ mediaPath }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);
    setLoadError(false);
    getKingdomStoryMediaSignedUrl(mediaPath).then((url) => {
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
      <Video source={{ uri: signedUrl }} style={[styles.video, { height: VIDEO_HEIGHT }]} useNativeControls resizeMode={ResizeMode.CONTAIN} />
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
