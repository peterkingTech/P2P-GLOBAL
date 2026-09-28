import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";

type Phase = "idle" | "recording" | "cancelling" | "locked" | "uploading";

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
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // One persistent recorder instance for the component's whole lifetime,
  // reused across every press/record/stop cycle — this is a real
  // architectural difference from expo-av, which created a brand-new
  // Audio.Recording object per take. useAudioRecorder is a hook and must be
  // called unconditionally; that's already satisfied here since this
  // component has no early returns before its main render.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Polled reactive state (elapsed duration, isRecording) for the UI timer —
  // replaces the manual 1s setInterval the expo-av version needed, since
  // expo-av's Recording object had no built-in reactive status hook.
  const recorderState = useAudioRecorderState(recorder, 1000);

  // True from the moment a take starts until it's stopped (sent or
  // discarded) — replaces the old `recordingRef.current !== null` check
  // now that there's no per-take object to null out.
  const activeRef = useRef(false);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  // UI-thread latches the gesture worklet reads/writes directly. `lockedSV`
  // is a one-way latch (WhatsApp never un-locks on the way back down);
  // `cancellingSV` is reversible while the finger is still down (dragging
  // back out of the cancel zone un-cancels it). Both are read straight off
  // the shared value inside onEnd/onFinalize's own worklet body, so the
  // send/lock/cancel decision always sees the value as of the instant the
  // finger lifted — no cross-thread staleness, no dependency on whether
  // React has re-rendered with the latest `phase` yet.
  const lockedSV = useSharedValue(false);
  const cancellingSV = useSharedValue(false);
  const startingRef = useRef(false);

  useEffect(() => {
    onActiveChange?.(phase === "recording" || phase === "cancelling" || phase === "locked");
  }, [phase, onActiveChange]);

  useEffect(() => {
    return () => {
      // useAudioRecorder disposes the recorder object automatically on
      // unmount, but that's just releasing the object — it doesn't by
      // itself halt an in-progress recording, so still explicitly stop one
      // if the component unmounts mid-take (matches the original's unmount
      // cleanup).
      if (activeRef.current) recorder.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function beginRecording() {
    if (startingRef.current || activeRef.current) return;
    startingRef.current = true;
    setErrorText(null);
    setPermissionDenied(false);
    lockedSV.value = false;
    cancellingSV.value = false;
    dragX.value = 0;
    dragY.value = 0;
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setPermissionDenied(true);
        startingRef.current = false;
        return;
      }
      // expo-audio field names differ from expo-av's AudioMode:
      // allowsRecording (was allowsRecordingIOS), playsInSilentMode (was
      // playsInSilentModeIOS).
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      activeRef.current = true;
      setPhase("recording");
    } catch {
      setErrorText("Couldn't start recording. Please try again.");
    } finally {
      startingRef.current = false;
    }
  }

  async function discardRecording() {
    activeRef.current = false;
    if (recorder.isRecording) {
      await recorder.stop().catch(() => {});
    }
    lockedSV.value = false;
    cancellingSV.value = false;
    setPhase("idle");
  }

  async function finishAndSend() {
    if (!activeRef.current) {
      setPhase("idle");
      return;
    }
    activeRef.current = false;
    lockedSV.value = false;
    cancellingSV.value = false;
    // Read directly off the live recorder rather than the polled
    // recorderState — avoids up-to-1s staleness from the 1000ms poll
    // interval for both the minimum-duration gate and the submitted
    // duration.
    const finalSeconds = recorder.currentTime;
    if (finalSeconds < MIN_SEND_SECONDS) {
      await recorder.stop().catch(() => {});
      setPhase("idle");
      return;
    }
    setPhase("uploading");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const dur = Math.round(finalSeconds);
      if (uri) await onSubmit(uri, dur);
    } catch (e: any) {
      setErrorText(e?.message ?? "Voice message not sent. Please try again.");
    } finally {
      setPhase("idle");
    }
  }

  // Called from the gesture worklet the instant the vertical threshold is
  // crossed — a one-way transition, mirrored below by lockedSV itself never
  // resetting until the next recording starts.
  function handleLockDetected() {
    setPhase("locked");
  }

  // Called from the gesture worklet whenever the cancel-zone membership
  // actually changes (not on every move frame) — reversible in both
  // directions while the finger is still down.
  function setCancellingUI(active: boolean) {
    setPhase(active ? "cancelling" : "recording");
  }

  // Registered on BOTH onEnd (normal release) and onFinalize (fires after
  // onEnd, or instead of it if the OS/another handler interrupts the
  // gesture) so cleanup happens for every way a touch can end — but the
  // decision itself only takes effect once: finishAndSend/discardRecording
  // both clear activeRef synchronously as their first statement, so the
  // guard below makes the second call (whichever handler fires last) a
  // true no-op instead of a duplicate send/discard.
  function handleGestureFinished(locked: boolean, cancelling: boolean) {
    if (locked) return; // recording continues hands-free; Send/Cancel take over
    if (!activeRef.current) return; // already resolved, or never started (denied/failed)
    if (cancelling) void discardRecording();
    else void finishAndSend();
  }

  // Rebuilt each render (cheap — closures over primitives/refs) so it never
  // captures a stale `onSubmit`/`disabled`; the gesture object itself is
  // handed to the SAME GestureDetector instance below every render, so
  // React reconciles it as a config update rather than a remount.
  const panGesture = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      runOnJS(beginRecording)();
    })
    .onUpdate((e) => {
      if (lockedSV.value) return;
      dragX.value = Math.min(0, e.translationX);
      dragY.value = Math.min(0, e.translationY);
      // Dominant-axis gate: a mostly-vertical drag can never also register
      // as a cancel, and vice versa, so the two zones can't be triggered
      // by the same ambiguous diagonal movement.
      const verticalDominant = -dragY.value > -dragX.value;
      if (verticalDominant && -dragY.value > LOCK_DISTANCE) {
        lockedSV.value = true;
        cancellingSV.value = false;
        runOnJS(handleLockDetected)();
        return;
      }
      const nowCancelling = !verticalDominant && -dragX.value > CANCEL_DISTANCE;
      if (nowCancelling !== cancellingSV.value) {
        cancellingSV.value = nowCancelling;
        runOnJS(setCancellingUI)(nowCancelling);
      }
    })
    .onEnd(() => {
      runOnJS(handleGestureFinished)(lockedSV.value, cancellingSV.value);
    })
    .onFinalize(() => {
      runOnJS(handleGestureFinished)(lockedSV.value, cancellingSV.value);
    });

  const slideHintStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dragX.value }] }));
  const lockHintStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }] }));

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  // Forensic voice-recording audit, round 2 — the previous fix (a single
  // persistent root carrying the gesture across idle -> recording) was
  // necessary but not sufficient. The remaining bug: the idle-phase
  // microphone was a real `TouchableOpacity`, and RN's Touchable components
  // participate in the same legacy responder-negotiation system that
  // PanResponder used — a child Touchable can win/hold the responder ahead
  // of the parent's PanResponder, which is exactly what made the gesture
  // register a tap (onPanResponderGrant still fired) but silently drop the
  // follow-through slide-up movement on real devices. Fixed by switching to
  // react-native-gesture-handler's Gesture.Pan (already a project
  // dependency, already used for swipe-to-reply on this same screen), which
  // runs on its own native recognizer instead of the legacy responder
  // system, and by replacing the idle-phase Touchable with a plain View so
  // there is no second responder candidate to compete with it at all. The
  // GestureDetector wraps one persistent inner View spanning idle ->
  // recording -> cancelling -> locked (never remounted, for the same reason
  // as before), while the locked-phase Send/Cancel buttons are rendered as
  // separate sibling elements outside the GestureDetector entirely — by the
  // time locked-phase UI is interactive the original touch has normally
  // already lifted, and keeping those buttons outside the gesture's own
  // subtree guarantees a fresh tap on them is never contended by the pan
  // recognizer.
  return (
    <View style={phase === "idle" ? styles.idleWrap : styles.activeWrap}>
      <GestureDetector gesture={panGesture}>
        <View style={phase === "idle" ? undefined : styles.gestureFill}>
          {phase === "idle" && (
            <>
              <View style={[styles.micBtn, disabled && styles.btnDisabled]}>
                <Ionicons name="mic" size={18} color="#fff" />
              </View>
              {permissionDenied && <Text style={styles.errorText}>Microphone permission denied.</Text>}
              {errorText && <Text style={styles.errorText}>{errorText}</Text>}
            </>
          )}

          {(phase === "recording" || phase === "cancelling") && (
            <View style={[styles.activeBar, phase === "cancelling" && styles.activeBarCancelling]}>
              <View style={styles.activeLeft}>
                <View style={styles.recDot} />
                <Text style={styles.activeTimer}>{formatTime(Math.floor(recorderState.durationMillis / 1000))}</Text>
                <Animated.Text
                  style={[styles.slideHint, phase === "cancelling" && styles.slideHintCancelling, slideHintStyle]}
                >
                  {phase === "cancelling" ? "Release to cancel" : "◁ Slide to cancel"}
                </Animated.Text>
              </View>
              {phase === "recording" && (
                <Animated.View style={[styles.lockHint, lockHintStyle]}>
                  <Ionicons name="chevron-up" size={14} color={colors.textMuted} />
                  <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
                </Animated.View>
              )}
            </View>
          )}
        </View>
      </GestureDetector>

      {phase === "locked" && (
        <View style={styles.activeBar}>
          <View style={styles.activeLeft}>
            <View style={styles.recDot} />
            <Text style={styles.activeTimer}>{formatTime(Math.floor(recorderState.durationMillis / 1000))}</Text>
          </View>
          <View style={styles.lockedActions}>
            <TouchableOpacity onPress={discardRecording} style={styles.lockedCancelBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="trash-outline" size={18} color="#C0392B" />
            </TouchableOpacity>
            <TouchableOpacity onPress={finishAndSend} style={styles.lockedSendBtn}>
              <Ionicons name="send" size={16} color={colors.cream} />
            </TouchableOpacity>
          </View>
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
  gestureFill: { flex: 1 },

  activeBar: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 12, borderWidth: 1, borderColor: "#C0392B33",
    backgroundColor: "#C0392B08", paddingHorizontal: 14, paddingVertical: 10, minHeight: 40,
  },
  activeBarCancelling: { borderColor: "#C0392B99", backgroundColor: "#C0392B1A" },
  activeLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#C0392B" },
  activeTimer: { fontSize: 15, fontWeight: "700", color: "#C0392B", fontFamily: "Inter_700Bold" },
  slideHint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  slideHintCancelling: { color: "#C0392B", fontWeight: "700", fontFamily: "Inter_700Bold" },
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
