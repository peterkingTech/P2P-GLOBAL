import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Audio, Video, ResizeMode } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

interface Props {
  storagePath: string;
  submissionType: "audio" | "video";
  durationSeconds?: number | null;
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const VIDEO_HEIGHT = Math.round((SCREEN_WIDTH - 64) * (9 / 16));

export default function MediaPlayer({ storagePath, submissionType, durationSeconds }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [totalMillis, setTotalMillis] = useState((durationSeconds ?? 0) * 1000);

  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from("submissions")
      .createSignedUrl(storagePath, 3600)
      .then(({ data, error }) => {
        if (!cancelled) {
          if (error || !data?.signedUrl) setLoadError(true);
          else setSignedUrl(data.signedUrl);
        }
      });
    return () => {
      cancelled = true;
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, [storagePath]);

  async function toggleAudio() {
    if (!signedUrl) return;
    if (isPlaying) {
      await soundRef.current?.pauseAsync();
      setIsPlaying(false);
      return;
    }
    if (!soundRef.current) {
      const { sound } = await Audio.Sound.createAsync(
        { uri: signedUrl },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) return;
          setPositionMillis(status.positionMillis ?? 0);
          if (status.durationMillis) setTotalMillis(status.durationMillis);
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPositionMillis(0);
          }
        }
      );
      soundRef.current = sound;
    } else {
      const status = await soundRef.current.getStatusAsync() as any;
      if (status.didJustFinish || status.positionMillis >= status.durationMillis - 200) {
        await soundRef.current.replayAsync();
      } else {
        await soundRef.current.playAsync();
      }
    }
    setIsPlaying(true);
  }

  function formatTime(ms: number) {
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  const progressPct = totalMillis > 0 ? Math.min(positionMillis / totalMillis, 1) : 0;

  if (loadError) {
    return (
      <View style={styles.errorBox}>
        <Ionicons name="alert-circle-outline" size={16} color={colors.textMuted} />
        <Text style={styles.errorText}>Could not load media</Text>
      </View>
    );
  }

  if (!signedUrl) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={colors.accentGreen} size="small" />
        <Text style={styles.loadingText}>Loading media…</Text>
      </View>
    );
  }

  if (submissionType === "video") {
    return (
      <View style={styles.videoBox}>
        <Video
          source={{ uri: signedUrl }}
          style={[styles.video, { height: VIDEO_HEIGHT }]}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
        />
        {durationSeconds != null && (
          <View style={styles.durationBadge}>
            <Ionicons name="videocam" size={11} color={colors.textMid} />
            <Text style={styles.durationText}>{formatTime(durationSeconds * 1000)}</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.audioBox}>
      <View style={styles.audioHeader}>
        <Ionicons name="mic" size={14} color={colors.accentGreen} />
        <Text style={styles.audioLabel}>Audio Response</Text>
        {durationSeconds != null && (
          <Text style={styles.audioDuration}>{formatTime(durationSeconds * 1000)}</Text>
        )}
      </View>
      <View style={styles.progressRow}>
        <TouchableOpacity style={styles.playBtn} onPress={toggleAudio} activeOpacity={0.8}>
          <Ionicons name={isPlaying ? "pause" : "play"} size={18} color={colors.cream} />
        </TouchableOpacity>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct * 100}%` }]} />
        </View>
        <Text style={styles.progressTime}>{formatTime(positionMillis)}</Text>
      </View>
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
    flexDirection: "row", gap: 4, alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.cardBeige, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  durationText: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_400Regular" },

  audioBox: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige,
    backgroundColor: colors.cardBeige, padding: 12, gap: 10,
  },
  audioHeader: { flexDirection: "row", gap: 6, alignItems: "center" },
  audioLabel: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  audioDuration: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },

  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  playBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.accentGreen,
    alignItems: "center", justifyContent: "center",
  },
  progressTrack: {
    flex: 1, height: 4, backgroundColor: colors.borderBeige, borderRadius: 2, overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.accentGreen, borderRadius: 2 },
  progressTime: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", minWidth: 36 },
});
