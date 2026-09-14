import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Dimensions } from "react-native";
import { Video, ResizeMode } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { getTestimonySignedUrl } from "@/lib/prayerTestimonyApi";
import colors from "@/constants/colors";

// Video-only sibling of components/MediaPlayer.tsx, sourced from the
// separate "prayer-testimonies" bucket (migration 141) instead of
// "submissions" — same signed-URL-on-mount pattern, same visual language.
interface Props {
  mediaPath: string;
  durationSeconds?: number | null;
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const VIDEO_HEIGHT = Math.round((SCREEN_WIDTH - 64) * (9 / 16));

export default function TestimonyVideoPlayer({ mediaPath, durationSeconds }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTestimonySignedUrl(mediaPath).then((url) => {
      if (cancelled) return;
      if (url) setSignedUrl(url); else setLoadError(true);
    });
    return () => { cancelled = true; };
  }, [mediaPath]);

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = Math.round(seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

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
      {durationSeconds != null && (
        <View style={styles.durationBadge}>
          <Ionicons name="videocam" size={11} color={colors.textMid} />
          <Text style={styles.durationText}>{formatTime(durationSeconds)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingBox: {
    flexDirection: "row", gap: 8, alignItems: "center",
    padding: 12, borderRadius: 10, backgroundColor: colors.cardBeige,
    borderWidth: 1, borderColor: colors.borderBeige,
  },
  loadingText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  errorBox: {
    flexDirection: "row", gap: 6, alignItems: "center",
    padding: 10, borderRadius: 8, backgroundColor: colors.cardBeige,
  },
  errorText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  videoBox: { gap: 6 },
  video: { width: "100%", borderRadius: 10, backgroundColor: colors.textDark },
  durationBadge: {
    flexDirection: "row", gap: 4, alignItems: "center", alignSelf: "flex-start",
    backgroundColor: colors.cardBeige, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  durationText: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_400Regular" },
});
