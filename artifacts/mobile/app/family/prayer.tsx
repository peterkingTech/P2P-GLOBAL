import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Alert, Platform, RefreshControl } from "react-native";
import { Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getMyFamily, getFamilyPrayerRequests, createFamilyPrayerRequest, updateFamilyPrayerRequestStatus, type FamilyPrayerRequest } from "@/lib/familyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function FamilyPrayerScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [prayerRequests, setPrayerRequests] = useState<FamilyPrayerRequest[]>([]);
  const [newPrayer, setNewPrayer] = useState("");
  const [newPrayerPrivate, setNewPrayerPrivate] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getMyFamily();
      setFamilyId(res.family?.id ?? null);
      if (res.family) setPrayerRequests(await getFamilyPrayerRequests(res.family.id));
    } catch (e: any) {
      showAlert("Couldn't load prayer requests", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAddPrayer() {
    if (!familyId || !newPrayer.trim()) return;
    try {
      await createFamilyPrayerRequest(familyId, newPrayer.trim(), newPrayerPrivate ? "private" : "family");
      setNewPrayer("");
      setNewPrayerPrivate(false);
      setPrayerRequests(await getFamilyPrayerRequests(familyId));
    } catch (e: any) {
      showAlert("Couldn't share this prayer", e.message ?? "Please try again.");
    }
  }

  async function handleMarkPrayed(id: string) {
    if (!familyId) return;
    try {
      await updateFamilyPrayerRequestStatus(familyId, id, "prayed");
      setPrayerRequests(await getFamilyPrayerRequests(familyId));
    } catch (e: any) {
      showAlert("Couldn't update this prayer", e.message ?? "Please try again.");
    }
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "Family Prayer" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Family Prayer" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        <View style={styles.section}>
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
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40 },
    section: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 6 },
    emptySmallText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", marginBottom: 10 },
    input: {
      width: "100%", backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", marginTop: 10,
    },
    primaryBtnSmall: { backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
    primaryBtnSmallText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
    secondaryBtnSmall: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
    secondaryBtnSmallText: { color: c.accentGreen, fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
    inviteRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 10 },
    prayerRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    prayerContent: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
    prayerMetaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
    prayerMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
    prayerAction: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
  });
}
