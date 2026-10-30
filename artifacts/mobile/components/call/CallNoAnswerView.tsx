import React, { useState } from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppButton } from "@/components/ui";
import type { P2PCallColors } from "@/components/call/p2pCallTheme";

// The "No answer / Declined / Busy" result shown after a 1:1 call that wasn't
// picked up — shared by app/call/audio.tsx and app/call/video.tsx. Purely
// presentation: by the time a screen shows this, handleEndCall has already
// torn the Agora engine down and reported /calls/end; every action below is
// the screen's own handler.
export type UnansweredOutcome = "no_answer" | "declined" | "busy";
export const UNANSWERED_LABEL: Record<UnansweredOutcome, string> = {
  no_answer: "No answer", declined: "Call declined", busy: "Busy",
};

export default function CallNoAnswerView({ colors: p2p, insets, photoUrl, name, outcome, callAgainIcon, callingAgain, onCancel, onRecordVoice, onCallAgain }: {
  colors: P2PCallColors;
  insets: { top: number; bottom: number };
  photoUrl: string | null | undefined;
  name: string;
  outcome: UnansweredOutcome;
  callAgainIcon: "call" | "videocam";
  callingAgain: boolean;
  onCancel: () => void;
  /** Only when the call belongs to a conversation a voice message can go to. */
  onRecordVoice?: () => void;
  onCallAgain: () => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <View style={[styles.screen, { backgroundColor: p2p.bg, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 30 }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={styles.center}>
        <View style={[styles.avatarWrap, { backgroundColor: p2p.pillBg, borderColor: p2p.accentBorder }]}>
          {photoUrl && !photoFailed
            ? <Image source={{ uri: photoUrl }} style={styles.photo} onError={() => setPhotoFailed(true)} accessibilityIgnoresInvertColors />
            : <Ionicons name="person" size={48} color={p2p.textMuted} />}
        </View>
        <Text style={[styles.name, { color: p2p.textPrimary }]} accessibilityRole="header">{name}</Text>
        <Text style={[styles.status, { color: p2p.textMuted }]}>{UNANSWERED_LABEL[outcome]}</Text>
      </View>
      <View style={styles.actions}>
        <AppButton label="Cancel" onPress={onCancel} variant="outline" accessibilityLabel="Cancel" />
        {onRecordVoice && (
          <AppButton label="Record voice message" onPress={onRecordVoice} variant="outline" icon="mic-outline" accessibilityLabel="Record voice message" />
        )}
        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: p2p.accent }]} onPress={onCallAgain} disabled={callingAgain}
          accessibilityRole="button" accessibilityLabel="Call again" accessibilityState={{ busy: callingAgain, disabled: callingAgain }}>
          {callingAgain ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Ionicons name={callAgainIcon} size={16} color="#fff" />
              <Text style={styles.primaryText}>Call again</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "space-between" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarWrap: { width: 128, height: 128, borderRadius: 64, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1.5, marginBottom: 20 },
  photo: { width: "100%", height: "100%" },
  name: { fontSize: 24, fontWeight: "700", fontFamily: "Inter_700Bold" },
  status: { fontSize: 15, fontFamily: "Inter_400Regular", marginTop: 6 },
  actions: { width: "100%", paddingHorizontal: 24, gap: 12 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14, minHeight: 48 },
  primaryText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});
