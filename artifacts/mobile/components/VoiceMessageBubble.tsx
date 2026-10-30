import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, type LayoutChangeEvent } from "react-native";
import { createAudioPlayer } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";
import {
  createVoiceController, formatClock, onSessionRateChange, sessionRate, speedLabel, timeAtX,
  SKIP_SECONDS, type VoicePlayerLike, type VoiceState,
} from "@/lib/voicePlayback";
import { AppButton, IconButton } from "@/components/ui";

interface Props {
  mediaUrl: string;
  durationSeconds: number | null;
  mine?: boolean;
}

// Recorded voice message: play/pause, a seek bar you can tap or drag, skip
// back/forward, current/total time, and playback speed (shared across voice
// messages for the listening session, with a one-tap return to 1×). Every
// control drives the real expo-audio player through lib/voicePlayback.ts.
//
// The voice-messages bucket is public (migration 070), so this plays
// mediaUrl directly. The player is still created lazily on first use — a
// chat can show many of these at once. Audio mode / Agora are not touched.
export function VoiceMessageBubble({ mediaUrl, durationSeconds, mine }: Props) {
  const [state, setState] = useState<VoiceState>({
    phase: "idle", position: 0, duration: durationSeconds && durationSeconds > 0 ? durationSeconds : 0, rate: sessionRate(), buffering: false,
  });
  const controller = useMemo(() => createVoiceController({
    uri: mediaUrl,
    initialDuration: durationSeconds,
    createPlayer: (uri) => createAudioPlayer({ uri }) as unknown as VoicePlayerLike,
    onChange: setState,
  }), [mediaUrl, durationSeconds]);

  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => onSessionRateChange(() => controller.syncRate()), [controller]);

  // Seek bar: tap anywhere or drag the playhead; the audio seeks on release.
  const width = useRef(0);
  const grantX = useRef(0);
  const lastX = useRef(0);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      grantX.current = e.nativeEvent.locationX;
      lastX.current = grantX.current;
      controller.beginScrub();
      controller.previewScrub(timeAtX(lastX.current, width.current, controller.state.duration));
    },
    onPanResponderMove: (_e, g) => {
      lastX.current = grantX.current + g.dx;
      controller.previewScrub(timeAtX(lastX.current, width.current, controller.state.duration));
    },
    onPanResponderRelease: () => controller.endScrub(timeAtX(lastX.current, width.current, controller.state.duration)),
    onPanResponderTerminate: () => controller.endScrub(timeAtX(lastX.current, width.current, controller.state.duration)),
  }), [controller]);

  const { phase, position, duration, rate } = state;
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;
  const active = phase !== "idle";
  const tint = mine ? "#fff" : colors.accentGreen;
  const muted = mine ? "rgba(255,255,255,0.85)" : colors.textMuted;
  // "loading" only ever means the user pressed play and the file is still loading.
  const playing = phase === "playing" || phase === "loading";

  if (phase === "error") {
    return (
      <View style={styles.row}>
        <Ionicons name="alert-circle-outline" size={18} color={muted} />
        <Text style={[styles.errorText, { color: muted }]}>Voice message unavailable</Text>
        <IconButton icon="refresh" accessibilityLabel="Try playing again" onPress={() => controller.retry()} color={tint} palette="fixedLight" />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TouchableOpacity hitSlop={10}
          style={[styles.playBtn, mine ? styles.playBtnMine : styles.playBtnTheirs]}
          onPress={() => controller.toggle()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause voice message" : phase === "ended" ? "Replay voice message" : "Play voice message"}
        >
          <Ionicons name={playing ? "pause" : phase === "ended" ? "refresh" : "play"} size={16} color={mine ? colors.accentGreen : "#fff"} />
        </TouchableOpacity>

        <View
          style={styles.seekArea}
          onLayout={(e: LayoutChangeEvent) => { width.current = e.nativeEvent.layout.width; }}
          {...pan.panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Voice message position"
          accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(position), text: `${formatClock(position)} of ${formatClock(duration)}` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => controller.skip(e.nativeEvent.actionName === "increment" ? SKIP_SECONDS : -SKIP_SECONDS)}
        >
          <View style={[styles.track, mine && styles.trackMine]}>
            <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: tint }]} />
          </View>
          <View pointerEvents="none" style={[styles.thumb, { left: `${progress * 100}%`, backgroundColor: tint }]} />
        </View>

        <Text style={[styles.time, { color: muted }]}>
          {active ? `${formatClock(position)} / ${formatClock(duration)}` : formatClock(duration)}
        </Text>
      </View>

      {active ? (
        <View style={styles.controls}>
          <AppButton label={`${SKIP_SECONDS}`} onPress={() => controller.skip(-SKIP_SECONDS)} variant="tertiary" icon="play-back" accessibilityLabel={`Back ${SKIP_SECONDS} seconds`} style={{ minWidth: 44 }} palette="fixedLight" />
          <AppButton label={`${SKIP_SECONDS}`} onPress={() => controller.skip(SKIP_SECONDS)} variant="tertiary" icon="play-forward" iconPosition="trailing" accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`} style={{ minWidth: 44 }} palette="fixedLight" />
          <TouchableOpacity
            style={[styles.speedChip, { borderColor: tint }]} onPress={() => controller.cycleRate()} onLongPress={() => controller.resetRate()}
            accessibilityRole="button" accessibilityLabel={`Playback speed ${speedLabel(rate)}. Tap to change`} accessibilityHint="Long press to return to normal speed"
          >
            <Text style={[styles.speedText, { color: tint }]}>{speedLabel(rate)}</Text>
          </TouchableOpacity>
          {rate !== 1 ? (
            <AppButton label="1×" onPress={() => controller.resetRate()} variant="tertiary" accessibilityLabel="Normal speed" style={{ minWidth: 44 }} palette="fixedLight" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default VoiceMessageBubble;

const styles = StyleSheet.create({
  playBtnMine: { backgroundColor: "rgba(255,255,255,0.9)" },
  wrap: { minWidth: 200, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  playBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  playBtnTheirs: { backgroundColor: colors.accentGreen },
  seekArea: { flex: 1, height: 44, justifyContent: "center" },
  track: { height: 4, backgroundColor: "rgba(0,0,0,0.15)", borderRadius: 2, overflow: "hidden" },
  trackMine: { backgroundColor: "rgba(255,255,255,0.35)" },
  fill: { height: "100%", borderRadius: 2 },
  thumb: { position: "absolute", width: 12, height: 12, borderRadius: 6, marginLeft: -6, top: 16 },
  time: { fontSize: 11, fontFamily: "Inter_400Regular", minWidth: 34, textAlign: "right" },
  controls: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 40 },
  skipText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  speedChip: { minWidth: 44, minHeight: 32, paddingHorizontal: 8, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center", marginVertical: 6 },
  speedText: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  resetText: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
});
