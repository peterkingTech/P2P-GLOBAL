import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { AppButton } from "@/components/ui";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";

// One screen's error stays in that screen. Every Stack screen is wrapped (components/PageFrame.tsx), so
// if a screen fails to render, people see a calm message on THAT screen with "Try again" and "Go back" —
// the tabs, other screens and their data keep working. The app-wide boundary in app/_layout.tsx remains
// only as the last resort (providers, navigation itself). The real error is still logged for us.
function ScreenFallback({ error, resetError }: ErrorFallbackProps) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const back = () => {
    resetError();
    if (router.canGoBack()) router.back(); else router.replace("/(tabs)" as never);
  };
  return (
    <View style={[styles.wrap, { backgroundColor: c.lightCream }]} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle-outline" size={40} color={c.textMuted} />
      <Text style={[styles.title, { color: c.textDark }]}>This screen couldn't open</Text>
      <Text style={[styles.body, { color: c.textMid }]}>Something on this page didn't load properly. Everything else in P2P Global still works.</Text>
      <View style={styles.actions}>
        <AppButton label="Try again" icon="refresh" onPress={resetError} />
        <AppButton label="Go back" variant="secondary" icon="arrow-back" onPress={back} />
      </View>
      {__DEV__ ? <Text style={[styles.dev, { color: c.textMuted }]} selectable>{error.message}</Text> : null}
    </View>
  );
}

export function ScreenErrorBoundary({ routeName, children }: { routeName: string; children: React.ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={ScreenFallback}
      onError={(error, stack) => console.error(`[ScreenErrorBoundary] ${routeName}:`, error, "\nComponent stack:", stack)}
    >
      {children}
    </ErrorBoundary>
  );
}

/** For screens a Stack's screenLayout doesn't reach (each main tab): the same per-screen protection. */
export function withScreenBoundary<P extends object>(Screen: React.ComponentType<P>, routeName: string) {
  const Guarded = (props: P) => <ScreenErrorBoundary routeName={routeName}><Screen {...props} /></ScreenErrorBoundary>;
  Guarded.displayName = `Guarded(${Screen.displayName ?? Screen.name ?? routeName})`;
  return Guarded;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 28 },
  title: { fontSize: 19, fontFamily: "Inter_700Bold", textAlign: "center" },
  body: { fontSize: 14.5, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, maxWidth: 420 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 6 },
  dev: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },
});
