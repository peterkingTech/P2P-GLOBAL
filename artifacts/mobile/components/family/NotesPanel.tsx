import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { WorshipNote, WorshipScripture } from "@/lib/familyApi";
import { formatScriptureReference } from "@/lib/familyApi";

interface Props {
  visible: boolean;
  onClose: () => void;
  notes: WorshipNote[];
  myUserId: string | undefined;
  currentScripture: WorshipScripture | null;
  onAdd: (content: string, visibility: "shared" | "private", scriptureReference: WorshipScripture | null) => void;
  onDelete: (noteId: string) => void;
}

// Deliberately minimal — this phase prepares the shared/private/
// Scripture-linked notes architecture, not a full notes app: add, list,
// delete-your-own. No editing, no folders, no search.
export default function NotesPanel({ visible, onClose, notes, myUserId, currentScripture, onAdd, onDelete }: Props) {
  const [draft, setDraft] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [attachPassage, setAttachPassage] = useState(false);

  function submit() {
    if (!draft.trim()) return;
    onAdd(draft.trim(), isPrivate ? "private" : "shared", attachPassage && currentScripture ? currentScripture : null);
    setDraft("");
    setAttachPassage(false);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>NOTES</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {notes.length === 0 ? (
              <Text style={styles.emptyText}>No notes yet.</Text>
            ) : (
              notes.map((n) => (
                <View key={n.id} style={styles.noteCard}>
                  <View style={styles.noteHeader}>
                    <Text style={styles.noteAuthor}>{n.authorName}{n.visibility === "private" ? " · Private" : ""}</Text>
                    {n.authorId === myUserId && (
                      <TouchableOpacity onPress={() => onDelete(n.id)}><Ionicons name="trash-outline" size={14} color="rgba(255,255,255,0.5)" /></TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.noteContent}>{n.content}</Text>
                  {n.scriptureReference && <Text style={styles.noteScripture}>{formatScriptureReference(n.scriptureReference)}</Text>}
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.addBox}>
            <TextInput
              style={styles.addInput}
              placeholder="Write a note…"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <View style={styles.addRow}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Private</Text>
                <Switch value={isPrivate} onValueChange={setIsPrivate} />
              </View>
              {currentScripture && (
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Link passage</Text>
                  <Switch value={attachPassage} onValueChange={setAttachPassage} />
                </View>
              )}
              <TouchableOpacity style={styles.addBtn} onPress={submit} disabled={!draft.trim()}>
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#141F19", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "70%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingBottom: 10 },
  title: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6 },

  list: { flex: 1, paddingHorizontal: 16 },
  listContent: { gap: 10, paddingBottom: 10 },
  emptyText: { color: "rgba(255,255,255,0.4)", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 20 },

  noteCard: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 12 },
  noteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  noteAuthor: { color: "#1D9E75", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
  noteContent: { color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  noteScripture: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 4 },

  addBox: { padding: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", gap: 8 },
  addInput: {
    backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular", maxHeight: 100,
  },
  addRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggleLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Inter_400Regular" },
  addBtn: { marginLeft: "auto", backgroundColor: "#1D9E75", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  addBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
