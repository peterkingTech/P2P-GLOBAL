import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ConnectionHealth from "./ConnectionHealth";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import type { VoicePhase } from "@/hooks/useVoiceSpace";

interface Props {
  phase: VoicePhase;
  error: string | null;
  onJoin: () => void;
  onRetry: () => void;
  onLeave: () => void;
  micMuted: boolean;
  onToggleMic: () => void;
  listening: boolean;
  onToggleListening: () => void;
}

// Together's Voice Space presence surface — join/leave, mic, listening,
// and a plain-language connection state. Previously mixed into the audio
// mixer panel; split out so each P2P Together component has one job.
export default function VoiceSpace({ phase, error, onJoin, onRetry, onLeave, micMuted, onToggleMic, listening, onToggleListening }: Props) {
  return (
    <View>
      <Text style={styles.sectionLabel}>VOICE SPACE</Text>

      {phase === "idle" && (
        <TouchableOpacity style={styles.joinBtn} onPress={onJoin} accessibilityRole="button" accessibilityLabel="Join Voice Space">
          <Text style={styles.joinIcon}>🎙️</Text>
          <Text style={styles.joinText}>Join Voice Space</Text>
        </TouchableOpacity>
      )}

      {phase === "connecting" && (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.connection} size="small" />
          <ConnectionHealth phase={phase} />
        </View>
      )}

      {phase === "failed" && (
        <View style={styles.failBox}>
          <Text style={styles.failText}>{error ?? "Unable to connect to Voice Space"}</Text>
          <View style={styles.failBtnRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onLeave} accessibilityRole="button" accessibilityLabel="Leave Together">
              <Text style={styles.secondaryBtnText}>Leave Together</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry connecting to Voice Space">
              <Text style={styles.primaryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {phase === "connected" && (
        <View>
          <View style={styles.connectedHeaderRow}>
            <ConnectionHealth phase={phase} />
          </View>
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.iconBtn, micMuted && styles.iconBtnActive]}
              onPress={onToggleMic}
              accessibilityRole="button"
              accessibilityLabel={micMuted ? "Unmute microphone" : "Mute microphone"}
              accessibilityState={{ selected: micMuted }}
            >
              <Ionicons name={micMuted ? "mic-off" : "mic"} size={16} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, !listening && styles.iconBtnActive]}
              onPress={onToggleListening}
              accessibilityRole="button"
              accessibilityLabel={listening ? "Stop listening to Voice Space" : "Resume listening to Voice Space"}
              accessibilityState={{ selected: !listening }}
            >
              <Ionicons name={listening ? "ear" : "ear-outline"} size={16} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtnSmall} onPress={onLeave} accessibilityRole="button" accessibilityLabel="Leave Voice Space">
              <Text style={styles.secondaryBtnText}>Leave Voice Space</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { color: colors.textTertiary, ...type.label, marginBottom: spacing.sm },

  joinBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.connectionSoft, borderRadius: radii.lg, minHeight: MIN_TOUCH_TARGET, paddingVertical: spacing.md,
  },
  joinIcon: { fontSize: 15 },
  joinText: { color: colors.textPrimary, ...type.bodyEmph },

  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },

  failBox: { backgroundColor: colors.restSoft, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  failText: { color: colors.textPrimary, ...type.caption, lineHeight: 17 },
  failBtnRow: { flexDirection: "row", gap: spacing.sm },
  primaryBtn: { flex: 1, backgroundColor: colors.connection, borderRadius: radii.md, minHeight: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: colors.textPrimary, ...type.bodyEmph },
  secondaryBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, minHeight: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
  secondaryBtnSmall: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", marginLeft: "auto" },
  secondaryBtnText: { color: colors.textSecondary, ...type.bodyEmph },

  connectedHeaderRow: { marginBottom: spacing.sm },
  controlsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: MIN_TOUCH_TARGET / 2, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  iconBtnActive: { backgroundColor: colors.rest },
});
