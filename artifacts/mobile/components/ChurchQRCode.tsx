import React, { useRef, useState } from "react";
import { View, Text, TouchableOpacity, Modal, Alert, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import ViewShot from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import { shareChurchInvite } from "@/lib/sharing";
import colors from "@/constants/colors";

interface ChurchQRCodeProps {
  church: { name: string; city: string | null; country: string; inviteLink: string; inviteCode: string };
}

// Same capture/share/save pattern as CompletionCard.tsx (ViewShot +
// expo-sharing + expo-media-library with a permission check) — reused
// rather than reinvented.
export function ChurchQRCode({ church }: ChurchQRCodeProps) {
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
    setBusy("save");
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to save the QR code.");
        return;
      }
      const uri = await captureImage();
      if (!uri) throw new Error("Could not capture the QR code");
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("Saved", "QR code saved to your photos.");
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Something went wrong.");
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
      <TouchableOpacity style={styles.trigger} onPress={() => setVisible(true)}>
        <Ionicons name="grid-outline" size={18} color={colors.accentGreen} />
        <Text style={styles.triggerText}>Show QR Code</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Church Invite QR</Text>
              <TouchableOpacity onPress={() => setVisible(false)}>
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
              Members scan this with their phone camera to join your church grove instantly.
            </Text>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtnOutline} onPress={handleSave} disabled={busy !== null}>
                {busy === "save" ? <ActivityIndicator color={colors.accentGreen} size="small" /> : (
                  <>
                    <Ionicons name="download-outline" size={16} color={colors.accentGreen} />
                    <Text style={styles.actionBtnOutlineText}>Save to Photos</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={handleShare} disabled={busy !== null}>
                {busy === "share" ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Ionicons name="share-outline" size={16} color="#fff" />
                    <Text style={styles.actionBtnText}>Share</Text>
                  </>
                )}
              </TouchableOpacity>
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
  sheet: { backgroundColor: colors.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, alignItems: "center" },
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
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.accentGreen, borderRadius: 12, height: 46,
  },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  actionBtnOutline: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 12, height: 46,
  },
  actionBtnOutlineText: { color: colors.accentGreen, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  printTip: { fontSize: 11, color: colors.textMuted, textAlign: "center", marginTop: 14, marginBottom: 4, fontFamily: "Inter_400Regular" },
});