import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AudioSlider from "./AudioSlider";
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

const ACCENT_OUTPUT = "#B8860B";
const ACCENT_MEDIA = "#1D9E75";
const ACCENT_ROOM = "#5B8DEF";

// P2P's own Audio Balance panel — a plain track-and-dot control language
// used consistently for every layer, deliberately not styled after any
// communication app's mixer chrome. Voice Space's join/mic/listening
// controls live here too, since this panel already owns everything audio.
export default function AudioBalancePanel({
  visible, onClose, prefs, onSetOutput, onSetMedia, onSetRoom, onSetParticipant, onToggleMute, companions,
  voicePhase, voiceError, onJoinVoice, onRetryVoice, onLeaveVoice, micMuted, onToggleMic, listening, onToggleListening,
}: Props) {
  const voiceConnected = voicePhase === "connected";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>AUDIO BALANCE</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scroll}>
            <View>
              <Text style={styles.sectionLabel}>VOICE SPACE</Text>

              {voicePhase === "idle" && (
                <TouchableOpacity style={styles.voiceJoinBtn} onPress={onJoinVoice} accessibilityRole="button" accessibilityLabel="Join Voice Space">
                  <Text style={styles.voiceJoinIcon}>🎙️</Text>
                  <Text style={styles.voiceJoinText}>Join Voice Space</Text>
                </TouchableOpacity>
              )}

              {voicePhase === "connecting" && (
                <View style={styles.voiceStatusRow}>
                  <ActivityIndicator color={ACCENT_ROOM} size="small" />
                  <Text style={styles.voiceStatusText}>Connecting to Voice Space…</Text>
                </View>
              )}

              {voicePhase === "failed" && (
                <View style={styles.voiceFailBox}>
                  <Text style={styles.voiceFailText}>{voiceError ?? "Unable to connect to Voice Space"}</Text>
                  <View style={styles.voiceFailBtnRow}>
                    <TouchableOpacity style={styles.voiceSecondaryBtn} onPress={onLeaveVoice}>
                      <Text style={styles.voiceSecondaryBtnText}>Leave Together</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.voicePrimaryBtn} onPress={onRetryVoice}>
                      <Text style={styles.voicePrimaryBtnText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {voicePhase === "connected" && (
                <View style={styles.voiceControlsRow}>
                  <View style={styles.connectionHealthRow}>
                    <View style={styles.connectionDot} />
                    <Text style={styles.voiceStatusText}>Connection Health: Good</Text>
                  </View>
                  <View style={styles.voiceControlsRow}>
                    <TouchableOpacity
                      style={[styles.voiceIconBtn, micMuted && styles.voiceIconBtnActive]}
                      onPress={onToggleMic}
                      accessibilityRole="button"
                      accessibilityLabel={micMuted ? "Unmute microphone" : "Mute microphone"}
                    >
                      <Ionicons name={micMuted ? "mic-off" : "mic"} size={16} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.voiceIconBtn, !listening && styles.voiceIconBtnActive]}
                      onPress={onToggleListening}
                      accessibilityRole="button"
                      accessibilityLabel={listening ? "Stop listening to Voice Space" : "Resume listening to Voice Space"}
                    >
                      <Ionicons name={listening ? "ear" : "ear-outline"} size={16} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.voiceSecondaryBtnSmall} onPress={onLeaveVoice}>
                      <Text style={styles.voiceSecondaryBtnText}>Leave Voice Space</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            <AudioSlider label="Output" value={prefs.outputVolume} onChange={onSetOutput} accentColor={ACCENT_OUTPUT} />
            <AudioSlider label="Shared Media" value={prefs.mediaVolume} onChange={onSetMedia} accentColor={ACCENT_MEDIA} />
            <AudioSlider label="Voice Space" value={prefs.roomVolume} onChange={onSetRoom} accentColor={ACCENT_ROOM} disabled={!voiceConnected} />
            {!voiceConnected && (
              <Text style={styles.hint}>Join Voice Space above for these settings to affect anything.</Text>
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
                          accentColor={c.speaking ? "#1D9E75" : ACCENT_ROOM}
                          disabled={!voiceConnected || muted}
                        />
                      </View>
                      <TouchableOpacity
                        style={styles.muteBtn}
                        onPress={() => onToggleMute(c.userId)}
                        accessibilityRole="button"
                        accessibilityLabel={muted ? `Unmute ${c.name}` : `Mute ${c.name}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name={muted ? "volume-mute" : "volume-medium"} size={16} color={muted ? "#DC2626" : "rgba(255,255,255,0.7)"} />
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
  sheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingBottom: 10 },
  title: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  scroll: { paddingHorizontal: 20, paddingBottom: 30, gap: 18 },
  hint: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: -8 },
  sectionLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginTop: 4, marginBottom: 10 },
  companionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  muteBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },

  voiceJoinBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "rgba(91,141,239,0.18)", borderRadius: 12, paddingVertical: 12,
  },
  voiceJoinIcon: { fontSize: 15 },
  voiceJoinText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

  voiceStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  voiceStatusText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_400Regular" },

  voiceFailBox: { backgroundColor: "rgba(220,38,38,0.1)", borderRadius: 12, padding: 12, gap: 10 },
  voiceFailText: { color: "#fff", fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  voiceFailBtnRow: { flexDirection: "row", gap: 10 },
  voicePrimaryBtn: { flex: 1, backgroundColor: ACCENT_ROOM, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  voicePrimaryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  voiceSecondaryBtn: { flex: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  voiceSecondaryBtnSmall: { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: "center", marginLeft: "auto" },
  voiceSecondaryBtnText: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  connectionHealthRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  connectionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#1D9E75" },
  voiceControlsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  voiceIconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  voiceIconBtnActive: { backgroundColor: "#DC2626" },
});