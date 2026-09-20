import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, Alert, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import ViewShot from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  createRoomInvitation, revokeRoomInvitation, getVerifiedCachedRoomInvitation, cacheRoomInvitation,
  clearCachedRoomInvitation, buildRoomInvitationLink, getRoomInvitationStatus, type RoomType,
} from "@/lib/roomInvitationsApi";
import { shareRoomInvitation } from "@/lib/sharing";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// P2P Rooms — Share panel (Stage D). Host-only entry point wired into the
// three supported room screens. Every action here is explicit — nothing
// is ever generated or shared automatically. Regeneration always warns
// that it revokes the current link first (never silent), matching the
// approved design; this panel never invents its own join/Agora logic —
// it only creates/shows/revokes an invitation record.
type PanelState =
  | { kind: "checking" }
  | { kind: "no_invitation" }
  | { kind: "exists_uncached"; invitationId: string }
  | { kind: "active"; token: string; invitationId: string }
  | { kind: "error"; message: string };

interface Props {
  visible: boolean; onClose: () => void;
  roomType: RoomType; roomId: string; roomTitle: string; statusLine: string;
}

export default function ShareRoomPanel({ visible, onClose, roomType, roomId, roomTitle, statusLine }: Props) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [state, setState] = useState<PanelState>({ kind: "checking" });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savingQR, setSavingQR] = useState(false);
  const shotRef = useRef<ViewShot>(null);

  const check = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const existing = await getVerifiedCachedRoomInvitation(roomType, roomId);
      if (existing) { setState({ kind: "active", token: existing.token, invitationId: existing.invitationId }); return; }
      // No cached token on THIS device — but an active invitation might
      // still exist server-side (created elsewhere, or the cache was
      // cleared). Check before ever showing a plain "Generate Link" button,
      // so a truly-first generation is never confused with one that would
      // silently revoke an invitation this device just doesn't know about.
      const status = await getRoomInvitationStatus(roomType, roomId);
      setState(status.hasActive && status.invitationId ? { kind: "exists_uncached", invitationId: status.invitationId } : { kind: "no_invitation" });
    } catch (e: any) {
      setState({ kind: "error", message: e?.message ?? "Couldn't check invitation status." });
    }
  }, [roomType, roomId]);

  useEffect(() => { if (visible) check(); }, [visible, check]);

  async function handleGenerate() {
    setBusy(true);
    try {
      const created = await createRoomInvitation(roomType, roomId);
      await cacheRoomInvitation(created);
      setState({ kind: "active", token: created.token, invitationId: created.invitationId });
    } catch (e: any) {
      showAlert("Couldn't create invitation", e.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleRegenerate() {
    const doIt = async () => {
      setBusy(true);
      try {
        const created = await createRoomInvitation(roomType, roomId);
        await cacheRoomInvitation(created);
        setState({ kind: "active", token: created.token, invitationId: created.invitationId });
      } catch (e: any) {
        showAlert("Couldn't generate a new link", e.message ?? "Please try again.");
      } finally {
        setBusy(false);
      }
    };
    const title = "Generate a new link?";
    const message = "The current invitation link will stop working immediately. Anyone who still has the old link won't be able to use it.";
    if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) doIt(); return; }
    Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Generate New Link", style: "destructive", onPress: doIt }]);
  }

  function handleRevoke() {
    if (state.kind !== "active") return;
    const invitationId = state.invitationId;
    const doIt = async () => {
      setBusy(true);
      try {
        await revokeRoomInvitation(invitationId);
        await clearCachedRoomInvitation(roomType, roomId);
        setState({ kind: "no_invitation" });
      } catch (e: any) {
        showAlert("Couldn't revoke invitation", e.message ?? "Please try again.");
      } finally {
        setBusy(false);
      }
    };
    const title = "Revoke this invitation?";
    const message = "The link will stop working immediately.";
    if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) doIt(); return; }
    Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Revoke", style: "destructive", onPress: doIt }]);
  }

  async function handleCopy() {
    if (state.kind !== "active") return;
    await Clipboard.setStringAsync(buildRoomInvitationLink(state.token));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (state.kind !== "active") return;
    try { await shareRoomInvitation({ title: roomTitle, roomType, statusLine, token: state.token }); }
    catch { /* user cancelled the share sheet — not an error */ }
  }

  // Same capture/save pattern as components/ChurchQRCode.tsx (ViewShot +
  // expo-media-library, permission-checked) — reused, not reinvented.
  async function handleSaveQR() {
    setSavingQR(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) { showAlert("Permission needed", "Allow photo access to save the QR code."); return; }
      const uri = await shotRef.current?.capture?.();
      if (!uri) throw new Error("Could not capture the QR code");
      await MediaLibrary.saveToLibraryAsync(uri);
      showAlert("Saved", "QR code saved to your photos.");
    } catch (e: any) {
      showAlert("Couldn't save", e.message ?? "Something went wrong.");
    } finally {
      setSavingQR(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Share Room</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close" accessibilityRole="button">
              <Ionicons name="close" size={22} color={c.textDark} />
            </TouchableOpacity>
          </View>

          <Text style={styles.roomTitle}>{roomTitle}</Text>
          <Text style={styles.statusLine}>{statusLine}</Text>

          {state.kind === "checking" && (
            <View style={styles.centerBox}><ActivityIndicator color={c.accentGreen} /></View>
          )}

          {state.kind === "error" && (
            <View style={styles.centerBox}>
              <Text style={styles.errorText}>{state.message}</Text>
              <TouchableOpacity style={styles.secondaryBtn} onPress={check}><Text style={styles.secondaryBtnText}>Try Again</Text></TouchableOpacity>
            </View>
          )}

          {state.kind === "no_invitation" && (
            <View style={styles.centerBox}>
              <Ionicons name="link-outline" size={28} color={c.textMuted} />
              <Text style={styles.helperText}>No active invitation yet.</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleGenerate} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Generate Link</Text>}
              </TouchableOpacity>
            </View>
          )}

          {state.kind === "exists_uncached" && (
            <View style={styles.centerBox}>
              <Ionicons name="alert-circle-outline" size={28} color={c.textMuted} />
              <Text style={styles.helperText}>An invitation link already exists for this room, but this device doesn't have it saved.</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleRegenerate} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Generate New Link</Text>}
              </TouchableOpacity>
              <Text style={styles.errorText}>This will revoke the existing link.</Text>
            </View>
          )}

          {state.kind === "active" && (
            <View style={{ gap: 10 }}>
              <View style={styles.statusPill}>
                <Ionicons name="checkmark-circle" size={14} color={c.accentGreen} />
                <Text style={styles.statusPillText}>Invitation Active</Text>
              </View>

              <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }}>
                <View style={styles.qrCard}>
                  <Text style={styles.qrCardTitle} numberOfLines={2}>{roomTitle}</Text>
                  <View style={styles.qrWrap}>
                    <QRCode
                      value={buildRoomInvitationLink(state.token)}
                      size={200}
                      color="#0D1117"
                      backgroundColor="#FFFFFF"
                      logo={require("../assets/images/icon.png")}
                      logoSize={36}
                      logoBackgroundColor="#FFFFFF"
                      logoBorderRadius={8}
                    />
                  </View>
                  <Text style={styles.scanLabel}>Scan with a phone camera to open the invitation</Text>
                </View>
              </ViewShot>

              <TouchableOpacity style={styles.saveQrBtn} onPress={handleSaveQR} disabled={savingQR}>
                {savingQR ? <ActivityIndicator color={c.accentGreen} size="small" /> : (
                  <>
                    <Ionicons name="download-outline" size={15} color={c.accentGreen} />
                    <Text style={styles.saveQrBtnText}>Save QR to Photos</Text>
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={handleCopy} disabled={busy}>
                  <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={c.accentGreen} />
                  <Text style={styles.actionBtnText}>{copied ? "Copied" : "Copy Link"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={handleShare} disabled={busy}>
                  <Ionicons name="share-outline" size={16} color={c.accentGreen} />
                  <Text style={styles.actionBtnText}>Share</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.authNote}>Joining still requires a P2P account and applicable authorization — sharing this link does not grant access by itself.</Text>

              <View style={styles.dangerRow}>
                <TouchableOpacity style={styles.linkBtn} onPress={handleRegenerate} disabled={busy}>
                  <Text style={styles.linkBtnText}>Generate New Link</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkBtn} onPress={handleRevoke} disabled={busy}>
                  <Text style={[styles.linkBtnText, { color: "#B91C1C" }]}>Revoke</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10 },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderBeige, alignSelf: "center", marginBottom: 12 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    headerTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    roomTitle: { fontSize: 19, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 14 },
    statusLine: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 2, marginBottom: 8 },
    centerBox: { alignItems: "center", gap: 10, paddingVertical: 24 },
    helperText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    errorText: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_500Medium", textAlign: "center" },
    statusPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
    statusPillText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold" },
    // High-contrast, plain white card — deliberately no decorative
    // background/texture behind the QR code itself, so it stays reliably
    // scannable (matches components/ChurchQRCode.tsx's identical choice).
    qrCard: { backgroundColor: "#fff", borderRadius: 18, paddingVertical: 20, paddingHorizontal: 16, alignItems: "center", borderWidth: 1, borderColor: c.borderBeige, alignSelf: "center", width: 260 },
    qrCardTitle: { fontSize: 14, color: "#0D1117", fontFamily: "Inter_700Bold", textAlign: "center" },
    qrWrap: { marginVertical: 14 },
    scanLabel: { fontSize: 11, color: "#6b7280", fontFamily: "Inter_400Regular", textAlign: "center" },
    saveQrBtn: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", alignSelf: "center", paddingVertical: 6 },
    saveQrBtnText: { color: c.accentGreen, fontSize: 12, fontFamily: "Inter_600SemiBold" },
    actionsRow: { flexDirection: "row", gap: 10 },
    actionBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 12 },
    actionBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
    authNote: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 4 },
    dangerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
    linkBtn: { paddingVertical: 8 },
    linkBtnText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    primaryBtn: { backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center", minWidth: 180 },
    primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    secondaryBtn: { borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20 },
    secondaryBtnText: { color: c.accentGreen, fontSize: 13, fontFamily: "Inter_700Bold" },
  });
}
