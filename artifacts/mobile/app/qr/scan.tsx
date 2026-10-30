import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Linking, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { createScanHandler, scannerGate } from "@/lib/qrLinks";
import { AppButton, IconButton } from "@/components/ui";

// Scan a P2P Global QR code. The camera permission is asked only when the
// person taps "Allow camera" (explained first); if it's refused, a pasted
// link does the same job. Only P2P Global codes are opened (lib/qrLinks.ts),
// each into a screen that loads from the server with the normal permission
// checks. A scan never joins, connects or messages anyone by itself.
export default function ScanQrScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  const scanner = useMemo(() => createScanHandler({
    open: (path) => router.replace(path as any),
    onInvalid: (message) => setError(message),
  }), [router]);

  const gate = scannerGate(permission);

  function scanAgain() { setError(null); scanner.reset(); }
  function openPasted() {
    setError(null);
    scanner.reset();
    scanner.handle(pasted);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerBar}>
        <IconButton icon="arrow-back" accessibilityLabel="Go back" onPress={() => router.back()} color={colors.textDark} />
        <Text style={styles.headerTitle}>Scan QR code</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          {gate === "ready" ? (
            <View style={styles.cameraWrap}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={error ? undefined : ({ data }) => { scanner.handle(data); }}
              />
              <View pointerEvents="none" style={styles.frame} />
            </View>
          ) : gate === "checking" ? (
            <View style={styles.cameraPlaceholder} />
          ) : (
            <View style={styles.permissionCard}>
              <Ionicons name="camera-outline" size={32} color={colors.accentGreen} />
              <Text style={styles.permissionTitle}>{gate === "explain" ? "Use your camera to scan" : "Camera access is off"}</Text>
              <Text style={styles.permissionText}>
                {gate === "explain"
                  ? "P2P Global uses the camera only while this screen is open, to read QR codes for profiles and Circles. Nothing is recorded."
                  : "To scan codes, allow camera access for P2P Global in your phone's Settings. You can also paste a link below."}
              </Text>
              <AppButton label={gate === "explain" ? "Allow camera" : "Open Settings"} onPress={() => (gate === "explain" ? void requestPermission() : void Linking.openSettings())} style={{ marginTop: 4 }} />
            </View>
          )}

          {gate === "ready" && !error ? <Text style={styles.hint}>Point your camera at a P2P Global QR code.</Text> : null}

          {error ? (
            <View style={styles.errorBox} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle-outline" size={18} color={colors.textMid} />
              <Text style={styles.errorText}>{error}</Text>
              <AppButton label="Scan again" onPress={scanAgain} variant="tertiary" />
            </View>
          ) : null}

          <Text style={styles.pasteLabel}>Or paste a P2P Global link</Text>
          <View style={styles.pasteRow}>
            <TextInput
              style={styles.pasteInput}
              value={pasted}
              onChangeText={setPasted}
              placeholder="https://… or p2pglobalbiblestudy://…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Paste a P2P Global link"
              onSubmitEditing={openPasted}
              returnKeyType="go"
            />
            <TouchableOpacity style={[styles.openBtn, !pasted.trim() && { opacity: 0.5 }]} onPress={openPasted} disabled={!pasted.trim()} accessibilityRole="button" accessibilityLabel="Open link">
              <Text style={styles.primaryBtnText}>Open</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (c: AppColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.lightCream },
    headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { padding: 20, gap: 12 },
    cameraWrap: { width: "100%", aspectRatio: 1, borderRadius: 20, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
    frame: { width: "62%", aspectRatio: 1, borderRadius: 16, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)" },
    cameraPlaceholder: { width: "100%", aspectRatio: 1, borderRadius: 20, backgroundColor: c.borderBeige },
    permissionCard: { alignItems: "center", gap: 10, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    permissionTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
    permissionText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
    hint: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card },
    errorText: { flex: 1, fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    scanAgainText: { color: c.accentGreen, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
    pasteLabel: { fontSize: 13, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 8 },
    pasteRow: { flexDirection: "row", gap: 8 },
    pasteInput: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, paddingHorizontal: 12, color: c.textDark, backgroundColor: c.card, fontFamily: "Inter_400Regular", fontSize: 14 },
    openBtn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
  });
