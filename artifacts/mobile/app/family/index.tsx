import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  getMyFamily, createFamily, respondToFamilyInvitation,
  startFamilyWorship, getFamilyPrayerRequests,
  type MyFamilyResponse, type FamilyPrayerRequest,
} from "@/lib/familyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const ROLE_LABEL: Record<string, string> = {
  shepherd: "Family Shepherd", co_shepherd: "Co-Shepherd", adult: "Adult", teen: "Teen", child: "Child",
};

// The Family landing page — a short overview and two doors (Members,
// Prayer), not a page that also duplicates each of their full contents.
// Real-device audit: the previous version put the entire member list and
// the entire prayer list directly on this screen, which read as
// cluttered/duplicated once a user also opened either of those areas —
// there was nowhere else those exact lists lived, so "duplicated" meant
// "crammed onto one screen." Splitting it out is the actual fix.
export default function FamilyScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<MyFamilyResponse | null>(null);
  const [openPrayerCount, setOpenPrayerCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [startingWorship, setStartingWorship] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getMyFamily();
      setData(res);
      if (res.family) {
        const prayers = await getFamilyPrayerRequests(res.family.id);
        setOpenPrayerCount(prayers.filter((p: FamilyPrayerRequest) => p.status === "open").length);
      } else {
        setOpenPrayerCount(0);
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

  async function handleStartWorship() {
    if (!data?.family) return;
    setStartingWorship(true);
    try {
      const session = await startFamilyWorship(data.family.id);
      router.push({ pathname: "/family/worship/[sessionId]", params: { sessionId: session.id } } as any);
    } catch (e: any) {
      showAlert("Couldn't start", e.message ?? "Please try again.");
    } finally {
      setStartingWorship(false);
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
              <Text style={styles.emptyText}>Create a family to gather for Family Media, share prayer requests, and grow together.</Text>
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
            {data.pendingInvitations.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>INVITATIONS</Text>
                {data.pendingInvitations.map((inv) => (
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

            <View style={styles.headerCard}>
              <Text style={styles.familyName}>{data.family.name}</Text>
              <Text style={styles.familySub}>{data.members.length} member{data.members.length === 1 ? "" : "s"}</Text>
              <TouchableOpacity style={styles.worshipBtn} onPress={handleStartWorship} disabled={startingWorship}>
                {startingWorship ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Text style={styles.worshipBtnIcon}>📺</Text>
                    <Text style={styles.worshipBtnText}>Start Family Media</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.navRow} onPress={() => router.push("/family/members" as any)} accessibilityRole="button">
              <View style={styles.navRowIcon}><Ionicons name="people" size={20} color={c.primaryGreen} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navRowTitle}>Family Members</Text>
                <Text style={styles.navRowSub}>{data.members.length} member{data.members.length === 1 ? "" : "s"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.navRow} onPress={() => router.push("/family/prayer" as any)} accessibilityRole="button">
              <View style={styles.navRowIcon}><Text style={{ fontSize: 18 }}>🙏</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navRowTitle}>Family Prayer</Text>
                <Text style={styles.navRowSub}>{openPrayerCount > 0 ? `${openPrayerCount} open request${openPrayerCount === 1 ? "" : "s"}` : "No open requests"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40, gap: 14 },

    emptyCard: {
      backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.borderBeige,
      padding: 22, alignItems: "center", gap: 8,
    },
    emptyTitle: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
    emptyText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19, marginBottom: 8 },

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

    section: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 6,
    },
    sectionTitle: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 6 },

    inviteCard: { backgroundColor: c.lightCream, borderRadius: 12, padding: 14, marginBottom: 8 },
    inviteText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },

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

    navRow: {
      flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderRadius: 16,
      borderWidth: 1, borderColor: c.borderBeige, padding: 16,
    },
    navRowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center" },
    navRowTitle: { fontSize: 15, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    navRowSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  });
}
