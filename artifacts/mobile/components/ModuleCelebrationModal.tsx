import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";
import LivingTreeView from "@/components/growth/LivingTreeView";
import { STAGES, PERSONAL_STAGE_COUNT } from "@/constants/stages";

interface ModuleCelebrationModalProps {
  label: string;
  onWatchGrowth: () => void;
  onDismiss: () => void;
  /** A new personal growth stage (the growth engine) instead of a completed module. */
  stage?: { name: string; emoji: string; verse: string; verseRef: string };
}

export function ModuleCelebrationModal({ label, onWatchGrowth, onDismiss, stage }: ModuleCelebrationModalProps) {
  const stageIndex = stage ? STAGES.findIndex((s) => s.name === stage.name) : -1;
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
          {/* A new stage: its real Meshy model in 3D. A finished module (no stage change): a ribbon. */}
          {stageIndex >= 0 && stageIndex < PERSONAL_STAGE_COUNT ? (
            <View style={styles.tree}>
              <LivingTreeView stageIndex={stageIndex} mode="stage" compact background="#10291c" />
            </View>
          ) : (
            <Ionicons name="ribbon" size={56} color="#F4C95D" style={{ marginBottom: 12 }} />
          )}
          <Text style={styles.congrats}>Congratulations!</Text>
          {stage ? (
            <Text style={styles.message} accessibilityRole="header">
              You have grown into a <Text style={styles.moduleLabel}>{stage.name}</Text>
              {"\n\n"}“{stage.verse}”{"\n"}— {stage.verseRef}
            </Text>
          ) : (
            <Text style={styles.message}>
              You&apos;ve completed <Text style={styles.moduleLabel}>{label}</Text>
              {"\n"}— check your Living Tree
            </Text>
          )}

          <AppButton label={stage ? "See your growth journey" : "Watch your growth"} onPress={onWatchGrowth} icon={stage ? "leaf" : "play"} style={{ marginBottom: 14 }} palette="fixedLight" />

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
  tree: { width: 220, height: 220, borderRadius: 20, overflow: "hidden", marginBottom: 12 },
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
