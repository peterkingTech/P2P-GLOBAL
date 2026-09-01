import React from "react";
import { StyleSheet, TouchableOpacity, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// "You Are Not Alone" (a modal listing crisis-line phone numbers) has been
// removed — those numbers were unverified placeholders
// ("[INSERT REGIONAL CRISIS LINE]" etc.), not real, region-appropriate
// contacts, and shipping them would have been unsafe. This button's actual
// job — submitting a real, tier="crisis" p2p_help_requests row that pages a
// crisis-responder admin (see the trg_notify_on_help_request trigger) — is
// independent, functioning infrastructure and is preserved unchanged; it
// now just confirms with a plain alert instead of opening that modal.
// Deferred: a future pass should replace this with verified,
// country/region-aware crisis contacts and real dialing.
export function HelpButton({ variant = "fab" }: { variant?: "fab" | "inline" }) {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const { submitHelpRequest } = useData();

  if (!isAuthenticated) return null;

  async function handlePress() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const err = await submitHelpRequest({ tier: "crisis" });
    if (err) showAlert("Couldn't send", "Please try again.");
    else showAlert("Help is on the way", "A crisis responder from our team has been notified and will reach out to you directly.");
  }

  return (
    <TouchableOpacity
      style={variant === "fab" ? [styles.fab, { bottom: insets.bottom + (Platform.OS === "web" ? 24 : 90) }] : styles.inlineBtn}
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityLabel="I need help now"
    >
      <Ionicons name="heart" size={variant === "fab" ? 22 : 20} color={variant === "fab" ? "#fff" : "#B91C1C"} />
    </TouchableOpacity>
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
