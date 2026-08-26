import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useData, UserNote } from "@/contexts/DataContext";
import type { useStudySession } from "@/hooks/useStudySession";

// Study Together C6 — lesson-scoped personal notes. Strictly personal: this
// only ever reads/writes the CURRENT user's own p2p_user_notes rows (RLS is
// owner-only), same as the existing /notes screen — Group Study Together
// gives everyone the SAME lesson context, never a shared note. Extends the
// existing Notes system (p2p_user_notes + DataContext.addNote/getMyNotes)
// rather than creating a second notes table.
export function StudyNotesTab({ session }: { session: ReturnType<typeof useStudySession> }) {
  const { getMyNotes, addNote } = useData();
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

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
            <Text style={styles.noteBody}>{n.body}</Text>
            <Text style={styles.noteDate}>{new Date(n.createdAt).toLocaleDateString()}</Text>
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
  noteDate: { color: "rgba(255,255,255,0.4)", fontSize: 11, fontFamily: "Inter_400Regular" },
});