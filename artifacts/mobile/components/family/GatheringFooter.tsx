import React, { useState } from "react";
import { ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ExpressionBar from "./ExpressionBar";
import FamilyIcon from "./FamilyIcon";
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

const ICON = 20;

// P2P's simple bottom controls — reactions, hand-raise, and the
// panel-opening icons, in one horizontally-scrollable row. Every control is
// a vector icon in the same 44pt circle; the emoji reactions themselves are
// the content people send, shown only once the reactions control is opened.
export default function GatheringFooter({
  reactionEmojis, onSendReaction, handRaised, onToggleRaiseHand,
  onOpenChat, onOpenNotes, onOpenAudioBalance, isHost, onOpenTransfer, bottomInset,
}: Props) {
  const [reactionsOpen, setReactionsOpen] = useState(false);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={[styles.row, { paddingBottom: bottomInset + 12 }]}
    >
      <TouchableOpacity
        style={[styles.iconBtn, reactionsOpen && styles.iconBtnActive]}
        onPress={() => setReactionsOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel={reactionsOpen ? "Hide reactions" : "Send a reaction"}
        accessibilityState={{ expanded: reactionsOpen }}
      >
        <FamilyIcon name="reactions" size={ICON} active={reactionsOpen} color={reactionsOpen ? colors.light : colors.textPrimary} />
      </TouchableOpacity>
      {reactionsOpen && <ExpressionBar emojis={reactionEmojis} onSend={onSendReaction} />}
      <TouchableOpacity
        style={[styles.iconBtn, handRaised && styles.iconBtnActive]}
        onPress={onToggleRaiseHand}
        accessibilityRole="button"
        accessibilityLabel={handRaised ? "Lower hand" : "Raise hand"}
        accessibilityState={{ selected: handRaised }}
      >
        <FamilyIcon name="raiseHand" size={ICON} active={handRaised} color={handRaised ? colors.light : colors.textPrimary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={onOpenChat} accessibilityRole="button" accessibilityLabel="Open Chat">
        <Ionicons name="chatbubble-outline" size={ICON} color={colors.textPrimary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={onOpenNotes} accessibilityRole="button" accessibilityLabel="Open Notes">
        <Ionicons name="document-text-outline" size={ICON} color={colors.textPrimary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={onOpenAudioBalance} accessibilityRole="button" accessibilityLabel="Open Audio">
        <Ionicons name="options-outline" size={ICON} color={colors.textPrimary} />
      </TouchableOpacity>
      {isHost && (
        <TouchableOpacity style={styles.iconBtn} onPress={onOpenTransfer} accessibilityRole="button" accessibilityLabel="Transfer Guide role">
          <Ionicons name="swap-horizontal-outline" size={ICON} color={colors.textPrimary} />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 10, paddingHorizontal: 16, minWidth: "100%" },
  iconBtn: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: MIN_TOUCH_TARGET / 2, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  // Active = the Gathering's accent tint with an accent glyph (not a solid
  // fill), the same treatment as the Guide's selected mode.
  iconBtnActive: { backgroundColor: colors.lightSoft },
});
