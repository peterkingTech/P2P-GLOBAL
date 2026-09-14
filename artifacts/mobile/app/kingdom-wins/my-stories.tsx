import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getMyKingdomWins, updateKingdomWin, deleteKingdomWin, KINGDOM_CATEGORY_LABELS, type KingdomWin } from "@/lib/kingdomWinsApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function MyKingdomWinsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [entries, setEntries] = useState<KingdomWin[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setEntries(await getMyKingdomWins()); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handlePublish(id: string) {
    try { await updateKingdomWin(id, { status: "published" }); load(); }
    catch (e: any) { showAlert("Couldn't publish", e.message ?? "Please try again."); }
  }
  function handleDelete(id: string) {
    Alert.alert("Delete this story?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await deleteKingdomWin(id); load(); } catch (e: any) { showAlert("Couldn't delete", e.message ?? "Please try again."); } } },
    ]);
  }

  const drafts = entries.filter((e) => e.status === "draft" || e.status === "submitted");
  const published = entries.filter((e) => e.status === "published");
  const other = entries.filter((e) => e.status === "rejected" || e.status === "removed");

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>My Stories</Text>
        <TouchableOpacity onPress={() => router.push("/kingdom-wins/create" as any)}>
          <Ionicons name="add-circle" size={24} color={c.accentGreen} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={c.accentGreen} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
          <Text style={styles.sectionHeading}>Drafts</Text>
          {drafts.length === 0 ? <Text style={styles.emptyText}>No drafts.</Text> : drafts.map((e) => (
            <View key={e.id} style={styles.card}>
              <TouchableOpacity onPress={() => router.push(`/kingdom-wins/${e.id}` as any)}>
                <Text style={styles.cardTitle}>{e.title}</Text>
                <Text style={styles.cardMeta}>{KINGDOM_CATEGORY_LABELS[e.category]} · {e.status}</Text>
              </TouchableOpacity>
              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => handlePublish(e.id)}>
                  <Text style={styles.actionBtnText}>Publish</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtnDanger} onPress={() => handleDelete(e.id)}>
                  <Text style={styles.actionBtnDangerText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <Text style={styles.sectionHeading}>Published</Text>
          {published.length === 0 ? <Text style={styles.emptyText}>Nothing published yet.</Text> : published.map((e) => (
            <TouchableOpacity key={e.id} style={styles.card} onPress={() => router.push(`/kingdom-wins/${e.id}` as any)}>
              <Text style={styles.cardTitle}>{e.title}</Text>
              <Text style={styles.cardMeta}>{KINGDOM_CATEGORY_LABELS[e.category]} · Published</Text>
            </TouchableOpacity>
          ))}

          {other.length > 0 && (
            <>
              <Text style={styles.sectionHeading}>Removed / Rejected</Text>
              {other.map((e) => (
                <View key={e.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{e.title}</Text>
                  <Text style={styles.cardMeta}>{e.status}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    sectionHeading: { fontSize: 12, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },
    emptyText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 14, marginBottom: 8, gap: 8 },
    cardTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardMeta: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_500Medium", marginTop: 2 },
    cardActions: { flexDirection: "row", gap: 8 },
    actionBtn: { backgroundColor: c.primaryGreen, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    actionBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
    actionBtnDanger: { borderWidth: 1, borderColor: "#c0392b", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    actionBtnDangerText: { color: "#c0392b", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  });
}
