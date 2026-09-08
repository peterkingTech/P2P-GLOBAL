import React, { useRef, useEffect } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MessageContext, SharedMediaProvider, WorshipMessage, WorshipScripture } from "@/lib/familyApi";
import { formatScriptureReference } from "@/lib/familyApi";

interface Props {
  visible: boolean;
  onClose: () => void;
  messages: WorshipMessage[];
  myUserId: string | undefined;
  draft: string;
  onChangeDraft: (v: string) => void;
  onSend: () => void;
  // P2P Together Phase 7 — Conversation's Scripture/media/question
  // references. currentScripture/currentMedia are what the Gathering is
  // showing RIGHT NOW — non-null enables that attach chip; pendingContext
  // is cleared by the caller once the message is sent.
  currentScripture: WorshipScripture | null;
  currentMedia: { mediaProvider: SharedMediaProvider; mediaId: string; positionMs: number } | null;
  pendingContext: MessageContext | null;
  onSetPendingContext: (c: MessageContext | null) => void;
  // Desktop composition's "optional conversation panel" — docks to the
  // right edge as a tall panel instead of sliding up from the bottom.
  dockRight?: boolean;
}

function contextLabel(c: MessageContext): string {
  if (c.type === "scripture") return `📖 ${formatScriptureReference(c)}`;
  if (c.type === "media") return "🎬 This moment";
  return "❓ Question";
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Together's own chat surface — plain bubbles, P2P's existing accent
// colors, not styled after any messaging app's chrome.
export default function ChatPanel({
  visible, onClose, messages, myUserId, draft, onChangeDraft, onSend,
  currentScripture, currentMedia, pendingContext, onSetPendingContext, dockRight,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
  }, [visible, messages.length]);

  return (
    <Modal visible={visible} transparent animationType={dockRight ? "fade" : "slide"} onRequestClose={onClose}>
      <KeyboardAvoidingView style={[styles.overlay, dockRight && styles.overlayDockRight]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.sheet, dockRight && styles.sheetDockRight]}>
          <View style={styles.header}>
            <Text style={styles.title}>TOGETHER CHAT</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Close Together Chat">
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
                      {m.context && <Text style={styles.contextTag}>{contextLabel(m.context)}</Text>}
                      <Text style={styles.bubbleText}>{m.content}</Text>
                      <Text style={styles.bubbleTime}>{formatTime(m.createdAt)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {pendingContext && (
            <View style={styles.pendingRow}>
              <Text style={styles.pendingText}>{contextLabel(pendingContext)}</Text>
              <TouchableOpacity onPress={() => onSetPendingContext(null)} accessibilityRole="button" accessibilityLabel="Remove attachment" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>
          )}
          {!pendingContext && (
            <View style={styles.attachRow}>
              {currentScripture && (
                <TouchableOpacity style={styles.attachChip} onPress={() => onSetPendingContext({ type: "scripture", ...currentScripture })} accessibilityRole="button" accessibilityLabel="Attach the current passage">
                  <Text style={styles.attachChipText}>📖 Passage</Text>
                </TouchableOpacity>
              )}
              {currentMedia && (
                <TouchableOpacity style={styles.attachChip} onPress={() => onSetPendingContext({ type: "media", ...currentMedia })} accessibilityRole="button" accessibilityLabel="Attach this moment in Media">
                  <Text style={styles.attachChipText}>🎬 Moment</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.attachChip} onPress={() => onSetPendingContext({ type: "question" })} accessibilityRole="button" accessibilityLabel="Tag this message as a question">
                <Text style={styles.attachChipText}>❓ Question</Text>
              </TouchableOpacity>
            </View>
          )}

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
  overlayDockRight: { flexDirection: "row", justifyContent: "flex-end", alignItems: "stretch" },
  sheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "70%" },
  sheetDockRight: { borderTopLeftRadius: 20, borderTopRightRadius: 0, borderBottomLeftRadius: 20, width: 360, height: "100%" },
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
  contextTag: { color: "#B8860B", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 3 },
  bubbleText: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  bubbleTime: { color: "rgba(255,255,255,0.4)", fontSize: 9, fontFamily: "Inter_400Regular", marginTop: 3, alignSelf: "flex-end" },

  attachRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  attachChip: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  attachChipText: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontFamily: "Inter_500Medium" },
  pendingRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 16, marginBottom: 8, backgroundColor: "rgba(184,134,11,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  pendingText: { color: "#B8860B", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },

  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 16,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
  },
  input: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", maxHeight: 100,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1D9E75", alignItems: "center", justifyContent: "center" },
});