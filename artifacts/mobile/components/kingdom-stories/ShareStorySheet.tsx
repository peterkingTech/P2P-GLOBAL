import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Share } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useData } from "@/contexts/DataContext";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { storyShareMessage, sendStoryToChat } from "@/lib/storyShare";

// Share a Kingdom Story: into one of your existing P2P chats (a peer, a
// friend, your Family Circle, Church, or Circle chat — whatever you're a
// member of), or outside P2P with the system share sheet. Only the story's
// title, number and link are shared; never your progress, notes or answers.
// Sending goes through the normal message path, so membership, blocking,
// safeguarding and notifications apply exactly as for any message.
interface Props {
  visible: boolean;
  onClose: () => void;
  story: { id: string; title: string; subtitle?: string | null; topicNumber?: number | null };
}

export default function ShareStorySheet({ visible, onClose, story }: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { conversations } = useData();
  const { user } = useAuth();
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, true>>({});
  const [error, setError] = useState<string | null>(null);
  const message = storyShareMessage(story);

  // Most recent chats first; official broadcast accounts don't take replies.
  const chats = useMemo(() => [...conversations].filter((cv) => !cv.otherUserIsOfficial)
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "")).slice(0, 40), [conversations]);

  async function send(conversationId: string) {
    if (!user || sending) return;
    setSending(conversationId); setError(null);
    const r = await sendStoryToChat(supabase, { conversationId, senderId: user.id, body: message });
    setSending(null);
    if (r.ok) setSent((s) => ({ ...s, [conversationId]: true }));
    else setError(r.error);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close sharing">
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Share this story</Text>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.textDark} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sub}>Only the story is shared — never your progress, notes or answers.</Text>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={styles.group}>Send in a P2P chat</Text>
            {chats.length === 0 ? <Text style={styles.sub}>You don't have any chats yet. Start one from Messages.</Text> : chats.map((cv) => {
              const done = !!sent[cv.id];
              return (
                <TouchableOpacity key={cv.id} style={styles.row} onPress={() => send(cv.id)} disabled={done || !!sending}
                  accessibilityRole="button" accessibilityLabel={done ? `Sent to ${cv.name ?? "chat"}` : `Send to ${cv.name ?? "chat"}`}>
                  <Ionicons name={cv.type === "direct" ? "person-circle-outline" : "people-circle-outline"} size={26} color={c.textMid} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{cv.name ?? "Chat"}</Text>
                    <Text style={styles.kind}>{cv.type === "direct" ? "Direct message" : `${cv.memberCount} members`}</Text>
                  </View>
                  {sending === cv.id ? <ActivityIndicator color={c.accentGreen} />
                    : done ? <Text style={styles.sent}>Sent ✓</Text>
                    : <Ionicons name="send" size={18} color={c.accentGreen} />}
                </TouchableOpacity>
              );
            })}
            <Text style={styles.group}>Outside P2P</Text>
            <TouchableOpacity style={styles.row} onPress={() => { Share.share({ message }).catch(() => {}); }} accessibilityRole="button" accessibilityLabel="Share outside P2P">
              <Ionicons name="share-outline" size={24} color={c.textMid} />
              <Text style={[styles.name, { flex: 1 }]}>Other apps…</Text>
            </TouchableOpacity>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { maxHeight: "80%", backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 16 },
    header: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingTop: 6 },
    title: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    sub: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", paddingHorizontal: 16, paddingBottom: 6 },
    error: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_500Medium", paddingHorizontal: 16, paddingBottom: 6 },
    group: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 56 },
    name: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    kind: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    sent: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}
