import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  } from "react-native";
import { useMediaBox } from "@/hooks/useLayout";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";
import { formatClock } from "@/lib/timeFormat";

type RecorderState = "idle" | "requesting" | "cameraReady" | "recording" | "reviewing" | "uploading";

interface Props {
  onSubmit: (localUri: string, durationSeconds: number) => Promise<void>;
  disabled?: boolean;
}

export default function VideoRecorder({ onSubmit, disabled }: Props) {
  const mediaBox = useMediaBox(40, 9 / 16);
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Must be called unconditionally (hook rules) even though this component
  // has several early `if (state === ...) return` branches above where the
  // review preview renders — recreates automatically once recordedUri is set
  // (useVideoPlayer keys its memoized player on the source).
  const reviewPlayer = useVideoPlayer(recordedUri ? { uri: recordedUri } : null);

  useEffect(() => {
    return () => {
      timerRef.current && clearInterval(timerRef.current);
    };
  }, []);

  async function handleOpenCamera() {
    setState("requesting");
    if (!cameraPermission?.granted) await requestCameraPermission();
    if (!micPermission?.granted) await requestMicPermission();
    setState("cameraReady");
  }

  async function startRecording() {
    if (!cameraRef.current) return;
    setElapsedSeconds(0);
    setState("recording");
    timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: 300 });
      timerRef.current && clearInterval(timerRef.current);
      if (result?.uri) {
        setRecordedUri(result.uri);
        setRecordedDuration(elapsedSeconds || 1);
        setState("reviewing");
      } else {
        setState("cameraReady");
      }
    } catch {
      timerRef.current && clearInterval(timerRef.current);
      setState("cameraReady");
    }
  }

  async function stopRecording() {
    timerRef.current && clearInterval(timerRef.current);
    setRecordedDuration(elapsedSeconds || 1);
    cameraRef.current?.stopRecording();
    // state transitions to "reviewing" inside startRecording's result handler
  }

  function handleReRecord() {
    setRecordedUri(null);
    setState("cameraReady");
  }

  async function handleSubmit() {
    if (!recordedUri) return;
    setState("uploading");
    await onSubmit(recordedUri, recordedDuration);
  }


  if (state === "idle" || state === "requesting") {
    return (
      <AppButton label="Record Video" onPress={handleOpenCamera} variant="outline" icon="videocam" disabled={disabled || state === "requesting"} loading={state === "requesting"} palette="fixedLight" />
    );
  }

  if (state === "cameraReady" || state === "recording") {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={[styles.camera, mediaBox]}
          facing="front"
          mode="video"
        />
        {state === "recording" && (
          <View style={styles.recordingOverlay}>
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTimer}>{formatClock(elapsedSeconds, { padded: true })}</Text>
            </View>
          </View>
        )}
        <View style={styles.cameraControls}>
          {state === "cameraReady" ? (
            <TouchableOpacity accessibilityRole="button" style={styles.recordBtn} onPress={startRecording} activeOpacity={0.8}>
              <View style={styles.recordBtnInner} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity accessibilityRole="button" style={styles.stopCameraBtn} onPress={stopRecording} activeOpacity={0.8}>
              <View style={styles.stopCameraBtnInner} />
            </TouchableOpacity>
          )}
        </View>
        {state === "cameraReady" && (
          <AppButton label="Cancel" variant="secondary" onPress={() => setState("idle")} palette="fixedLight" />
        )}
      </View>
    );
  }

  if (state === "reviewing") {
    return (
      <View style={styles.reviewBox}>
        <View style={styles.reviewHeader}>
          <Ionicons name="videocam" size={14} color={colors.accentGreen} />
          <Text style={styles.reviewDuration}>{formatClock(recordedDuration, { padded: true })} recorded</Text>
        </View>
        {recordedUri && (
          <VideoView
            player={reviewPlayer}
            style={[styles.videoPreview, mediaBox]}
            nativeControls
            contentFit="contain"
          />
        )}
        <View style={styles.reviewActions}>
          <AppButton label="Re-record" onPress={handleReRecord} variant="secondary" icon="refresh" style={{ flex: 1 }} palette="fixedLight" />
          <AppButton label="Use Video" onPress={handleSubmit} icon="checkmark" style={{ flex: 1 }} palette="fixedLight" />
        </View>
      </View>
    );
  }

  if (state === "uploading") {
    return (
      <View style={styles.uploadingBox}>
        <ActivityIndicator color={colors.accentGreen} />
        <Text style={styles.uploadingText}>Uploading video…</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({

  cameraContainer: { borderRadius: 12, overflow: "hidden", gap: 0 },
  camera: { width: "100%", borderRadius: 12 },

  recordingOverlay: {
    position: "absolute", top: 12, left: 12, right: 12,
    flexDirection: "row", alignItems: "center",
  },
  recordingBadge: {
    flexDirection: "row", gap: 6, alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E74C3C" },
  recordingTimer: { fontSize: 13, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  cameraControls: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    paddingVertical: 16, backgroundColor: colors.textDark,
  },
  recordBtn: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 4, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  recordBtnInner: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: "#E74C3C",
  },
  stopCameraBtn: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 4, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  stopCameraBtnInner: {
    width: 28, height: 28, borderRadius: 4, backgroundColor: "#fff",
  },
  cancelText: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },

  reviewBox: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige,
    backgroundColor: colors.cardBeige, padding: 14, gap: 10, overflow: "hidden",
  },
  reviewHeader: { flexDirection: "row", gap: 6, alignItems: "center" },
  reviewDuration: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  videoPreview: { width: "100%", borderRadius: 8, backgroundColor: colors.textDark },

  reviewActions: { flexDirection: "row", gap: 8, marginTop: 2 },
  reRecordText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  useText: { fontSize: 13, color: colors.cream, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  uploadingBox: {
    flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center",
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige,
  },
  uploadingText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
});
