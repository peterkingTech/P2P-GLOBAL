import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";

interface PeerGuideRequestModalProps {
  visible: boolean;
  onClose: () => void;
  targetUserId: string;
  targetName: string;
  onSent?: () => void;
}

const MAX_MESSAGE_LENGTH = 500;

// "Choose Someone I Know as My Peer Guide" — a specific, direct ask (source:
// 'direct'), distinct from the algorithmic Smart Match flow
// (app/connect/smart-match.tsx), though both go through the same
// POST /discipleship/request endpoint and p2p_discipleship_links table.
export function PeerGuideRequestModal({ visible, onClose, targetUserId, targetName, onSent }: PeerGuideRequestModalProps) {
  const { profile } = useAuth();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentOk, setSentOk] = useState(false);

  useEffect(() => {
    if (visible) { setMessage(""); setError(null); setSentOk(false); setSending(false); }
  }, [visible]);

  async function handleSend() {
    if (!profile?.id || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await authedFetch("/discipleship/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learnerId: profile.id, peerGuideId: targetUserId,
          message: message.trim() || undefined, source: "direct",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't send this request. Please try again.");
        return;
      }
      setSentOk(true);
      onSent?.();
    } catch {
      setError("Couldn't send this request. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {sentOk ? (
            <View style={styles.confirmWrap}>
              <Ionicons name="checkmark-circle" size={44} color={colors.accentGreen} />
              <Text style={styles.confirmTitle}>Request sent</Text>
              <Text style={styles.confirmSub}>{targetName} will be notified that you'd like them to be your Peer Guide.</Text>
              <TouchableOpacity style={styles.sendBtn} onPress={onClose}>
                <Text style={styles.sendBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Ask {targetName} to Be Your Peer Guide?</Text>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color={colors.textDark} />
                </TouchableOpacity>
              </View>

              <Text style={styles.explainer}>
                A Peer Guide walks alongside you through your discipleship journey, encouraging you, helping you stay
                accountable, and growing together in Christ.
              </Text>

              <TextInput
                style={styles.input}
                value={message}
                onChangeText={(t) => setMessage(t.slice(0, MAX_MESSAGE_LENGTH))}
                placeholder="Tell them why you would like them to be your Peer Guide…"
                placeholderTextColor={colors.textMuted}
                multiline
              />
              <Text style={styles.charCount}>{message.length}/{MAX_MESSAGE_LENGTH}</Text>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={sending}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.sendBtn, sending && styles.sendBtnDisabled]} onPress={handleSend} disabled={sending}>
                  {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendBtnText}>Send Request</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default PeerGuideRequestModal;

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  title: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", lineHeight: 23 },
  explainer: { fontSize: 13, color: colors.textMid, lineHeight: 20, fontFamily: "Inter_400Regular", marginBottom: 16 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular",
    minHeight: 90, textAlignVertical: "top",
  },
  charCount: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "right", marginTop: 4 },
  errorText: { fontSize: 12, color: "#B91C1C", fontFamily: "Inter_500Medium", marginTop: 10 },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, alignItems: "center", paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: colors.borderBeige },
  cancelBtnText: { fontSize: 14, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  sendBtn: { flex: 1, alignItems: "center", paddingVertical: 13, borderRadius: 12, backgroundColor: colors.primaryGreen },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  confirmWrap: { alignItems: "center", paddingVertical: 30, gap: 10 },
  confirmTitle: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  confirmSub: { fontSize: 13, color: colors.textMid, textAlign: "center", fontFamily: "Inter_400Regular", paddingHorizontal: 20, marginBottom: 10 },
});