import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as together } from "@/lib/togetherTheme";

// Compact bar shown while a resource (Bible, Media, Workspace) is expanded:
// what's open, Done (restore), and — during a live session — the controls
// people still need: microphone and chat. Only calls the handlers it's
// given; it never starts, ends or reconnects anything.
interface Props {
  title: string;
  subtitle?: string | null;
  onDone: () => void;
  mic?: { connected: boolean; muted: boolean; onToggle: () => void } | null;
  onOpenChat?: (() => void) | null;
  topInset: number;
}

export default function FocusBar({ title, subtitle, onDone, mic, onOpenChat, topInset }: Props) {
  return (
    <View style={[styles.bar, { paddingTop: topInset + 6 }]} accessibilityRole="toolbar">
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {mic?.connected ? (
        <TouchableOpacity
          style={[styles.iconBtn, mic.muted && styles.iconBtnActive]} onPress={mic.onToggle}
          accessibilityRole="button" accessibilityLabel={mic.muted ? "Unmute microphone" : "Mute microphone"} accessibilityState={{ selected: mic.muted }}
        >
          <Ionicons name={mic.muted ? "mic-off" : "mic"} size={18} color={together.textPrimary} />
        </TouchableOpacity>
      ) : null}
      {onOpenChat ? (
        <TouchableOpacity style={styles.iconBtn} onPress={onOpenChat} accessibilityRole="button" accessibilityLabel="Open chat">
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={together.textPrimary} />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.doneBtn} onPress={onDone} accessibilityRole="button" accessibilityLabel={`Done, close full screen ${title}`}>
        <Ionicons name="contract-outline" size={16} color="#fff" />
        <Text style={styles.doneText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  title: { color: together.textPrimary, fontSize: 16, fontFamily: "Inter_700Bold" },
  subtitle: { color: "rgba(255,255,255,0.65)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  iconBtnActive: { backgroundColor: "rgba(220,38,38,0.55)" },
  doneBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: together.growth },
  doneText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
});
