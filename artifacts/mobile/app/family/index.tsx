import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  getMyFamilies, createFamily, respondToFamilyInvitation,
  type MyFamiliesResponse,
} from "@/lib/familyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const ROLE_LABEL: Record<string, string> = {
  shepherd: "Family Shepherd", co_shepherd: "Co-Shepherd", adult: "Adult", teen: "Teen", child: "Child",
};

// MY FAMILIES — a user may belong to several families at once (a Member of
// one, a Shepherd of another), so this is a list of independent family
// relationships, not one combined family. Tapping a card opens that
// family's own detail screen (app/family/[familyId].tsx); nothing here
// merges data across families.
export default function MyFamiliesScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<MyFamiliesResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getMyFamilies());
    } catch (e: any) {
      showAlert("Couldn't load your families", e.message ?? "Please try again.");
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
      const family = await createFamily(newFamilyName.trim());
      setNewFamilyName("");
      setShowCreateForm(false);
      await load();
      router.push({ pathname: "/family/[familyId]", params: { familyId: family.id } } as any);
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

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "My Families" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  const families = data?.families ?? [];
  const pendingInvitations = data?.pendingInvitations ?? [];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "My Families" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        {pendingInvitations.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>INVITATIONS</Text>
            {pendingInvitations.map((inv) => (
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

        {families.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionTitle}>MY FAMILIES</Text>
            {families.map(({ family, myRole, memberCount }) => (
              <TouchableOpacity
                key={family.id}
                style={styles.familyCard}
                onPress={() => router.push({ pathname: "/family/[familyId]", params: { familyId: family.id } } as any)}
                accessibilityRole="button"
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.familyCardName}>{family.name}</Text>
                  <Text style={styles.familyCardSub}>
                    {memberCount} member{memberCount === 1 ? "" : "s"} · {ROLE_LABEL[myRole] ?? myRole}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {families.length === 0 && pendingInvitations.length === 0 && (
          <View style={styles.emptyCard}>
            <Ionicons name="people-circle-outline" size={40} color={c.primaryGreen} />
            <Text style={styles.emptyTitle}>No families yet</Text>
            <Text style={styles.emptyText}>Create a family to gather for Family Media, share prayer requests, and grow together.</Text>
          </View>
        )}

        {showCreateForm ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>CREATE A FAMILY</Text>
            <TextInput
              style={styles.input}
              placeholder="Family name (e.g. The Johnsons)"
              placeholderTextColor={c.textMuted}
              value={newFamilyName}
              onChangeText={setNewFamilyName}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setShowCreateForm(false); setNewFamilyName(""); }}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtnSmall} onPress={handleCreateFamily} disabled={creating || !newFamilyName.trim()}>
                {creating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnSmallText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.addFamilyRow} onPress={() => setShowCreateForm(true)} accessibilityRole="button">
            <Ionicons name="add-circle-outline" size={20} color={c.primaryGreen} />
            <Text style={styles.addFamilyText}>Start another family</Text>
          </TouchableOpacity>
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
    emptyText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

    input: {
      width: "100%", backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 10,
    },
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

    familyCard: {
      flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderRadius: 16,
      borderWidth: 1, borderColor: c.borderBeige, padding: 16,
    },
    familyCardName: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    familyCardSub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

    addFamilyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12 },
    addFamilyText: { fontSize: 14, fontWeight: "600", color: c.primaryGreen, fontFamily: "Inter_600SemiBold" },
  });
}
