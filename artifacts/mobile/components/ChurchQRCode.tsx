import React, { useRef, useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import ViewShot from "react-native-view-shot";
import * as Sharing from "expo-sharing";
// expo-media-library has no web implementation (ExpoMediaLibraryNext is a
// native-only module) — its top-level code throws immediately if loaded on
// web, crashing the whole app there since this component is reachable from
// the route tree. Gating the require behind a runtime Platform check (same
// pattern as components/CompletionCard.tsx) means the module's code never
// executes on web, since MediaLibrary is only ever called from handleSave
// below, itself gated the same way.
const MediaLibrary = Platform.OS !== "web" ? (require("expo-media-library") as typeof import("expo-media-library")) : null;
import { shareChurchInvite } from "@/lib/sharing";
import colors from "@/constants/colors";

import { useSheetWidth } from "@/hooks/useLayout";
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";
interface ChurchQRCodeProps {
  church: { name: string; city: string | null; country: string; inviteLink: string; inviteCode: string };
}

// Same capture/share/save pattern as CompletionCard.tsx (ViewShot +
// expo-sharing + expo-media-library with a permission check) — reused
// rather than reinvented.
export function ChurchQRCode({ church }: ChurchQRCodeProps) {
  const sheetWidth = useSheetWidth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<"share" | "save" | null>(null);
  const shotRef = useRef<ViewShot>(null);

  async function captureImage(): Promise<string | null> {
    try {
      const uri = await shotRef.current?.capture?.();
      return uri ?? null;
    } catch {
      return null;
    }
  }

  async function handleSave() {
    if (!MediaLibrary) {
      showAlert("Not available", "Saving to Photos isn't supported on web. Try Share instead.");
      return;
    }
    setBusy("save");
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        showAlert("Permission needed", "Allow photo access to save the QR code.");
        return;
      }
      const uri = await captureImage();
      if (!uri) throw new Error("Could not capture the QR code");
      await MediaLibrary.saveToLibraryAsync(uri);
      showAlert("Saved", "QR code saved to your photos.");
    } catch (e: any) {
      showAlert("Couldn't save", e.message ?? "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  // Reuses the same text/link share sheet as the existing "Share Invite
  // Link" button elsewhere in the church flow, rather than sharing the raw
  // QR image — keeps the share message (Romans 15:7 quote + link + code)
  // consistent regardless of which button someone taps.
  async function handleShare() {
    setBusy("share");
    try {
      await shareChurchInvite({ name: church.name, inviteLink: church.inviteLink, city: church.city ?? "", country: church.country });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AppButton label="Show QR Code" onPress={() => setVisible(true)} variant="outline" icon="grid-outline" palette="fixedLight" />

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, sheetWidth]}>
            <View style={styles.header}>
              <Text style={styles.title}>Church Invite QR</Text>
              <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" hitSlop={10} onPress={() => setVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }}>
              <View style={styles.qrCard}>
                <Text style={styles.churchName}>{church.name}</Text>
                {(church.city || church.country) && (
                  <Text style={styles.churchLocation}>{[church.city, church.country].filter(Boolean).join(" · ")}</Text>
                )}
                <View style={styles.qrWrap}>
                  <QRCode
                    value={church.inviteLink}
                    size={200}
                    color="#0D1117"
                    backgroundColor="#FFFFFF"
                    logo={require("../assets/images/icon.png")}
                    logoSize={36}
                    logoBackgroundColor="#FFFFFF"
                    logoBorderRadius={8}
                  />
                </View>
                <Text style={styles.scanLabel}>Scan to join, or use code:</Text>
                <View style={styles.codeBox}><Text style={styles.codeText}>{church.inviteCode}</Text></View>
                <Text style={styles.branding}>P2P Global Kingdom School</Text>
                <Text style={styles.verse}>"Accept one another" — Romans 15:7</Text>
              </View>
            </ViewShot>

            <Text style={styles.instructions}>
              Members scan this with their phone camera to join your church community instantly.
            </Text>

            <View style={styles.actions}>
              <AppButton label="Save to Photos" onPress={handleSave} variant="outline" icon="download-outline" disabled={busy !== null} loading={busy === "save"} style={{ flex: 1 }} palette="fixedLight" />
              <AppButton label="Share" onPress={handleShare} icon="share-outline" disabled={busy !== null} loading={busy === "share"} style={{ flex: 1 }} palette="fixedLight" />
            </View>

            <Text style={styles.printTip}>💡 Save and print this QR code to display in your church</Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 12, height: 46,
  },
  triggerText: { color: colors.accentGreen, fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, alignItems: "center", width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  qrCard: {
    backgroundColor: "#fff", borderRadius: 20, padding: 24, alignItems: "center",
    borderWidth: 1, borderColor: colors.borderBeige, width: 280,
  },
  churchName: { fontSize: 17, fontWeight: "700", color: colors.textDark, textAlign: "center", fontFamily: "Inter_700Bold" },
  churchLocation: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  qrWrap: { marginVertical: 18 },
  scanLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  codeBox: { backgroundColor: colors.lightCream, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 6 },
  codeText: { fontSize: 13, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  branding: { fontSize: 11, color: colors.textMuted, marginTop: 16, fontFamily: "Inter_600SemiBold" },
  verse: { fontSize: 10, color: colors.textMuted, fontStyle: "italic", marginTop: 2, fontFamily: "Inter_400Regular" },
  instructions: { fontSize: 12, color: colors.textMuted, textAlign: "center", marginTop: 16, lineHeight: 17, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 10, marginTop: 16, width: "100%" },
  printTip: { fontSize: 11, color: colors.textMuted, textAlign: "center", marginTop: 14, marginBottom: 4, fontFamily: "Inter_400Regular" },
});