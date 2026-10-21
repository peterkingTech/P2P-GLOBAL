import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { rotatedPlayerLength } from "@/lib/mediaRotation";
import { Ionicons } from "@expo/vector-icons";
import SyncedMediaPlayer from "./SyncedMediaPlayer";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import type { WorshipSession } from "@/lib/familyApi";

interface Props {
  session: WorshipSession;
  mediaVolume: number;
  resyncNonce: number;
  onDriftStatus: (behind: boolean) => void;
  onEnded: () => void;
  isBehind: boolean;
  onReturnToLive: () => void;
  canControl: boolean;
  urlInput: string;
  onChangeUrlInput: (v: string) => void;
  onSetMedia: () => void;
  onTogglePlay: () => void;
  /** Full-screen landscape: the same player turned 90° (never remounted). */
  rotated?: boolean;
}

// The Gathering's shared content surface — the player plus its Guide
// controls as one unit, used the same way from Worship mode and
// Teaching mode rather than each screen re-assembling it separately.
export default function SharedMedia({
  session, mediaVolume, resyncNonce, onDriftStatus, onEnded, isBehind, onReturnToLive,
  canControl, urlInput, onChangeUrlInput, onSetMedia, onTogglePlay, rotated = false,
}: Props) {
  const { width, height } = useWindowDimensions();
  const length = rotatedPlayerLength(width, height);
  // The two wrapper Views are ALWAYS rendered (only their styles change), so
  // rotating never remounts the player: playback, position and sync stay.
  return (
    <View>
      <View style={rotated ? { height: length, alignItems: "center", justifyContent: "center" } : undefined}>
       <View style={rotated ? { width: length, transform: [{ rotate: "90deg" }] } : undefined}>
        <SyncedMediaPlayer session={session} mediaVolume={mediaVolume} resyncNonce={resyncNonce} onDriftStatus={onDriftStatus} onEnded={onEnded} />
        {isBehind && (
          <TouchableOpacity style={styles.returnToLiveBadge} onPress={onReturnToLive} accessibilityRole="button" accessibilityLabel="Return to live playback">
            <Ionicons name="refresh" size={12} color={colors.textPrimary} />
            <Text style={styles.returnToLiveText}>Return to Live</Text>
          </TouchableOpacity>
        )}
       </View>
      </View>
      {canControl && !rotated && (
        <View style={styles.controlRow}>
          <TouchableOpacity
            style={styles.playBtn} onPress={onTogglePlay}
            accessibilityRole="button" accessibilityLabel={session.isPlaying ? "Pause Media" : "Play Media"}
          >
            <Ionicons name={session.isPlaying ? "pause" : "play"} size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Paste a YouTube link…"
            placeholderTextColor={colors.textFaint}
            value={urlInput}
            onChangeText={onChangeUrlInput}
            autoCapitalize="none"
            accessibilityLabel="YouTube link for Media"
          />
          <TouchableOpacity style={styles.setBtn} onPress={onSetMedia} accessibilityRole="button" accessibilityLabel="Set Media">
            <Text style={styles.setBtnText}>Set</Text>
          </TouchableOpacity>
        </View>
      )}
      {rotated ? <StatusBar hidden /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  returnToLiveBadge: {
    position: "absolute", bottom: 10, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.8)", borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 7, borderWidth: 1, borderColor: colors.connection,
  },
  returnToLiveText: { color: colors.textPrimary, ...type.caption, fontFamily: "Inter_700Bold" },
  controlRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  playBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: MIN_TOUCH_TARGET / 2, backgroundColor: colors.growth, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: MIN_TOUCH_TARGET, color: colors.textPrimary, ...type.body },
  setBtn: { backgroundColor: colors.growth, borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: MIN_TOUCH_TARGET, justifyContent: "center", alignItems: "center" },
  setBtnText: { color: colors.textPrimary, ...type.bodyEmph },
});
