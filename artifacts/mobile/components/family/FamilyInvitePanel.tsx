import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { Avatar } from "@/components/Avatar";
import { QrShareSheet } from "@/components/qr/QrShareSheet";
import { familyInviteQr, type QrSpec } from "@/lib/qrLinks";
import { FAMILY_ROLE_LABEL } from "@/lib/familyMembersModel";
import {
  createFamilyInviteLink, getFamilyJoinRequests, listFamilyInviteLinks, respondToFamilyJoinRequest, revokeFamilyInviteLink,
  type FamilyInviteLink, type FamilyJoinRequest, type LinkRole,
} from "@/lib/familyApi";

function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const ROLES: LinkRole[] = ["adult", "teen", "child"];
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// Shepherd / Co-Shepherd tools for invite QR codes (migration 192): make a
// code for a chosen role, review the requests it brings in, and turn codes
// off. A code never adds anyone by itself — every request is approved here.
// The server enforces all of this; this panel is only shown to managers.
export function FamilyInvitePanel({ familyId, familyName, onMembersChanged }: { familyId: string; familyName: string; onMembersChanged(): void }) {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const [role, setRole] = useState<LinkRole>("adult");
  const [creating, setCreating] = useState(false);
  const [qr, setQr] = useState<QrSpec | null>(null);
  const [requests, setRequests] = useState<FamilyJoinRequest[]>([]);
  const [links, setLinks] = useState<FamilyInviteLink[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([getFamilyJoinRequests(familyId), listFamilyInviteLinks(familyId)]);
      setRequests(r); setLinks(l);
    } catch { /* the panel stays usable; the next refresh retries */ }
  }, [familyId]);
  useEffect(() => { void load(); }, [load]);

  async function createCode() {
    setCreating(true);
    try {
      const link = await createFamilyInviteLink(familyId, role);
      setQr(familyInviteQr({ token: link.token, familyName, expiresAt: link.expiresAt }));
      await load();
    } catch (e: any) {
      notify("Couldn't create a code", e?.message ?? "Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function answer(r: FamilyJoinRequest, action: "approve" | "decline") {
    setBusyId(r.id);
    try {
      await respondToFamilyJoinRequest(familyId, r.id, action);
      await load();
      if (action === "approve") onMembersChanged();
    } catch (e: any) {
      notify("Couldn't update the request", e?.message ?? "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(l: FamilyInviteLink) {
    setBusyId(l.id);
    try { await revokeFamilyInviteLink(familyId, l.id); await load(); }
    catch (e: any) { notify("Couldn't turn off this code", e?.message ?? "Please try again."); }
    finally { setBusyId(null); }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Invite with a QR code</Text>
      <Text style={styles.help}>People who scan it can ask to join. You approve each request. Codes last 7 days.</Text>
      <View style={styles.roleRow} accessibilityRole="radiogroup" accessibilityLabel="Role for people who use this code">
        {ROLES.map((r) => (
          <TouchableOpacity key={r} style={[styles.roleChip, role === r && styles.roleChipOn]} onPress={() => setRole(r)}
            accessibilityRole="radio" accessibilityState={{ checked: role === r }} accessibilityLabel={FAMILY_ROLE_LABEL[r]}>
            <Text style={[styles.roleText, role === r && styles.roleTextOn]}>{FAMILY_ROLE_LABEL[r]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.primaryBtn} onPress={createCode} disabled={creating} accessibilityRole="button" accessibilityLabel="Create invite QR code">
        {creating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Create QR code</Text>}
      </TouchableOpacity>

      {requests.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Requests to join ({requests.length})</Text>
          {requests.map((r) => (
            <View key={r.id} style={styles.row}>
              <Avatar name={r.name} photoUrl={r.avatarUrl} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.rowSub}>As {FAMILY_ROLE_LABEL[r.role]?.toLowerCase() ?? "member"}</Text>
              </View>
              {busyId === r.id ? <ActivityIndicator color={c.accentGreen} /> : (
                <>
                  <TouchableOpacity style={styles.outlineBtn} onPress={() => answer(r, "decline")} accessibilityRole="button" accessibilityLabel={`Decline ${r.name}`}>
                    <Text style={styles.outlineText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallBtn} onPress={() => answer(r, "approve")} accessibilityRole="button" accessibilityLabel={`Approve ${r.name}`}>
                    <Text style={styles.primaryBtnText}>Approve</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {links.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active codes ({links.length})</Text>
          {links.map((l) => (
            <View key={l.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{FAMILY_ROLE_LABEL[l.role]}</Text>
                <Text style={styles.rowSub}>Expires {shortDate(l.expiresAt)} · used {l.useCount} of {l.maxUses}</Text>
              </View>
              {busyId === l.id ? <ActivityIndicator color={c.accentGreen} /> : (
                <TouchableOpacity style={styles.outlineBtn} onPress={() => revoke(l)} accessibilityRole="button" accessibilityLabel={`Turn off ${FAMILY_ROLE_LABEL[l.role]} code`}>
                  <Text style={styles.outlineText}>Turn off</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <Text style={styles.help}>For safety a code is only shown once. Create a new one to show it again.</Text>
        </View>
      ) : null}

      <QrShareSheet spec={qr} visible={qr !== null} onClose={() => setQr(null)} />
    </View>
  );
}

export default FamilyInvitePanel;

const makeStyles = (c: AppColors) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 10 },
    title: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    help: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    roleRow: { flexDirection: "row", gap: 8 },
    roleChip: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    roleChipOn: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.12)" },
    roleText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium" },
    roleTextOn: { color: c.accentGreen, fontWeight: "700", fontFamily: "Inter_700Bold" },
    primaryBtn: { minHeight: 44, borderRadius: 12, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
    section: { marginTop: 6, gap: 8 },
    sectionTitle: { fontSize: 12, fontWeight: "700", color: c.textMid, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    rowName: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    rowSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    outlineBtn: { minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    outlineText: { fontSize: 12, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold" },
    smallBtn: { minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
  });
