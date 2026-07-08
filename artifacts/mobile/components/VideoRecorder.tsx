import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { Video, ResizeMode } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";

type RecorderState = "idle" | "requesting" | "cameraReady" | "recording" | "reviewing" | "uploading";

interface Props {
  onSubmit: (localUri: string, durationSeconds: number) => Promise<void>;
  disabled?: boolean;
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const PREVIEW_HEIGHT = Math.round((SCREEN_WIDTH - 40) * (9 / 16));

export default function VideoRecorder({ onSubmit, disabled }: Props) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  if (state === "idle" || state === "requesting") {
    return (
      <TouchableOpacity
        style={[styles.startBtn, (disabled || state === "requesting") && styles.btnDisabled]}
        onPress={handleOpenCamera}
        disabled={disabled || state === "requesting"}
        activeOpacity={0.8}
      >
        {state === "requesting" ? (
          <ActivityIndicator color={colors.accentGreen} size="small" />
        ) : (
          <>
            <Ionicons name="videocam" size={18} color={colors.accentGreen} />
            <Text style={styles.startBtnText}>Record Video</Text>
          </>
        )}
      </TouchableOpacity>
    );
  }

  if (state === "cameraReady" || state === "recording") {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={[styles.camera, { height: PREVIEW_HEIGHT }]}
          facing="front"
          mode="video"
        />
        {state === "recording" && (
          <View style={styles.recordingOverlay}>
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTimer}>{formatTime(elapsedSeconds)}</Text>
            </View>
          </View>
        )}
        <View style={styles.cameraControls}>
          {state === "cameraReady" ? (
            <TouchableOpacity style={styles.recordBtn} onPress={startRecording} activeOpacity={0.8}>
              <View style={styles.recordBtnInner} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.stopCameraBtn} onPress={stopRecording} activeOpacity={0.8}>
              <View style={styles.stopCameraBtnInner} />
            </TouchableOpacity>
          )}
        </View>
        {state === "cameraReady" && (
          <TouchableOpacity style={styles.cancelCameraBtn} onPress={() => setState("idle")}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (state === "reviewing") {
    return (
      <View style={styles.reviewBox}>
        <View style={styles.reviewHeader}>
          <Ionicons name="videocam" size={14} color={colors.accentGreen} />
          <Text style={styles.reviewDuration}>{formatTime(recordedDuration)} recorded</Text>
        </View>
        {recordedUri && (
          <Video
            source={{ uri: recordedUri }}
            style={[styles.videoPreview, { height: PREVIEW_HEIGHT }]}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
          />
        )}
        <View style={styles.reviewActions}>
          <TouchableOpacity style={styles.reRecordBtn} onPress={handleReRecord} activeOpacity={0.8}>
            <Ionicons name="refresh" size={14} color={colors.textMid} />
            <Text style={styles.reRecordText}>Re-record</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.useBtn} onPress={handleSubmit} activeOpacity={0.8}>
            <Ionicons name="checkmark" size={14} color={colors.cream} />
            <Text style={styles.useText}>Use Video</Text>
          </TouchableOpacity>
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
  startBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 12,
    borderStyle: "dashed", paddingVertical: 14, paddingHorizontal: 16,
  },
  btnDisabled: { opacity: 0.5 },
  startBtnText: { fontSize: 14, fontWeight: "600", color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },

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
  cancelCameraBtn: {
    backgroundColor: colors.textDark, paddingBottom: 8, alignItems: "center",
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
