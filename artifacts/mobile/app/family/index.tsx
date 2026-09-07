import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import {
  getMyFamily, createFamily, inviteToFamily, respondToFamilyInvitation, removeFamilyMember,
  startFamilyWorship, getFamilyPrayerRequests, createFamilyPrayerRequest, updateFamilyPrayerRequestStatus,
  type MyFamilyResponse, type FamilyPrayerRequest,
} from "@/lib/familyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const ROLE_LABEL: Record<string, string> = {
  shepherd: "Family Shepherd", co_shepherd: "Co-Shepherd", adult: "Adult", teen: "Teen", child: "Child",
};

export default function FamilyScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<MyFamilyResponse | null>(null);
  const [prayerRequests, setPrayerRequests] = useState<FamilyPrayerRequest[]>([]);
  const [creating, setCreating] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [newPrayer, setNewPrayer] = useState("");
  const [newPrayerPrivate, setNewPrayerPrivate] = useState(false);
  const [startingWorship, setStartingWorship] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getMyFamily();
      setData(res);
      if (res.family) {
        const prayers = await getFamilyPrayerRequests(res.family.id);
        setPrayerRequests(prayers);
      } else {
        setPrayerRequests([]);
      }
    } catch (e: any) {
      showAlert("Couldn't load your family", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreateFamily() {
    if (!newFamilyName.trim()) return;
    setCreating(true);
    try {
      await createFamily(newFamilyName.trim());
      setNewFamilyName("");
      await load();
    } catch (e: any) {
      showAlert("Couldn't create family", e.message ?? "Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRespond(invitationId: string, action: "accept" | "decline") {
    try {
      await respondToFamilyInvitation(invitationId, action);
      await load();
    } catch (e: any) {
      showAlert("Couldn't respond", e.message ?? "Please try again.");
    }
  }

  async function handleInvite() {
    if (!data?.family || !inviteUsername.trim()) return;
    setInviting(true);
    try {
      await inviteToFamily(data.family.id, inviteUsername.trim());
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
    if (!data?.family) return;
    const familyId = data.family.id;
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

  async function handleStartWorship() {
    if (!data?.family) return;
    setStartingWorship(true);
    try {
      const session = await startFamilyWorship(data.family.id);
      router.push({ pathname: "/family/worship/[sessionId]", params: { sessionId: session.id } } as any);
    } catch (e: any) {
      showAlert("Couldn't start worship", e.message ?? "Please try again.");
    } finally {
      setStartingWorship(false);
    }
  }

  async function handleAddPrayer() {
    if (!data?.family || !newPrayer.trim()) return;
    try {
      await createFamilyPrayerRequest(data.family.id, newPrayer.trim(), newPrayerPrivate ? "private" : "family");
      setNewPrayer("");
      setNewPrayerPrivate(false);
      const prayers = await getFamilyPrayerRequests(data.family.id);
      setPrayerRequests(prayers);
    } catch (e: any) {
      showAlert("Couldn't share this prayer", e.message ?? "Please try again.");
    }
  }

  async function handleMarkPrayed(id: string) {
    if (!data?.family) return;
    try {
      await updateFamilyPrayerRequestStatus(data.family.id, id, "prayed");
      const prayers = await getFamilyPrayerRequests(data.family.id);
      setPrayerRequests(prayers);
    } catch (e: any) {
      showAlert("Couldn't update this prayer", e.message ?? "Please try again.");
    }
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "My Family" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "My Family" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        {!data?.family && (
          <>
            {(data?.pendingInvitations.length ?? 0) > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>INVITATIONS</Text>
                {data!.pendingInvitations.map((inv) => (
                  <View key={inv.id} style={styles.inviteCard}>
                    <Text style={styles.inviteText}>You've been invited to join a family as {ROLE_LABEL[inv.role] ?? inv.role}.</Text>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      <TouchableOpacity style={styles.secondaryBtn} onPress={() => handleRespond(inv.id, "decline")}>
                        <Text style={styles.secondaryBtnText}>Decline</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.primaryBtnSmall} onPress={() => handleRespond(inv.id, "accept")}>
                        <Text style={styles.primaryBtnSmallText}>Accept</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.emptyCard}>
              <Ionicons name="people-circle-outline" size={40} color={c.primaryGreen} />
              <Text style={styles.emptyTitle}>Start your family</Text>
              <Text style={styles.emptyText}>Create a family to gather for Family Worship, share prayer requests, and grow together.</Text>
              <TextInput
                style={styles.input}
                placeholder="Family name (e.g. The Johnsons)"
                placeholderTextColor={c.textMuted}
                value={newFamilyName}
                onChangeText={setNewFamilyName}
              />
              <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateFamily} disabled={creating || !newFamilyName.trim()}>
                {creating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Create Family</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}

        {data?.family && (
          <>
            <View style={styles.headerCard}>
              <Text style={styles.familyName}>{data.family.name}</Text>
              <Text style={styles.familySub}>{data.members.length} member{data.members.length === 1 ? "" : "s"}</Text>
              <TouchableOpacity style={styles.worshipBtn} onPress={handleStartWorship} disabled={startingWorship}>
                {startingWorship ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Text style={styles.worshipBtnIcon}>🕊️</Text>
                    <Text style={styles.worshipBtnText}>Start Family Worship</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>FAMILY</Text>
              {data.members.map((m) => (
                <View key={m.id} style={styles.memberRow}>
                  <View style={styles.avatarFallback}><Text style={styles.avatarInitial}>{m.name.charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{m.name}{m.userId === profile?.id ? " (You)" : ""}</Text>
                    <Text style={styles.memberRole}>{ROLE_LABEL[m.role] ?? m.role}</Text>
                  </View>
                  {data.canManage && m.userId !== profile?.id && m.role !== "shepherd" && (
                    <TouchableOpacity onPress={() => handleRemoveMember(m.userId, m.name)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle-outline" size={20} color={c.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}

              {data.canManage && (
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

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>FAMILY PRAYER</Text>
              {prayerRequests.length === 0 ? (
                <Text style={styles.emptySmallText}>No prayer requests yet.</Text>
              ) : prayerRequests.map((p) => (
                <View key={p.id} style={styles.prayerRow}>
                  <Text style={styles.prayerContent}>🙏 {p.content}</Text>
                  <View style={styles.prayerMetaRow}>
                    <Text style={styles.prayerMeta}>
                      {p.visibility === "private" ? "Only you" : "Shared"} · {p.status === "answered" ? "Answered" : p.status === "prayed" ? "Prayed" : "Open"}
                    </Text>
                    {p.status === "open" && (
                      <TouchableOpacity onPress={() => handleMarkPrayed(p.id)}>
                        <Text style={styles.prayerAction}>Mark prayed</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}

              <TextInput
                style={styles.input}
                placeholder="Share a prayer request..."
                placeholderTextColor={c.textMuted}
                value={newPrayer}
                onChangeText={setNewPrayer}
                multiline
              />
              <View style={styles.inviteRow}>
                <TouchableOpacity style={styles.secondaryBtnSmall} onPress={() => setNewPrayerPrivate((v) => !v)}>
                  <Ionicons name={newPrayerPrivate ? "lock-closed" : "people"} size={14} color={c.accentGreen} />
                  <Text style={styles.secondaryBtnSmallText}>{newPrayerPrivate ? "Private" : "Family"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtnSmall} onPress={handleAddPrayer} disabled={!newPrayer.trim()}>
                  <Text style={styles.primaryBtnSmallText}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40, gap: 16 },

    emptyCard: {
      backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige,
      padding: 22, alignItems: "center", gap: 8,
    },
    emptyTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
    emptyText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19, marginBottom: 8 },
    emptySmallText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", marginBottom: 10 },

    input: {
      width: "100%", backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 10,
    },
    primaryBtn: {
      width: "100%", backgroundColor: c.primaryGreen, borderRadius: 12, alignItems: "center", paddingVertical: 14, marginTop: 12,
    },
    primaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
    primaryBtnSmall: { backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
    primaryBtnSmallText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
    secondaryBtn: { flex: 1, borderWidth: 1.5, borderColor: c.borderBeige, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
    secondaryBtnText: { color: c.textMid, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
    secondaryBtnSmall: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
    secondaryBtnSmallText: { color: c.accentGreen, fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },

    section: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 6,
    },
    sectionTitle: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 6 },

    inviteCard: { backgroundColor: c.lightCream, borderRadius: 12, padding: 14, marginBottom: 8 },
    inviteText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
    inviteRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 10 },

    headerCard: {
      backgroundColor: c.primaryGreen, borderRadius: 18, padding: 20, gap: 4,
    },
    familyName: { fontSize: 20, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    familySub: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
    worshipBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 12, paddingVertical: 13, marginTop: 14,
    },
    worshipBtnIcon: { fontSize: 16 },
    worshipBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

    memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
    avatarFallback: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.accentGreen, alignItems: "center", justifyContent: "center" },
    avatarInitial: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
    memberName: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    memberRole: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },

    prayerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    prayerContent: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
    prayerMetaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
    prayerMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    prayerAction: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}