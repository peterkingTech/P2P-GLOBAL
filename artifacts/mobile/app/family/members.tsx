import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { getFamilyDetail, inviteToFamily, removeFamilyMember, type FamilyDetailResponse } from "@/lib/familyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const ROLE_LABEL: Record<string, string> = {
  shepherd: "Family Shepherd", co_shepherd: "Co-Shepherd", adult: "Adult", teen: "Teen", child: "Child",
};

// Scoped to one familyId (passed via route params from app/family/[familyId].tsx)
// — a member of several families sees each family's own independent roster here.
export default function FamilyMembersScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<FamilyDetailResponse | null>(null);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    if (!familyId) return;
    try { setData(await getFamilyDetail(familyId)); }
    catch (e: any) { showAlert("Couldn't load this family", e.message ?? "Please try again."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [familyId]);

  useEffect(() => { load(); }, [load]);

  async function handleInvite() {
    if (!familyId || !inviteUsername.trim()) return;
    setInviting(true);
    try {
      await inviteToFamily(familyId, inviteUsername.trim());
      setInviteUsername("");
      showAlert("Invitation sent", `@${inviteUsername.trim()} has been invited.`);
      await load();
    } catch (e: any) {
      showAlert("Couldn't send invitation", e.message ?? "Please try again.");
    } finally {
      setInviting(false);
    }
  }

  function handleRemoveMember(userId: string, name: string) {
    if (!familyId) return;
    Alert.alert(`Remove ${name}?`, "They can be invited again later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive", onPress: async () => {
          try { await removeFamilyMember(familyId, userId); await load(); }
          catch (e: any) { showAlert("Couldn't remove member", e.message ?? "Please try again."); }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "Members" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Members" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        <View style={styles.section}>
          {(data?.members ?? []).map((m) => (
            <View key={m.id} style={styles.memberRow}>
              <View style={styles.avatarFallback}><Text style={styles.avatarInitial}>{m.name.charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{m.name}{m.userId === profile?.id ? " (You)" : ""}</Text>
                <Text style={styles.memberRole}>{ROLE_LABEL[m.role] ?? m.role}</Text>
              </View>
              {data?.canManage && m.userId !== profile?.id && m.role !== "shepherd" && (
                <TouchableOpacity onPress={() => handleRemoveMember(m.userId, m.name)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle-outline" size={20} color={c.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          {data?.canManage && (
            <View style={styles.inviteRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginTop: 0 }]}
                placeholder="Invite by @username"
                placeholderTextColor={c.textMuted}
                value={inviteUsername}
                onChangeText={setInviteUsername}
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={handleInvite} disabled={inviting || !inviteUsername.trim()}>
                {inviting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnSmallText}>Invite</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40 },
    section: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 6 },
    input: {
      width: "100%", backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 10,
    },
    primaryBtnSmall: { backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
    primaryBtnSmallText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
    inviteRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 10 },
    memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
    avatarFallback: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    avatarInitial: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
    memberName: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    memberRole: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
  });
}
