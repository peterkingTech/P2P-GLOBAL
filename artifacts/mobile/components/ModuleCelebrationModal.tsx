import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import colors from "@/constants/colors";

interface ModuleCelebrationModalProps {
  label: string;
  onWatchGrowth: () => void;
  onDismiss: () => void;
}

export function ModuleCelebrationModal({ label, onWatchGrowth, onDismiss }: ModuleCelebrationModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          onPress={onDismiss}
          hitSlop={12}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.emoji}>🌳</Text>
          <Text style={styles.congrats}>Congratulations!</Text>
          <Text style={styles.message}>
            You&apos;ve completed <Text style={styles.moduleLabel}>{label}</Text>
            {"\n"}— check your Living Tree
          </Text>

          <TouchableOpacity style={styles.watchBtn} activeOpacity={0.85} onPress={onWatchGrowth}>
            <Ionicons name="play" size={16} color="#fff" />
            <Text style={styles.watchBtnText}>Watch your growth</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.laterBtn} activeOpacity={0.7} onPress={onDismiss}>
            <Text style={styles.laterBtnText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(11,58,46,0.94)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  closeBtn: {
    position: "absolute",
    right: 16,
  },
  content: {
    alignItems: "center",
  },
  emoji: {
    fontSize: 64,
    marginBottom: 18,
  },
  congrats: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    marginBottom: 12,
    textAlign: "center",
  },
  message: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "#E8F5EE",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },
  moduleLabel: {
    fontFamily: "Inter_600SemiBold",
    color: colors.brightYellow,
  },
  watchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.accentGreen,
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginBottom: 14,
  },
  watchBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  laterBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  laterBtnText: {
    color: "#C9B48A",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
