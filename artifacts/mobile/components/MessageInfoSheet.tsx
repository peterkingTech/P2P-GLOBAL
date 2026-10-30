import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SupabaseClient } from "@supabase/supabase-js";
import colors from "@/constants/colors";
import { Avatar } from "@/components/Avatar";
import { useSheetWidth } from "@/hooks/useLayout";
import { fetchReceiptDetails, type ReceiptDetailRow } from "@/lib/messageReceiptsApi";
import { recipientState, type RecipientState } from "@/lib/messageReceipts";
import { IconButton } from "@/components/ui";

// Message info for the sender's own message: when it was sent, and for each
// recipient (one row per participant in a group) whether it was delivered
// and read, with the server's timestamps. Only data the server returns is
// shown — no state is inferred from notifications, inserts or opens; a
// recipient with no receipt shows "Not delivered yet".

// Read ticks on the cream sheet (the palette has no blue token); ~5:1 on #FBF7EE.
const READ_BLUE = "#2563EB";

const STATE_TEXT: Record<RecipientState, string> = {
  sent: "Not delivered yet",
  delivered: "Delivered",
  read: "Read",
};

export function formatReceiptTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

export function MessageInfoSheet({
  supabase,
  messageId,
  sentAt,
  onClose,
}: {
  supabase: SupabaseClient;
  messageId: string | null;
  sentAt: string | null;
  onClose: () => void;
}) {
  const sheetWidth = useSheetWidth();
  const [rows, setRows] = useState<ReceiptDetailRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!messageId) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    void fetchReceiptDetails(supabase, messageId).then((res) => {
      if (cancelled) return;
      if ("error" in res) setError(res.error);
      else setRows(res.rows);
    });
    return () => { cancelled = true; };
  }, [messageId, supabase]);

  return (
    <Modal visible={!!messageId} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity accessibilityRole="button" style={styles.overlay} activeOpacity={1} onPress={onClose} accessibilityLabel="Close message info">
        <TouchableOpacity activeOpacity={1} style={[styles.sheet, sheetWidth]}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Message info</Text>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} color={colors.textMid} style={{ marginRight: -10 }} palette="fixedLight" />
          </View>
          {sentAt ? <Text style={styles.sentAt}>Sent {formatReceiptTime(sentAt)}</Text> : null}

          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : !rows ? (
            <ActivityIndicator color={colors.accentGreen} style={{ marginVertical: 24 }} />
          ) : rows.length === 0 ? (
            <Text style={styles.empty}>No recipients for this message.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {rows.map((r) => {
                const state = recipientState(r);
                const name = r.fullName ?? r.username ?? "Member";
                return (
                  <View
                    key={r.userId}
                    style={styles.row}
                    accessible
                    accessibilityLabel={`${name}. ${STATE_TEXT[state]}. Delivered ${r.deliveredAt ? formatReceiptTime(r.deliveredAt) : "not yet"}. Read ${r.readAt ? formatReceiptTime(r.readAt) : "not yet"}.${r.isCurrentMember ? "" : " Left the conversation."}`}
                    testID={`receipt-row-${r.userId}`}
                  >
                    <Avatar photoUrl={r.photoUrl} name={name} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={1}>{name}{r.isCurrentMember ? "" : " (left)"}</Text>
                      <View style={styles.stateRow}>
                        <StateIcon state={state} />
                        <Text style={styles.stateText}>{STATE_TEXT[state]}</Text>
                      </View>
                      <Text style={styles.time}>Delivered: {formatReceiptTime(r.deliveredAt)}</Text>
                      <Text style={styles.time}>Read: {formatReceiptTime(r.readAt)}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function StateIcon({ state }: { state: RecipientState }) {
  if (state === "read") return <Ionicons name="checkmark-done" size={14} color={READ_BLUE} />;
  if (state === "delivered") return <Ionicons name="checkmark-done" size={14} color={colors.textMuted} />;
  return <Ionicons name="checkmark" size={14} color={colors.textMuted} />;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.lightCream, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 32, width: "100%", alignSelf: "center",
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 17, color: colors.textDark, fontFamily: "Inter_700Bold" },
  sentAt: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", marginBottom: 12 },
  error: { fontSize: 14, color: colors.textMid, fontFamily: "Inter_400Regular", marginVertical: 20, textAlign: "center" },
  empty: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular", marginVertical: 20, textAlign: "center" },
  row: { flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.borderBeige },
  name: { fontSize: 15, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  stateRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  stateText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  time: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
});
