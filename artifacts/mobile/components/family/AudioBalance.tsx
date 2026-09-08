import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AudioSlider from "./AudioSlider";
import VoiceSpace from "./VoiceSpace";
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";
import type { TogetherAudioPrefs } from "@/lib/togetherAudio/types";
import type { VoicePhase, VoiceCompanionState } from "@/hooks/useVoiceSpace";

interface Props {
  visible: boolean;
  onClose: () => void;
  prefs: TogetherAudioPrefs;
  onSetOutput: (v: number) => void;
  onSetMedia: (v: number) => void;
  onSetRoom: (v: number) => void;
  onSetParticipant: (userId: string, v: number) => void;
  onToggleMute: (userId: string) => void;
  companions: VoiceCompanionState[];
  voicePhase: VoicePhase;
  voiceError: string | null;
  onJoinVoice: () => void;
  onRetryVoice: () => void;
  onLeaveVoice: () => void;
  micMuted: boolean;
  onToggleMic: () => void;
  listening: boolean;
  onToggleListening: () => void;
}

// P2P's own Audio Balance surface — a plain track-and-dot control
// language used consistently for every layer (see AudioSlider),
// deliberately not styled after any communication app's mixer chrome.
export default function AudioBalance({
  visible, onClose, prefs, onSetOutput, onSetMedia, onSetRoom, onSetParticipant, onToggleMute, companions,
  voicePhase, voiceError, onJoinVoice, onRetryVoice, onLeaveVoice, micMuted, onToggleMic, listening, onToggleListening,
}: Props) {
  const voiceConnected = voicePhase === "connected";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>AUDIO</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Close Audio">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scroll}>
            <VoiceSpace
              phase={voicePhase} error={voiceError} onJoin={onJoinVoice} onRetry={onRetryVoice} onLeave={onLeaveVoice}
              micMuted={micMuted} onToggleMic={onToggleMic} listening={listening} onToggleListening={onToggleListening}
            />

            <AudioSlider label="Output" value={prefs.outputVolume} onChange={onSetOutput} accentColor={colors.light} />
            <AudioSlider label="Media" value={prefs.mediaVolume} onChange={onSetMedia} accentColor={colors.growth} />
            <AudioSlider label="Voice" value={prefs.roomVolume} onChange={onSetRoom} accentColor={colors.connection} disabled={!voiceConnected} />
            {!voiceConnected && (
              <Text style={styles.hint}>Join Voice above for these settings to affect anything.</Text>
            )}

            {companions.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>COMPANIONS</Text>
                {companions.map((c) => {
                  const muted = prefs.mutedParticipants.includes(c.userId);
                  return (
                    <View key={c.userId} style={styles.companionRow}>
                      <View style={{ flex: 1 }}>
                        <AudioSlider
                          label={`${c.name}${c.speaking ? " · Speaking" : voiceConnected && !c.connected ? " · Not here" : ""}`}
                          value={prefs.participantVolumes[c.userId] ?? 1}
                          onChange={(v) => onSetParticipant(c.userId, v)}
                          accentColor={c.speaking ? colors.growth : colors.connection}
                          disabled={!voiceConnected || muted}
                        />
                      </View>
                      <TouchableOpacity
                        style={styles.muteBtn}
                        onPress={() => onToggleMute(c.userId)}
                        accessibilityRole="button"
                        accessibilityLabel={muted ? `Unmute ${c.name}` : `Mute ${c.name}`}
                        accessibilityState={{ selected: muted }}
                      >
                        <Ionicons name={muted ? "volume-mute" : "volume-medium"} size={16} color={muted ? colors.rest : colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.sheet, borderTopLeftRadius: radii.xl + 4, borderTopRightRadius: radii.xl + 4, maxHeight: "80%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.xl, paddingBottom: spacing.sm },
  title: { color: colors.textPrimary, ...type.title, letterSpacing: 0.6 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 30, gap: 18 },
  hint: { color: colors.textFaint, ...type.caption, marginTop: -8 },
  sectionLabel: { color: colors.textTertiary, ...type.label, marginTop: spacing.xs, marginBottom: spacing.sm },
  companionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  muteBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: MIN_TOUCH_TARGET / 2, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
});
