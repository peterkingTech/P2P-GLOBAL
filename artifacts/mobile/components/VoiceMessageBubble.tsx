import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Audio } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";

interface Props {
  mediaUrl: string;
  durationSeconds: number | null;
  mine?: boolean;
}

// Playback counterpart to AudioRecorder.tsx — same expo-av Audio.Sound
// pattern as MediaPlayer.tsx, but the voice-messages bucket is public
// (migration 070), so this plays mediaUrl directly instead of first
// exchanging a storage path for a signed URL.
export function VoiceMessageBubble({ mediaUrl, durationSeconds, mine }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [totalMillis, setTotalMillis] = useState((durationSeconds ?? 0) * 1000);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync().catch(() => {}); };
  }, []);

  async function toggle() {
    if (isPlaying) {
      await soundRef.current?.pauseAsync();
      setIsPlaying(false);
      return;
    }
    if (!soundRef.current) {
      const { sound } = await Audio.Sound.createAsync(
        { uri: mediaUrl },
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
      const status = (await soundRef.current.getStatusAsync()) as any;
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

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.playBtn, mine ? styles.playBtnMine : styles.playBtnTheirs]}
        onPress={toggle}
        activeOpacity={0.8}
      >
        <Ionicons name={isPlaying ? "pause" : "play"} size={16} color={mine ? colors.accentGreen : "#fff"} />
      </TouchableOpacity>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPct * 100}%` }, mine && styles.progressFillMine]} />
      </View>
      <Text style={[styles.time, mine && styles.timeMine]}>
        {formatTime(isPlaying || positionMillis > 0 ? positionMillis : totalMillis)}
      </Text>
    </View>
  );
}

export default VoiceMessageBubble;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 160 },
  playBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  playBtnTheirs: { backgroundColor: colors.accentGreen },
  playBtnMine: { backgroundColor: "rgba(255,255,255,0.9)" },
  progressTrack: { flex: 1, height: 4, backgroundColor: "rgba(0,0,0,0.15)", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.accentGreen, borderRadius: 2 },
  progressFillMine: { backgroundColor: "#fff" },
  time: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", minWidth: 34 },
  timeMine: { color: "rgba(255,255,255,0.85)" },
});