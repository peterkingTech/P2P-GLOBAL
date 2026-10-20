import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors as together } from "@/lib/togetherTheme";
import { useActiveGathering } from "@/lib/activeGathering";

// Shown on screens a participant opens from a live Family Gathering (their
// own lesson). The Gathering — and its call — is still running underneath:
// this bar only returns to it (dismissTo pops back to the mounted screen
// instead of opening a new one) and toggles the same microphone. It never
// starts, joins, leaves or reconnects the call.
export default function GatheringReturnBar({ topInset = 0 }: { topInset?: number }) {
  const router = useRouter();
  const gathering = useActiveGathering();
  if (!gathering) return null;

  function goBack() {
    router.dismissTo(gathering!.returnTo as any);
  }

  return (
    <View style={[styles.bar, { paddingTop: topInset + 6 }]} accessibilityRole="toolbar">
      <View style={styles.live} />
      <Text style={styles.label} numberOfLines={1}>Gathering in progress</Text>
      {gathering.voiceConnected ? (
        <TouchableOpacity
          style={[styles.iconBtn, gathering.micMuted && styles.iconBtnActive]} onPress={gathering.toggleMic}
          accessibilityRole="button" accessibilityLabel={gathering.micMuted ? "Unmute microphone" : "Mute microphone"} accessibilityState={{ selected: gathering.micMuted }}
        >
          <Ionicons name={gathering.micMuted ? "mic-off" : "mic"} size={18} color={together.textPrimary} />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.returnBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel="Return to the Gathering">
        <Ionicons name="people" size={16} color="#fff" />
        <Text style={styles.returnText}>Return</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingBottom: 8, backgroundColor: together.background },
  live: { width: 8, height: 8, borderRadius: 4, backgroundColor: together.growth },
  label: { flex: 1, color: together.textPrimary, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  iconBtnActive: { backgroundColor: "rgba(220,38,38,0.55)" },
  returnBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: together.growth },
  returnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
});
