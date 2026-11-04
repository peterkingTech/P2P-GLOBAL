import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator } from "react-native";
import colors from "@/constants/colors";
import { AppButton } from "@/components/ui";
import { apiRequest } from "@/lib/apiClient";
import { confirmAction } from "@/lib/alerts";

// ADMIN — ACCESS & AUDIT (migration 238). The administrators, their roles and
// open sessions; suspending or reactivating (with a reason, ending their
// sessions at once); inviting a new administrator as a SEPARATE identity (its
// own email — never a peer's — and two-step verification); and the
// append-only audit. The server checks admins.view / admins.manage /
// audit.view; nobody can change their own access.

interface Account { userId: string; displayName: string; roles: string[]; status: string; identityKind: string; mfaRequired: boolean; lastSessionAt: string | null; openSessions: number }
interface Entry { id: string; at: string; admin_role: string | null; action: string; target_type: string | null; reason: string | null }
const ROLES = ["super_admin", "admin_supervisor", "admin_content", "admin_translation", "admin_moderation", "admin_verification", "admin_help", "admin_username", "admin_marketing", "admin_church", "admin_zone", "admin_national", "admin_finance"];

export default function AdminAccess() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [invite, setInvite] = useState({ email: "", name: "", role: "admin_content" });

  const load = useCallback(async () => {
    const [a, b] = await Promise.allSettled([apiRequest<{ accounts: Account[] }>("/admin-identity/accounts"), apiRequest<{ entries: Entry[] }>("/admin-identity/audit?limit=50")]);
    if (a.status === "fulfilled") setAccounts(a.value.accounts); else setError((a.reason as Error).message);
    if (b.status === "fulfilled") setEntries(b.value.entries);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = (a: Account, status: "active" | "suspended") => {
    if (!reason.trim()) { setNotice("Write the reason first — it is kept in the audit."); return; }
    confirmAction(status === "suspended" ? `Suspend ${a.displayName}?` : `Reactivate ${a.displayName}?`, status === "suspended" ? "Their admin sessions end at once. Their peer account (if any) is not affected." : "They can open admin sessions again.", async () => {
      try { await apiRequest(`/admin-identity/accounts/${a.userId}`, { method: "PUT", body: JSON.stringify({ status, reason: reason.trim() }) }); setNotice(status === "suspended" ? "Suspended." : "Reactivated."); setReason(""); await load(); }
      catch (e) { setNotice((e as Error).message); }
    }, { confirmLabel: status === "suspended" ? "Suspend" : "Reactivate", destructive: status === "suspended" });
  };
  const sendInvite = async () => {
    if (!reason.trim()) { setNotice("Write the reason first — it is kept in the audit."); return; }
    try {
      await apiRequest("/admin-identity/accounts", { method: "POST", body: JSON.stringify({ email: invite.email.trim(), displayName: invite.name.trim(), roles: [invite.role], reason: reason.trim() }) });
      setNotice(`Invitation sent to ${invite.email.trim()}. They set their own password, then two-step verification.`); setInvite({ email: "", name: "", role: "admin_content" }); setReason(""); await load();
    } catch (e) { setNotice((e as Error).message); }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.h1} accessibilityRole="header">Access & Audit</Text>
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text style={s.meta}>{error}</Text> : null}
      <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="Reason for any change (kept in the audit)" placeholderTextColor={colors.textMuted} accessibilityLabel="Reason for the change" />

      <View style={s.card}>
        <Text style={s.h2} accessibilityRole="header">Administrators</Text>
        {!accounts && !error ? <ActivityIndicator color={colors.accentGreen} /> : null}
        {accounts?.map((a) => (
          <View key={a.userId} style={s.item}>
            <Text style={s.name}>{a.displayName} <Text style={s.meta}>· {a.roles.join(", ")}</Text></Text>
            <Text style={s.meta}>
              {a.status}{a.identityKind === "legacy_shared" ? " · shares a peer account (to be separated)" : " · separate admin identity"}{a.mfaRequired ? " · two-step verification" : ""}
              {a.lastSessionAt ? ` · last session ${new Date(a.lastSessionAt).toLocaleDateString()}` : ""}{a.openSessions ? ` · ${a.openSessions} open` : ""}
            </Text>
            <View style={s.row}>
              {a.status === "active" ? <AppButton label="Suspend" size="sm" variant="tertiary" onPress={() => setStatus(a, "suspended")} /> : <AppButton label="Reactivate" size="sm" variant="secondary" onPress={() => setStatus(a, "active")} />}
            </View>
          </View>
        ))}
      </View>

      <View style={s.card}>
        <Text style={s.h2} accessibilityRole="header">Invite an administrator</Text>
        <Text style={s.meta}>A separate admin identity with its own email address (not a peer's). No peer profile is created.</Text>
        <TextInput style={s.input} value={invite.email} onChangeText={(email) => setInvite((v) => ({ ...v, email }))} placeholder="Email" autoCapitalize="none" keyboardType="email-address" placeholderTextColor={colors.textMuted} accessibilityLabel="Email" />
        <TextInput style={s.input} value={invite.name} onChangeText={(name) => setInvite((v) => ({ ...v, name }))} placeholder="Name" placeholderTextColor={colors.textMuted} accessibilityLabel="Name" />
        <View style={s.row}>
          {ROLES.map((r) => <AppButton key={r} label={r.replace("admin_", "").replace("_", " ")} size="sm" variant={invite.role === r ? "primary" : "tertiary"} onPress={() => setInvite((v) => ({ ...v, role: r }))} accessibilityLabel={`${r.replace(/_/g, " ")}${invite.role === r ? ", selected" : ""}`} />)}
        </View>
        <AppButton label="Send invitation" size="sm" disabled={!invite.email.trim() || !invite.name.trim()} onPress={sendInvite} />
      </View>

      <View style={s.card}>
        <Text style={s.h2} accessibilityRole="header">Audit</Text>
        <Text style={s.meta}>Append-only: entries can't be changed or deleted.</Text>
        {!entries ? <Text style={s.meta}>Not available for your role.</Text> : !entries.length ? <Text style={s.meta}>No entries yet.</Text> : entries.map((e) => (
          <Text key={e.id} style={s.entry}>{new Date(e.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {e.admin_role ?? "system"} · {e.action}{e.target_type ? ` · ${e.target_type}` : ""}{e.reason ? ` — ${e.reason}` : ""}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  content: { padding: 16, gap: 14, paddingBottom: 80 },
  h1: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.textDark },
  h2: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.textDark },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMuted, lineHeight: 18 },
  notice: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.accentGreen },
  card: { padding: 14, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, gap: 8 },
  item: { gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.borderBeige },
  input: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, paddingHorizontal: 10, color: colors.textDark, fontFamily: "Inter_400Regular", backgroundColor: colors.card },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  entry: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMid, lineHeight: 18 },
});
