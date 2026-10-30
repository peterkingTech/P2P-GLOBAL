import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";

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
        <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button"
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

          <AppButton label="Watch your growth" onPress={onWatchGrowth} icon="play" style={{ marginBottom: 14 }} palette="fixedLight" />

          <AppButton label="Maybe later" onPress={onDismiss} variant="tertiary" size="sm" palette="fixedLight" />
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
});
