import React, { useRef, useEffect } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { WorshipMessage } from "@/lib/familyApi";

interface Props {
  visible: boolean;
  onClose: () => void;
  messages: WorshipMessage[];
  myUserId: string | undefined;
  draft: string;
  onChangeDraft: (v: string) => void;
  onSend: () => void;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Together's own chat surface — plain bubbles, P2P's existing accent
// colors, not styled after any messaging app's chrome.
export default function ChatPanel({ visible, onClose, messages, myUserId, draft, onChangeDraft, onSend }: Props) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
  }, [visible, messages.length]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>TOGETHER CHAT</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView ref={scrollRef} style={styles.messagesScroll} contentContainerStyle={styles.messagesContent}>
            {messages.length === 0 ? (
              <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
            ) : (
              messages.map((m) => {
                const mine = m.userId === myUserId;
                return (
                  <View key={m.id} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                    <View style={[styles.bubble, mine && styles.bubbleMine]}>
                      {!mine && <Text style={styles.authorName}>{m.authorName}</Text>}
                      <Text style={styles.bubbleText}>{m.content}</Text>
                      <Text style={styles.bubbleTime}>{formatTime(m.createdAt)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Message the Gathering…"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={draft}
              onChangeText={onChangeDraft}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity style={styles.sendBtn} onPress={onSend} disabled={!draft.trim()} accessibilityRole="button" accessibilityLabel="Send message">
              <Ionicons name="send" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "70%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingBottom: 10 },
  title: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6 },

  messagesScroll: { flex: 1, paddingHorizontal: 16 },
  messagesContent: { gap: 10, paddingBottom: 10 },
  emptyText: { color: "rgba(255,255,255,0.4)", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 20 },

  bubbleRow: { flexDirection: "row", justifyContent: "flex-start" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "80%", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: "rgba(29,158,117,0.25)" },
  authorName: { color: "#1D9E75", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 2 },
  bubbleText: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  bubbleTime: { color: "rgba(255,255,255,0.4)", fontSize: 9, fontFamily: "Inter_400Regular", marginTop: 3, alignSelf: "flex-end" },

  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 16,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
  },
  input: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
});