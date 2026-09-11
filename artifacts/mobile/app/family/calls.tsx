import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { getFamilyDetail, type FamilyDetailResponse, type FamilyMember } from "@/lib/familyApi";
import { startPeerCall, buildCallRouteParams } from "@/lib/callStart";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const ROLE_LABEL: Record<string, string> = {
  shepherd: "Family Shepherd", co_shepherd: "Co-Shepherd", adult: "Adult", teen: "Teen", child: "Child",
};

// Direct person-to-person calling with the SELECTED family's members —
// distinct from Voice (the live communication tool inside a Gathering's
// Study Workspace). Reuses the existing, already-fixed call system
// end-to-end (lib/callStart.ts's startPeerCall -> /calls/peer-channel ->
// p2p_start_direct_conversation -> /calls/start -> app/call/audio|video.tsx
// -> the unmodified Agora hooks) — this screen adds zero new call
// architecture, it only lists who's eligible to call from the currently
// selected family and launches the same flow every other "Call" button in
// this app already uses. Eligibility itself is enforced server-side by
// p2p_start_direct_conversation (migration 127 added a same-family branch
// there), never assumed client-side.
export default function FamilyCallsScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  // Uses "fid" (not "familyId") as the query-param key here: passing a
  // param literally named "familyId" to this route collides with the
  // sibling dynamic segment app/family/[familyId].tsx — Expo Router
  // resolves the ambiguity by substituting the literal path segment
  // ("calls") as the value instead of the intended id, so every request
  // this screen made hit GET /family/calls (a 403, since no family is
  // literally named "calls") rather than the real family. Renaming the
  // param sidesteps the collision entirely.
  const { fid: familyId } = useLocalSearchParams<{ fid: string }>();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<FamilyDetailResponse | null>(null);
  const [callingUserId, setCallingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!familyId) return;
    try { setData(await getFamilyDetail(familyId)); }
    catch (e: any) { showAlert("Couldn't load this family", e.message ?? "Please try again."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [familyId]);

  useEffect(() => { load(); }, [load]);

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

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "Calls" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  const otherMembers = (data?.members ?? []).filter((m) => m.userId !== profile?.id);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Calls" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        <Text style={styles.hint}>Start a voice or video call with family members.</Text>

        {otherMembers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="call-outline" size={32} color={c.textMuted} />
            <Text style={styles.emptyText}>No other members in this family yet.</Text>
          </View>
        ) : (
          <View style={styles.section}>
            {otherMembers.map((m) => {
              const isCalling = callingUserId === m.userId;
              return (
                <View key={m.id} style={styles.memberRow}>
                  <View style={styles.avatarFallback}><Text style={styles.avatarInitial}>{m.name.charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{m.name}</Text>
                    <Text style={styles.memberRole}>{ROLE_LABEL[m.role] ?? m.role}</Text>
                  </View>
                  {isCalling ? (
                    <ActivityIndicator color={c.primaryGreen} size="small" style={{ marginRight: 8 }} />
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.callBtn} onPress={() => handleCall(m, "audio")} disabled={!!callingUserId}
                        accessibilityRole="button" accessibilityLabel={`Voice call ${m.name}`}
                      >
                        <Ionicons name="call" size={18} color={c.primaryGreen} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.callBtn} onPress={() => handleCall(m, "video")} disabled={!!callingUserId}
                        accessibilityRole="button" accessibilityLabel={`Video call ${m.name}`}
                      >
                        <Ionicons name="videocam" size={18} color={c.primaryGreen} />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40, gap: 14 },
    hint: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular" },

    emptyCard: {
      backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige,
      padding: 22, alignItems: "center", gap: 8,
    },
    emptyText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center" },

    section: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 6 },
    memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
    avatarFallback: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    avatarInitial: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
    memberName: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    memberRole: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    callBtn: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: c.lightCream,
      alignItems: "center", justifyContent: "center", marginLeft: 8,
    },
  });
}
