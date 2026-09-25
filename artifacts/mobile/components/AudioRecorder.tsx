import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
  Animated,
  ActivityIndicator,
} from "react-native";
import { Audio } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";

type Phase = "idle" | "recording" | "locked" | "uploading";

// WhatsApp/Instagram-style thresholds: drag up to lock (release the finger,
// keep recording), drag left to cancel. Tuned to be reachable with a short
// thumb movement without triggering accidentally on a plain tap-and-hold.
const LOCK_DISTANCE = 70;
const CANCEL_DISTANCE = 90;
// A release under this duration is treated as an accidental tap, not an
// intentional message — matches "no accidental message submission".
const MIN_SEND_SECONDS = 1;

interface Props {
  onSubmit: (localUri: string, durationSeconds: number) => Promise<void>;
  onActiveChange?: (active: boolean) => void;
  disabled?: boolean;
}

export default function AudioRecorder({ onSubmit, onActiveChange, disabled }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  // Latched flags, not state — must be readable synchronously inside the
  // same PanResponder move callback that sets them, before the next render.
  const lockedRef = useRef(false);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  const elapsedRef = useRef(0);

  useEffect(() => {
    elapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  useEffect(() => {
    onActiveChange?.(phase === "recording" || phase === "locked");
  }, [phase, onActiveChange]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function beginRecording() {
    if (startingRef.current || recordingRef.current) return;
    startingRef.current = true;
    setErrorText(null);
    setPermissionDenied(false);
    lockedRef.current = false;
    cancelledRef.current = false;
    dragX.setValue(0);
    dragY.setValue(0);
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        setPermissionDenied(true);
        startingRef.current = false;
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setElapsedSeconds(0);
      setPhase("recording");
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    } catch {
      setErrorText("Couldn't start recording. Please try again.");
    } finally {
      startingRef.current = false;
    }
  }

  async function discardRecording() {
    clearTimer();
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) {
      await recording.stopAndUnloadAsync().catch(() => {});
    }
    setPhase("idle");
    setElapsedSeconds(0);
  }

  async function finishAndSend() {
    clearTimer();
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) {
      setPhase("idle");
      return;
    }
    if (elapsedRef.current < MIN_SEND_SECONDS) {
      await recording.stopAndUnloadAsync().catch(() => {});
      setPhase("idle");
      setElapsedSeconds(0);
      return;
    }
    setPhase("uploading");
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const status = await recording.getStatusAsync();
      const dur = Math.round(((status as any).durationMillis ?? elapsedRef.current * 1000) / 1000);
      if (uri) await onSubmit(uri, dur);
    } catch (e: any) {
      setErrorText(e?.message ?? "Voice message not sent. Please try again.");
    } finally {
      setPhase("idle");
      setElapsedSeconds(0);
    }
  }

  // Recreated each render (cheap — a plain object of closures) rather than
  // memoized once, so these handlers always see the current phase/refs
  // instead of stale ones from whichever render first created it.
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => phase === "idle" && !disabled,
    onMoveShouldSetPanResponder: () => phase === "recording",
    onPanResponderGrant: () => {
      void beginRecording();
    },
    onPanResponderMove: (_evt, gesture) => {
      if (phase !== "recording" || lockedRef.current || cancelledRef.current) return;
      const dx = Math.min(0, gesture.dx);
      const dy = Math.min(0, gesture.dy);
      dragX.setValue(dx);
      dragY.setValue(dy);
      if (-dy > LOCK_DISTANCE) {
        lockedRef.current = true;
        setPhase("locked");
      } else if (-dx > CANCEL_DISTANCE) {
        cancelledRef.current = true;
        void discardRecording();
      }
    },
    onPanResponderRelease: () => {
      if (cancelledRef.current || lockedRef.current) return;
      if (phase === "recording") void finishAndSend();
    },
    onPanResponderTerminate: () => {
      if (!cancelledRef.current && !lockedRef.current && phase === "recording") void discardRecording();
    },
  });

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  // Forensic voice-recording audit — root cause of "slide-up gesture not
  // responding": this used to be three separate `return` statements with
  // structurally different JSX per phase, and panHandlers only lived on the
  // idle-phase TouchableOpacity. The instant beginRecording() set
  // phase="recording", React tore down that element and mounted a
  // different tree (the active bar) with no gesture handlers at all —
  // severing the native touch responder chain while the finger was still
  // down, so every subsequent slide-up move event had nothing to report
  // to. Fixed by keeping ONE persistent root element carrying
  // panHandlers across idle -> recording (the only window where the
  // finger can still be down while phase changes); only its inner content
  // switches. By the time phase reaches "locked"/"uploading" the finger
  // has already been released, so those states are safe to render as
  // plain content with their own separate tap targets.
  return (
    <View
      style={phase === "idle" ? styles.idleWrap : styles.activeWrap}
      {...panResponder.panHandlers}
    >
      {phase === "idle" && (
        <>
          <TouchableOpacity
            style={[styles.micBtn, disabled && styles.btnDisabled]}
            disabled={disabled}
            activeOpacity={0.85}
          >
            <Ionicons name="mic" size={18} color="#fff" />
          </TouchableOpacity>
          {permissionDenied && <Text style={styles.errorText}>Microphone permission denied.</Text>}
          {errorText && <Text style={styles.errorText}>{errorText}</Text>}
        </>
      )}

      {(phase === "recording" || phase === "locked") && (
        <View style={styles.activeBar}>
          <View style={styles.activeLeft}>
            <View style={styles.recDot} />
            <Text style={styles.activeTimer}>{formatTime(elapsedSeconds)}</Text>
            {phase === "recording" && (
              <Animated.Text style={[styles.slideHint, { transform: [{ translateX: dragX }] }]}>
                ◁ Slide to cancel
              </Animated.Text>
            )}
          </View>
          {phase === "recording" ? (
            <Animated.View style={[styles.lockHint, { transform: [{ translateY: dragY }] }]}>
              <Ionicons name="chevron-up" size={14} color={colors.textMuted} />
              <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
            </Animated.View>
          ) : (
            <View style={styles.lockedActions}>
              <TouchableOpacity onPress={discardRecording} style={styles.lockedCancelBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={18} color="#C0392B" />
              </TouchableOpacity>
              <TouchableOpacity onPress={finishAndSend} style={styles.lockedSendBtn}>
                <Ionicons name="send" size={16} color={colors.cream} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {phase === "uploading" && (
        <View style={styles.uploadingBox}>
          <ActivityIndicator color={colors.accentGreen} size="small" />
          <Text style={styles.uploadingText}>Uploading…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  idleWrap: { alignItems: "flex-end" },
  micBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primaryGreen,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled: { opacity: 0.5 },
  errorText: { fontSize: 11, color: "#C0392B", fontFamily: "Inter_400Regular", marginTop: 4, maxWidth: 140, textAlign: "right" },
  activeWrap: { flex: 1 },

  activeBar: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 12, borderWidth: 1, borderColor: "#C0392B33",
    backgroundColor: "#C0392B08", paddingHorizontal: 14, paddingVertical: 10, minHeight: 40,
  },
  activeLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#C0392B" },
  activeTimer: { fontSize: 15, fontWeight: "700", color: "#C0392B", fontFamily: "Inter_700Bold" },
  slideHint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  lockHint: { alignItems: "center" },
  lockedActions: { flexDirection: "row", gap: 10, alignItems: "center" },
  lockedCancelBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#C0392B33",
  },
  lockedSendBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primaryGreen,
  },

  uploadingBox: {
    flex: 1, flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center",
    padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, minHeight: 40,
  },
  uploadingText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
});
