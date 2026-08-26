import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, UserNote } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function Notes() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const { getMyNotes, addNote, updateNote, deleteNote } = useData();
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  // Opened automatically when reached via My Discipleship Journal's
  // "+ New Entry" -> Personal Note chooser (?compose=true); direct
  // navigation to /notes behaves exactly as before.
  const [modalOpen, setModalOpen] = useState(compose === "true");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

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

  async function handleSaveEdit(id: string) {
    if (!editBody.trim()) return;
    const err = await updateNote(id, editBody.trim());
    if (!err) { setEditingId(null); load(); }
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
                  {/* Study Together C4.4 — lesson context, when this note came from a lesson/Study Together session. */}
                  {!!item.lessonTitle && (
                    <View style={styles.lessonBadge}>
                      <Ionicons name="book-outline" size={11} color={colors.primaryGreen} />
                      <Text style={styles.lessonBadgeText} numberOfLines={1}>{item.lessonTitle}</Text>
                    </View>
                  )}
                  {!!item.title && <Text style={styles.title}>{item.title}</Text>}
                  {editingId === item.id ? (
                    <>
                      <TextInput style={styles.editInput} value={editBody} onChangeText={setEditBody} multiline autoFocus />
                      <View style={styles.editRow}>
                        <TouchableOpacity onPress={() => setEditingId(null)}><Text style={styles.editCancel}>Cancel</Text></TouchableOpacity>
                        <TouchableOpacity style={styles.editSaveBtn} onPress={() => handleSaveEdit(item.id)}>
                          <Text style={styles.editSaveText}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.body}>{item.body}</Text>
                      <View style={styles.footerRow}>
                        <Text style={styles.date}>
                          {item.updatedAt !== item.createdAt ? `Updated ${new Date(item.updatedAt).toLocaleDateString()}` : new Date(item.createdAt).toLocaleDateString()}
                        </Text>
                        <View style={styles.footerActions}>
                          {!!item.lessonId && (
                            <TouchableOpacity onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: item.lessonId! } })}>
                              <Text style={styles.actionLink}>Open Lesson</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity onPress={() => { setEditingId(item.id); setEditBody(item.body); }}>
                            <Text style={styles.actionLink}>Edit</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </>
                  )}
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
  lessonBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  lessonBadgeText: { fontSize: 11, color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  body: { fontSize: 13, color: colors.textMid, marginTop: 4, fontFamily: "Inter_400Regular", lineHeight: 18 },
  date: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  footerActions: { flexDirection: "row", gap: 14 },
  actionLink: { fontSize: 11, color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  editInput: {
    backgroundColor: colors.lightCream, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 8,
    padding: 8, marginTop: 4, color: colors.textDark, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 60, textAlignVertical: "top",
  },
  editRow: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 6, alignItems: "center" },
  editCancel: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  editSaveBtn: { backgroundColor: colors.primaryGreen, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  editSaveText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
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