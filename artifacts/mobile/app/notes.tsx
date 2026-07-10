import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, ActivityIndicator } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, UserNote } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function Notes() {
  const insets = useSafeAreaInsets();
  const { getMyNotes, addNote, deleteNote } = useData();
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotes(await getMyNotes());
    setLoading(false);
  }, [getMyNotes]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!body.trim()) return;
    setSaving(true);
    const err = await addNote(title.trim() || null, body.trim());
    setSaving(false);
    if (!err) {
      setTitle(""); setBody(""); setModalOpen(false);
      load();
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "My Notes" }} />
      <View style={styles.container}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={colors.primaryGreen} />
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(n) => n.id}
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="document-text-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>You haven't written any notes yet.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={{ flex: 1 }}>
                  {!!item.title && <Text style={styles.title}>{item.title}</Text>}
                  <Text style={styles.body}>{item.body}</Text>
                  <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
                <TouchableOpacity onPress={async () => { await deleteNote(item.id); load(); }}>
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
              <Text style={styles.sheetTitle}>New Note</Text>
              <TouchableOpacity onPress={() => setModalOpen(false)}><Ionicons name="close" size={20} color={colors.textMid} /></TouchableOpacity>
            </View>
            <TextInput style={styles.input} placeholder="Title (optional)" placeholderTextColor={colors.textMuted} value={title} onChangeText={setTitle} />
            <TextInput style={[styles.input, styles.textarea]} placeholder="Write your note..." placeholderTextColor={colors.textMuted} value={body} onChangeText={setBody} multiline numberOfLines={5} />
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save Note</Text>}
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
  title: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  body: { fontSize: 13, color: colors.textMid, marginTop: 4, fontFamily: "Inter_400Regular", lineHeight: 18 },
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
  textarea: { minHeight: 100, textAlignVertical: "top" },
  saveBtn: { backgroundColor: colors.primaryGreen, borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold" },
});
