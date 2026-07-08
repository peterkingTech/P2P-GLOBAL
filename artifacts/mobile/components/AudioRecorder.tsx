import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Audio } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";

type RecorderState = "idle" | "requesting" | "ready" | "recording" | "reviewing" | "uploading";

interface Props {
  onSubmit: (localUri: string, durationSeconds: number) => Promise<void>;
  disabled?: boolean;
}

export default function AudioRecorder({ onSubmit, disabled }: Props) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [playbackMillis, setPlaybackMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      timerRef.current && clearInterval(timerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  async function startRecording() {
    setState("requesting");
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") {
      setState("idle");
      return;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    recordingRef.current = recording;
    setElapsedSeconds(0);
    setState("recording");
    timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
  }

  async function stopRecording() {
    timerRef.current && clearInterval(timerRef.current);
    const recording = recordingRef.current;
    if (!recording) return;
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    const status = await recording.getStatusAsync();
    const dur = Math.round(((status as any).durationMillis ?? elapsedSeconds * 1000) / 1000);
    recordingRef.current = null;
    setRecordedUri(uri ?? null);
    setRecordedDuration(dur);
    setPlaybackMillis(0);
    setDurationMillis(dur * 1000);
    setIsPlaying(false);
    soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    setState("reviewing");
  }

  async function togglePlayback() {
    if (!recordedUri) return;
    if (isPlaying) {
      await soundRef.current?.pauseAsync();
      setIsPlaying(false);
      return;
    }
    if (!soundRef.current) {
      const { sound } = await Audio.Sound.createAsync(
        { uri: recordedUri },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) return;
          setPlaybackMillis(status.positionMillis ?? 0);
          if (status.durationMillis) setDurationMillis(status.durationMillis);
          if (status.didJustFinish) {
            setIsPlaying(false);
            setPlaybackMillis(0);
          }
        }
      );
      soundRef.current = sound;
    } else {
      await soundRef.current.replayAsync();
    }
    setIsPlaying(true);
  }

  async function handleReRecord() {
    await soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    setRecordedUri(null);
    setIsPlaying(false);
    setState("ready");
    await startRecording();
  }

  async function handleSubmit() {
    if (!recordedUri) return;
    setState("uploading");
    await onSubmit(recordedUri, recordedDuration);
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  const progressPct = durationMillis > 0 ? playbackMillis / durationMillis : 0;

  if (state === "idle" || state === "requesting") {
    return (
      <TouchableOpacity
        style={[styles.startBtn, (disabled || state === "requesting") && styles.btnDisabled]}
        onPress={startRecording}
        disabled={disabled || state === "requesting"}
        activeOpacity={0.8}
      >
        {state === "requesting" ? (
          <ActivityIndicator color={colors.accentGreen} size="small" />
        ) : (
          <>
            <Ionicons name="mic" size={18} color={colors.accentGreen} />
            <Text style={styles.startBtnText}>Record Audio</Text>
          </>
        )}
      </TouchableOpacity>
    );
  }

  if (state === "recording") {
    return (
      <View style={styles.recordingBox}>
        <View style={styles.recordingPulse}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingTimer}>{formatTime(elapsedSeconds)}</Text>
        </View>
        <TouchableOpacity style={styles.stopBtn} onPress={stopRecording} activeOpacity={0.8}>
          <Ionicons name="stop" size={20} color={colors.cream} />
          <Text style={styles.stopBtnText}>Stop</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (state === "reviewing") {
    return (
      <View style={styles.reviewBox}>
        <View style={styles.reviewHeader}>
          <Ionicons name="mic" size={14} color={colors.accentGreen} />
          <Text style={styles.reviewDuration}>{formatTime(recordedDuration)} recorded</Text>
        </View>

        <View style={styles.progressRow}>
          <TouchableOpacity onPress={togglePlayback} style={styles.playBtn} activeOpacity={0.8}>
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={20}
              color={colors.cream}
            />
          </TouchableOpacity>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct * 100}%` }]} />
          </View>
          <Text style={styles.progressTime}>{formatTime(Math.round(playbackMillis / 1000))}</Text>
        </View>

        <View style={styles.reviewActions}>
          <TouchableOpacity style={styles.reRecordBtn} onPress={handleReRecord} activeOpacity={0.8}>
            <Ionicons name="refresh" size={14} color={colors.textMid} />
            <Text style={styles.reRecordText}>Re-record</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.useBtn} onPress={handleSubmit} activeOpacity={0.8}>
            <Ionicons name="checkmark" size={14} color={colors.cream} />
            <Text style={styles.useText}>Use Recording</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (state === "uploading") {
    return (
      <View style={styles.uploadingBox}>
        <ActivityIndicator color={colors.accentGreen} />
        <Text style={styles.uploadingText}>Uploading audio…</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  startBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 12,
    borderStyle: "dashed", paddingVertical: 14, paddingHorizontal: 16,
  },
  btnDisabled: { opacity: 0.5 },
  startBtnText: { fontSize: 14, fontWeight: "600", color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },

  recordingBox: {
    borderRadius: 12, borderWidth: 1, borderColor: "#C0392B33",
    backgroundColor: "#C0392B08", padding: 14, gap: 12,
  },
  recordingPulse: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center" },
  recordingDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: "#C0392B",
  },
  recordingTimer: { fontSize: 22, fontWeight: "700", color: "#C0392B", fontFamily: "Inter_700Bold" },
  stopBtn: {
    flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    backgroundColor: "#C0392B", borderRadius: 10, paddingVertical: 10,
  },
  stopBtnText: { color: colors.cream, fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  reviewBox: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige,
    backgroundColor: colors.cardBeige, padding: 14, gap: 10,
  },
  reviewHeader: { flexDirection: "row", gap: 6, alignItems: "center" },
  reviewDuration: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },

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

  reviewActions: { flexDirection: "row", gap: 8, marginTop: 2 },
  reRecordBtn: {
    flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingVertical: 9,
    backgroundColor: colors.card,
  },
  reRecordText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  useBtn: {
    flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primaryGreen, borderRadius: 10, paddingVertical: 9,
  },
  useText: { fontSize: 13, color: colors.cream, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  uploadingBox: {
    flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center",
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige,
  },
  uploadingText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
});
