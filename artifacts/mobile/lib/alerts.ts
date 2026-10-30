import { Alert, Platform } from "react-native";

// The app's one alert / confirmation helper. React Native's Alert does
// nothing on web, so web uses the browser's own alert/confirm instead —
// every screen used to carry its own copy of this.

/** A message with an OK button. `onDismiss` runs after it is closed. */
export function showAlert(title: string, message?: string, onDismiss?: () => void) {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
    onDismiss?.();
  } else {
    Alert.alert(title, message, onDismiss ? [{ text: "OK", onPress: onDismiss }] : undefined);
  }
}

/** A Cancel / confirm choice; `onConfirm` runs only when the person confirms. */
export function confirmAction(
  title: string,
  message: string,
  onConfirm: () => void,
  { confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false }: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean } = {},
) {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: "cancel" },
    { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: onConfirm },
  ]);
}
