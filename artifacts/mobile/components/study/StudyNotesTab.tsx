import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from "react-native";
import { useData, UserNote } from "@/contexts/DataContext";
import type { useStudySession } from "@/hooks/useStudySession";

// Study Together C4/C6 — lesson-scoped personal notes. Strictly personal:
// this only ever reads/writes the CURRENT user's own p2p_user_notes rows
// (RLS is owner-only), same as the existing /notes screen — Group Study
// Together gives everyone the SAME lesson context, never a shared note.
// Extends the existing Notes system (p2p_user_notes + DataContext.addNote/
// updateNote/getMyNotes) rather than creating a second notes table.
// Supports multiple notes per lesson (not forced to one), per spec.
export function StudyNotesTab({ session }: { session: ReturnType<typeof useStudySession> }) {
  const { getMyNotes, addNote, updateNote } = useData();
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const lessonId = session.lesson?.id;
  const moduleId = session.lesson?.moduleId;

  const load = useCallback(async () => {
    if (!lessonId) return;
    setLoading(true);
    const all = await getMyNotes();
    setNotes(all.filter((n) => n.lessonId === lessonId));
    setLoading(false);
  }, [lessonId, getMyNotes]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!draft.trim() || !lessonId) return;
    setSaving(true);
    const error = await addNote(null, draft.trim(), { lessonId, moduleId, studySessionId: session.sessionId ?? undefined });
    setSaving(false);
    if (!error) { setDraft(""); load(); }
  }

  function startEdit(note: UserNote) {
    setEditingId(note.id);
    setEditDraft(note.body);
  }

  async function handleSaveEdit(id: string) {
    if (!editDraft.trim()) return;
    setEditSaving(true);
    const error = await updateNote(id, editDraft.trim());
    setEditSaving(false);
    if (!error) { setEditingId(null); load(); }
  }

  if (!lessonId) return null;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={styles.hint}>Personal notes for this lesson — visible only to you, even in a group session.</Text>

      <View style={styles.composeBox}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="What I learned… questions to revisit… things to apply…"
          placeholderTextColor="rgba(255,255,255,0.4)"
          multiline
        />
        <TouchableOpacity style={[styles.saveBtn, (!draft.trim() || saving) && styles.saveBtnDisabled]} onPress={handleSave} disabled={!draft.trim() || saving}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Add Note</Text>}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#1D9E75" />
      ) : notes.length === 0 ? (
        <Text style={styles.emptyText}>No notes yet for this lesson.</Text>
      ) : (
        notes.map((n) => (
          <View key={n.id} style={styles.noteCard}>
            {editingId === n.id ? (
              <>
                <TextInput style={styles.editInput} value={editDraft} onChangeText={setEditDraft} multiline autoFocus />
                <View style={styles.editRow}>
                  <TouchableOpacity style={styles.editCancelBtn} onPress={() => setEditingId(null)}>
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editSaveBtn} onPress={() => handleSaveEdit(n.id)} disabled={editSaving || !editDraft.trim()}>
                    {editSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.noteBody}>{n.body}</Text>
                <View style={styles.noteFooter}>
                  <Text style={styles.noteDate}>
                    {n.updatedAt !== n.createdAt ? `Updated ${new Date(n.updatedAt).toLocaleDateString()}` : new Date(n.createdAt).toLocaleDateString()}
                  </Text>
                  <TouchableOpacity onPress={() => startEdit(n)}>
                    <Text style={styles.editLink}>Edit</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hint: { color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  composeBox: { backgroundColor: "#1A241E", borderRadius: 14, padding: 12, gap: 10 },
  input: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 70, textAlignVertical: "top" },
  saveBtn: { backgroundColor: "#1D9E75", borderRadius: 10, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  emptyText: { color: "rgba(255,255,255,0.5)", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 16 },
  noteCard: { backgroundColor: "#141F19", borderRadius: 12, padding: 14, gap: 6 },
  noteBody: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  noteFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  noteDate: { color: "rgba(255,255,255,0.4)", fontSize: 11, fontFamily: "Inter_400Regular" },
  editLink: { color: "#1D9E75", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  editInput: { color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 60, textAlignVertical: "top" },
  editRow: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  editCancelBtn: { paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center" },
  editCancelText: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: "Inter_500Medium" },
  editSaveBtn: { backgroundColor: "#1D9E75", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 60, alignItems: "center" },
});