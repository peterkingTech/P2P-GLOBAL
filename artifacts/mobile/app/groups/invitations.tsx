import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, IconButton } from "@/components/ui";
import { answerInvitation, myInvitations, type Invitation } from "@/lib/groupsApi";

// Invitations to private groups and Communities. Nothing is joined until the person accepts.
export default function InvitationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [list, setList] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setList((await myInvitations()).invitations); setError(null); } catch (e: any) { setError(e?.message ?? "Couldn't load invitations."); setList([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const answer = async (inv: Invitation, accept: boolean) => {
    setBusy(inv.id); setError(null);
    try {
      const r = await answerInvitation(inv.id, accept);
      if (accept) {
        router.replace((r.type === "community" ? `/groups/community/${r.targetId}` : `/messages/${r.targetId}`) as any);
        return;
      }
      await load();
    } catch (e: any) { setError(e?.message ?? "That didn't work."); }
    finally { setBusy(null); }
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <View style={s.header}>
        <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title}>Invitations</Text>
      </View>
      {list === null ? <ActivityIndicator style={{ marginTop: 40 }} color={c.accentGreen} accessibilityLabel="Loading" /> : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }}>
          {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
          {!list.length ? (
            <View style={s.empty}>
              <Ionicons name="mail-open-outline" size={40} color={c.borderBeige} />
              <Text style={s.muted}>No invitations right now.</Text>
            </View>
          ) : null}
          {list.map((inv) => (
            <View key={inv.id} style={s.card}>
              <View style={s.row}>
                <View style={s.icon}><Ionicons name={inv.type === "community" ? "albums-outline" : "people"} size={20} color={c.primaryGreen} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{inv.name ?? (inv.type === "community" ? "A community" : "A group")}</Text>
                  <Text style={s.hint}>{inv.invitedBy} invited you to this private {inv.type === "community" ? "community" : "group"}.</Text>
                </View>
              </View>
              {inv.description ? <Text style={s.desc}>{inv.description}</Text> : null}
              <View style={s.actions}>
                <View style={{ flex: 1 }}><AppButton label="Decline" variant="secondary" disabled={!!busy} onPress={() => answer(inv, false)} /></View>
                <View style={{ flex: 1 }}><AppButton label="Accept" loading={busy === inv.id} disabled={!!busy} onPress={() => answer(inv, true)} /></View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    empty: { alignItems: "center", gap: 10, paddingTop: 60 },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
    error: { fontSize: 13, color: "#C0392B", fontFamily: "Inter_500Medium" },
    card: { padding: 14, gap: 10, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    row: { flexDirection: "row", gap: 12, alignItems: "center" },
    icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center" },
    name: { fontSize: 15.5, color: c.textDark, fontFamily: "Inter_700Bold" },
    hint: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
    desc: { fontSize: 13.5, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },
    actions: { flexDirection: "row", gap: 10 },
  });
}
