import React from "react";
import { View, ScrollView, TouchableOpacity, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ExpressionBar from "./ExpressionBar";
import { colors, MIN_TOUCH_TARGET } from "@/lib/togetherTheme";

interface Props {
  reactionEmojis: string[];
  onSendReaction: (emoji: string) => void;
  handRaised: boolean;
  onToggleRaiseHand: () => void;
  onOpenChat: () => void;
  onOpenNotes: () => void;
  onOpenAudioBalance: () => void;
  isHost: boolean;
  onOpenTransfer: () => void;
  bottomInset: number;
}

// P2P's simple bottom controls — expressions, hand-raise, and the
// panel-opening icons, in one horizontally-scrollable row. Not a
// toolbar/dock styled after any call app's control bar.
export default function GatheringFooter({
  reactionEmojis, onSendReaction, handRaised, onToggleRaiseHand,
  onOpenChat, onOpenNotes, onOpenAudioBalance, isHost, onOpenTransfer, bottomInset,
}: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={[styles.row, { paddingBottom: bottomInset + 12 }]}
    >
      <ExpressionBar emojis={reactionEmojis} onSend={onSendReaction} />
      <TouchableOpacity
        style={[styles.iconBtn, handRaised && styles.iconBtnActive]}
        onPress={onToggleRaiseHand}
        accessibilityRole="button"
        accessibilityLabel={handRaised ? "Lower hand" : "Raise hand"}
        accessibilityState={{ selected: handRaised }}
      >
        <Text style={{ fontSize: 16 }}>✋</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={onOpenChat} accessibilityRole="button" accessibilityLabel="Open Together Chat">
        <Ionicons name="chatbubble-outline" size={16} color={colors.textPrimary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={onOpenNotes} accessibilityRole="button" accessibilityLabel="Open Notes">
        <Ionicons name="document-text-outline" size={16} color={colors.textPrimary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={onOpenAudioBalance} accessibilityRole="button" accessibilityLabel="Open Audio">
        <Ionicons name="options-outline" size={16} color={colors.textPrimary} />
      </TouchableOpacity>
      {isHost && (
        <TouchableOpacity style={styles.iconBtn} onPress={onOpenTransfer} accessibilityRole="button" accessibilityLabel="Transfer Guide role">
          <Ionicons name="swap-horizontal" size={16} color={colors.textPrimary} />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 10, paddingHorizontal: 16, minWidth: "100%" },
  iconBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: MIN_TOUCH_TARGET / 2, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  iconBtnActive: { backgroundColor: colors.light },
});
