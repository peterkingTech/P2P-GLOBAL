import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { P2PCallColors } from "./p2pCallTheme";

export interface CallMoreAction {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Shown under the label, e.g. "On" / "Off". */
  detail?: string;
  active?: boolean;
  onPress: () => void;
}

// Secondary, less-frequent call controls. The sheet only lists what it is
// given — each action keeps its existing handler in the call screen.
export function CallMoreSheet({
  visible, onClose, actions, colors,
}: {
  visible: boolean; onClose: () => void; actions: CallMoreAction[]; colors: P2PCallColors;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close more options" />
      <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder, paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.handle, { backgroundColor: colors.surfaceBorder }]} />
        {actions.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={[styles.row, { borderBottomColor: colors.surfaceBorder }]}
            onPress={() => { onClose(); a.onPress(); }}
            accessibilityRole="button"
            accessibilityLabel={a.detail ? `${a.label}, ${a.detail}` : a.label}
            accessibilityState={{ selected: !!a.active }}
          >
            <View style={[styles.iconWrap, { backgroundColor: a.active ? colors.pillBg : "transparent", borderColor: a.active ? colors.accent : colors.surfaceBorder }]}>
              <Ionicons name={a.icon} size={18} color={a.active ? colors.accent : colors.textPrimary} />
            </View>
            <Text style={[styles.label, { color: colors.textPrimary }]}>{a.label}</Text>
            {!!a.detail && <Text style={[styles.detail, { color: a.active ? colors.accent : colors.textMuted }]}>{a.detail}</Text>}
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingHorizontal: 20, paddingTop: 10 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  iconWrap: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  detail: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
