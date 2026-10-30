import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { useMediaBox } from "@/hooks/useLayout";
import { useTheme } from "@/contexts/ThemeContext";
import { formatClock } from "@/lib/timeFormat";

// The app's one player for private videos (Kingdom Stories, Kingdom Wins,
// Missions, prayer testimonies — each kept in its own storage bucket). The
// feature passes the function that turns its storage path into a short-lived
// signed link; everything else is shared: loading and error states, the
// native controls (play, scrub, full screen), the whole picture shown
// (contain) in a 16:9 box sized for the screen, and an optional length badge.
// A failed link lookup shows "Could not load video" instead of spinning.

export interface VideoPlayerProps {
  /** Storage path of the video. */
  mediaPath: string;
  /** Resolves the path to a signed URL (null = not available). */
  resolveUrl: (mediaPath: string) => Promise<string | null>;
  /** Shown as a small "mm:ss" badge under the video when known. */
  durationSeconds?: number | null;
  /** Horizontal padding around the player on phones, for the 16:9 box. Default 40. */
  horizontalPadding?: number;
  accessibilityLabel?: string;
}

export default function VideoPlayer({ mediaPath, resolveUrl, durationSeconds, horizontalPadding = 40, accessibilityLabel = "Video" }: VideoPlayerProps) {
  const { colors: c } = useTheme();
  const mediaBox = useMediaBox(horizontalPadding, 9 / 16);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Called unconditionally (hook rules); expo-video releases it on unmount.
  const player = useVideoPlayer(signedUrl ? { uri: signedUrl } : null);

  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);
    setLoadError(false);
    resolveUrl(mediaPath)
      .then((url) => { if (!cancelled) { if (url) setSignedUrl(url); else setLoadError(true); } })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [mediaPath, resolveUrl]);

  if (loadError) {
    return (
      <View style={[styles.statusBox, { backgroundColor: c.cardBeige }]} accessibilityRole="alert">
        <Ionicons name="alert-circle-outline" size={16} color={c.textMuted} />
        <Text style={[styles.statusText, { color: c.textMuted }]}>Could not load video</Text>
      </View>
    );
  }
  if (!signedUrl) {
    return (
      <View style={[styles.statusBox, { backgroundColor: c.cardBeige, borderWidth: 1, borderColor: c.borderBeige }]}>
        <ActivityIndicator color={c.accentGreen} size="small" />
        <Text style={[styles.statusText, { color: c.textMuted }]}>Loading video…</Text>
      </View>
    );
  }
  return (
    <View style={styles.videoBox}>
      <VideoView player={player} style={[styles.video, mediaBox]} nativeControls contentFit="contain"
        accessibilityLabel={accessibilityLabel} />
      {durationSeconds != null && (
        <View style={[styles.durationBadge, { backgroundColor: c.cardBeige }]}>
          <Ionicons name="videocam" size={11} color={c.textMid} />
          <Text style={[styles.durationText, { color: c.textMid }]}>{formatClock(Math.round(durationSeconds), { padded: true })}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  statusBox: { flexDirection: "row", gap: 8, alignItems: "center", padding: 12, borderRadius: 10 },
  statusText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  videoBox: { gap: 6 },
  video: { width: "100%", borderRadius: 10, backgroundColor: "#000" },
  durationBadge: { flexDirection: "row", gap: 4, alignItems: "center", alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  durationText: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
