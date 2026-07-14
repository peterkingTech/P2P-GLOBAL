import React, { useState } from "react";
import { View, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { CrisisResourcesModal } from "@/components/CrisisResourcesModal";

export function HelpButton({ variant = "fab" }: { variant?: "fab" | "inline" }) {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const { submitHelpRequest } = useData();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  if (!isAuthenticated) return null;

  async function handlePress() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setOpen(true);
    setSent(false);
    const err = await submitHelpRequest({ tier: "crisis" });
    setSent(!err);
  }

  return (
    <>
      <TouchableOpacity
        style={variant === "fab" ? [styles.fab, { bottom: insets.bottom + (Platform.OS === "web" ? 24 : 90) }] : styles.inlineBtn}
        onPress={handlePress}
        activeOpacity={0.85}
        accessibilityLabel="I need help now"
      >
        <Ionicons name="heart" size={variant === "fab" ? 22 : 20} color={variant === "fab" ? "#fff" : "#B91C1C"} />
      </TouchableOpacity>

      <CrisisResourcesModal
        visible={open}
        onClose={() => setOpen(false)}
        statusText={
          sent
            ? "A crisis responder from our team has also been notified and will reach out to you directly."
            : "Notifying a crisis responder..."
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  inlineBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(185,28,28,0.1)",
    borderWidth: 1, borderColor: "rgba(185,28,28,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  fab: {
    position: "absolute",
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#B91C1C",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
