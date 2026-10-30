import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { startPeerCall, buildCallRouteParams } from "@/lib/callStart";
import { getFamilyDetail, inviteToFamily, removeFamilyMember, type FamilyDetailResponse, type FamilyMember } from "@/lib/familyApi";
import { FamilyMemberList } from "@/components/family/FamilyMemberList";
import { FamilyInvitePanel } from "@/components/family/FamilyInvitePanel";
import { AppButton } from "@/components/ui";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Scoped to one familyId (passed via route params from app/family/[familyId].tsx)
// — a member of several families sees each family's own independent roster here.
// The roster comes only from GET /family/:familyId (active members of THIS
// family, members-only); tapping a person opens their public profile, which
// applies its own privacy rules. Voice/video call buttons on each row use the
// app's existing call flow (lib/callStart — the same one app/family/calls.tsx
// uses; eligibility is enforced server-side by p2p_start_direct_conversation).
export default function FamilyMembersScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<FamilyDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [callingUserId, setCallingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!familyId) return;
    try {
      setData(await getFamilyDetail(familyId));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load this Family Circle. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
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

  async function handleCall(member: FamilyMember, callType: "audio" | "video") {
    if (!profile?.id || callingUserId) return;
    setCallingUserId(member.userId);
    try {
      const result = await startPeerCall({
        supabase, currentUserId: profile.id, otherUserId: member.userId, callType, onAlert: showAlert,
      });
      if (!result) return;
      router.push({
        pathname: callType === "video" ? "/call/video" : "/call/audio",
        params: buildCallRouteParams({
          channelName: result.channelName, otherUserId: member.userId, otherUserName: member.name,
          callType, callId: result.incomingCallId, conversationId: result.conversationId, callLogId: result.callLogId,
        }),
      } as any);
    } finally {
      setCallingUserId(null);
    }
  }

  function handleRemoveMember(m: FamilyMember) {
    if (!familyId) return;
    Alert.alert(`Remove ${m.name}?`, "They can be invited again later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive", onPress: async () => {
          try { await removeFamilyMember(familyId, m.userId); await load(); }
          catch (e: any) { showAlert("Couldn't remove this person", e.message ?? "Please try again."); }
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "People" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        <FamilyMemberList
          members={data?.members ?? null}
          myId={profile?.id}
          canManage={!!data?.canManage}
          loading={loading}
          error={error}
          query={query}
          onQueryChange={setQuery}
          onOpenProfile={(path) => router.push(path as any)}
          onRemove={handleRemoveMember}
          onRetry={() => { setLoading(true); load(); }}
          onCall={handleCall}
          callingUserId={callingUserId}
        />

        {data?.canManage ? (
          <View style={[styles.inviteCard]}>
            <Text style={styles.inviteTitle}>Invite someone</Text>
            <View style={styles.inviteRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginTop: 0 }]}
                placeholder="Invite by @username"
                placeholderTextColor={c.textMuted}
                value={inviteUsername}
                onChangeText={setInviteUsername}
                autoCapitalize="none"
                accessibilityLabel="Username to invite"
              />
              <AppButton label="Invite" onPress={handleInvite} disabled={inviting || !inviteUsername.trim()} loading={inviting} accessibilityLabel="Invite" />
            </View>
          </View>
        ) : null}

        {data?.canManage && familyId ? (
          <FamilyInvitePanel
            familyId={familyId}
            familyName={/family\s+circle/i.test(data.family.name ?? "") ? data.family.name : `${data.family.name} Family Circle`}
            onMembersChanged={load}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40, gap: 12 },
    inviteCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16 },
    inviteTitle: { fontSize: 13, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 8 },
    input: {
      width: "100%", backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      paddingHorizontal: 14, minHeight: 44, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 10,
    },
    inviteRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  });
}
