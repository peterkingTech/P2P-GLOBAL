import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, ActivityIndicator } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, UserHighlight } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function Highlights() {
  const insets = useSafeAreaInsets();
  const { getMyHighlights, addHighlight, deleteHighlight } = useData();
  const [items, setItems] = useState<UserHighlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [quote, setQuote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setItems(await getMyHighlights());
    setLoading(false);
  }, [getMyHighlights]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!reference.trim()) return;
    setSaving(true);
    const err = await addHighlight(reference.trim(), quote.trim() || null);
    setSaving(false);
    if (!err) {
      setReference(""); setQuote(""); setModalOpen(false);
      load();
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "My Highlights" }} />
      <View style={styles.container}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={colors.primaryGreen} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(n) => n.id}
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="bookmark-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>You haven't saved any highlights yet.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reference}>{item.reference}</Text>
                  {!!item.quote && <Text style={styles.quote}>"{item.quote}"</Text>}
                  <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
                <TouchableOpacity onPress={async () => { await deleteHighlight(item.id); load(); }}>
                  <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}
          />
        )}
        <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 24 }]} onPress={() => setModalOpen(true)}>
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      </View>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>New Highlight</Text>
              <TouchableOpacity onPress={() => setModalOpen(false)}><Ionicons name="close" size={20} color={colors.textMid} /></TouchableOpacity>
            </View>
            <TextInput style={styles.input} placeholder="Reference (e.g. John 3:16)" placeholderTextColor={colors.textMuted} value={reference} onChangeText={setReference} />
            <TextInput style={[styles.input, styles.textarea]} placeholder="Quote (optional)" placeholderTextColor={colors.textMuted} value={quote} onChangeText={setQuote} multiline numberOfLines={4} />
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save Highlight</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  card: {
    flexDirection: "row", gap: 10, backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 10,
  },
  reference: { fontSize: 14, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  quote: { fontSize: 13, color: colors.textMid, marginTop: 4, fontStyle: "italic", fontFamily: "Inter_400Regular", lineHeight: 18 },
  date: { fontSize: 11, color: colors.textMuted, marginTop: 6, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", gap: 12, marginTop: 60 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  fab: {
    position: "absolute", right: 20, width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.lightCream, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, padding: 12, color: colors.textDark, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 12,
  },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  saveBtn: { backgroundColor: colors.primaryGreen, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
});
