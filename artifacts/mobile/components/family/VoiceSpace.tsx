import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ConnectionHealth from "./ConnectionHealth";
import FamilyIcon from "./FamilyIcon";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import type { VoicePhase } from "@/hooks/useVoiceSpace";
import { AppButton } from "@/components/ui";

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
      <Text style={styles.sectionLabel}>VOICE</Text>

      {phase === "idle" && (
        <TouchableOpacity style={styles.joinBtn} onPress={onJoin} accessibilityRole="button" accessibilityLabel="Join Voice">
          <FamilyIcon name="voice" size={20} color={colors.textPrimary} />
          <Text style={styles.joinText}>Join Voice</Text>
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
          <Text style={styles.failText}>{error ?? "Unable to connect to Voice"}</Text>
          <View style={styles.failBtnRow}>
            <AppButton label="Leave Together" onPress={onLeave} variant="outline" accessibilityLabel="Leave Together" style={{ flex: 1 }} palette="fixedDark" />
            <AppButton label="Retry" variant="secondary" onPress={onRetry} accessibilityLabel="Retry connecting to Voice" style={{ flex: 1 }} palette="fixedDark" />
          </View>
        </View>
      )}

      {phase === "connected" && (
        <View>
          <View style={styles.connectedHeaderRow}>
            <ConnectionHealth phase={phase} />
          </View>
          <View style={styles.controlsRow}>
            <TouchableOpacity hitSlop={10}
              style={[styles.iconBtn, micMuted && styles.iconBtnActive]}
              onPress={onToggleMic}
              accessibilityRole="button"
              accessibilityLabel={micMuted ? "Unmute microphone" : "Mute microphone"}
              accessibilityState={{ selected: micMuted }}
            >
              <Ionicons name={micMuted ? "mic-off" : "mic-outline"} size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity hitSlop={10}
              style={[styles.iconBtn, !listening && styles.iconBtnActive]}
              onPress={onToggleListening}
              accessibilityRole="button"
              accessibilityLabel={listening ? "Stop Voice Audio" : "Resume Voice Audio"}
              accessibilityState={{ selected: !listening }}
            >
              <Ionicons name={listening ? "ear" : "ear-outline"} size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <AppButton label="Leave Voice" onPress={onLeave} variant="outline" accessibilityLabel="Leave Voice" style={{ marginLeft: "auto" }} palette="fixedDark" />
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
  joinText: { color: colors.textPrimary, ...type.bodyEmph },

  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },

  failBox: { backgroundColor: colors.restSoft, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  failText: { color: colors.textPrimary, ...type.caption, lineHeight: 17 },
  failBtnRow: { flexDirection: "row", gap: spacing.sm },

  connectedHeaderRow: { marginBottom: spacing.sm },
  controlsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: MIN_TOUCH_TARGET / 2, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  iconBtnActive: { backgroundColor: colors.rest },
});
