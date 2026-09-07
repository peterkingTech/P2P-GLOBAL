import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AudioSlider from "./AudioSlider";
import type { TogetherAudioPrefs } from "@/lib/togetherAudio/types";

export interface AudioBalanceCompanion {
  userId: string;
  name: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  prefs: TogetherAudioPrefs;
  onSetOutput: (v: number) => void;
  onSetMedia: (v: number) => void;
  onSetRoom: (v: number) => void;
  onSetParticipant: (userId: string, v: number) => void;
  onToggleMute: (userId: string) => void;
  companions: AudioBalanceCompanion[];
  voiceConnected: boolean;
}

const ACCENT_OUTPUT = "#B8860B";
const ACCENT_MEDIA = "#1D9E75";
const ACCENT_ROOM = "#5B8DEF";

// P2P's own Audio Balance panel — a plain track-and-dot control language
// used consistently for every layer, deliberately not styled after any
// communication app's mixer chrome.
export default function AudioBalancePanel({
  visible, onClose, prefs, onSetOutput, onSetMedia, onSetRoom, onSetParticipant, onToggleMute, companions, voiceConnected,
}: Props) {
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
            <AudioSlider label="Output" value={prefs.outputVolume} onChange={onSetOutput} accentColor={ACCENT_OUTPUT} />
            <AudioSlider label="Shared Media" value={prefs.mediaVolume} onChange={onSetMedia} accentColor={ACCENT_MEDIA} />
            <AudioSlider label="Voice Space" value={prefs.roomVolume} onChange={onSetRoom} accentColor={ACCENT_ROOM} disabled={!voiceConnected} />
            {!voiceConnected && (
              <Text style={styles.hint}>Voice Space isn't connected in this room yet — these settings will apply automatically once it is.</Text>
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
                          label={c.name}
                          value={prefs.participantVolumes[c.userId] ?? 1}
                          onChange={(v) => onSetParticipant(c.userId, v)}
                          accentColor={ACCENT_ROOM}
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
  sectionLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginTop: 4 },
  companionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  muteBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
});