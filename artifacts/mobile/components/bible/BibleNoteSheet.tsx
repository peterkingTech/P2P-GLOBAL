import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";

// Write or edit a private note on a Bible passage. Notes are the author's
// own (owner-only RLS); nothing here is shared with a group or a leader.
interface Props {
  visible: boolean;
  reference: string;
  initial: { title: string | null; body: string } | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (title: string | null, body: string) => void;
  onDelete?: () => void;
}

export const NOTE_BODY_MAX = 10000;
export const NOTE_TITLE_MAX = 200;

export default function BibleNoteSheet({ visible, reference, initial, saving, error, onClose, onSave, onDelete }: Props) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(initial?.title ?? "");
    setBody(initial?.body ?? "");
    setConfirmDelete(false);
  }, [visible, initial]);

  const canSave = body.trim().length > 0 && !saving;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} accessibilityRole="header">{initial ? "Edit note" : "New note"}</Text>
              <Text style={styles.ref}>{reference}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close without saving">
              <Ionicons name="close" size={22} color={c.textDark} />
            </TouchableOpacity>
          </View>
          <View style={styles.privacy}>
            <Ionicons name="lock-closed" size={13} color={c.textMuted} />
            <Text style={styles.privacyText}>Private — only you can see your notes.</Text>
          </View>
          <TextInput style={styles.titleInput} placeholder="Title (optional)" placeholderTextColor={c.textMuted} value={title}
            onChangeText={setTitle} maxLength={NOTE_TITLE_MAX} accessibilityLabel="Note title" />
          <TextInput style={styles.bodyInput} placeholder="What is God showing you in this passage?" placeholderTextColor={c.textMuted}
            value={body} onChangeText={setBody} multiline maxLength={NOTE_BODY_MAX} textAlignVertical="top" accessibilityLabel="Note" autoFocus={!initial} />
          {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
          <View style={styles.actions}>
            {onDelete ? (
              confirmDelete ? (
                <TouchableOpacity onPress={onDelete} style={[styles.btn, styles.deleteConfirm]} disabled={saving} accessibilityRole="button" accessibilityLabel="Confirm delete note">
                  <Text style={styles.deleteConfirmText}>Delete note?</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => setConfirmDelete(true)} style={styles.btn} disabled={saving} accessibilityRole="button" accessibilityLabel="Delete note">
                  <Ionicons name="trash-outline" size={18} color={c.textMuted} />
                </TouchableOpacity>
              )
            ) : <View />}
            <TouchableOpacity onPress={() => onSave(title.trim() || null, body.trim())} disabled={!canSave}
              style={[styles.btn, styles.save, !canSave && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Save note" accessibilityState={{ disabled: !canSave, busy: saving }}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28, gap: 10 },
    header: { flexDirection: "row", alignItems: "flex-start" },
    title: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    ref: { fontSize: 14, color: c.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 2 },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginTop: -8, marginRight: -8 },
    privacy: { flexDirection: "row", alignItems: "center", gap: 6 },
    privacyText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    titleInput: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 12, color: c.textDark, fontSize: 15, fontFamily: "Inter_500Medium" },
    bodyInput: { minHeight: 160, maxHeight: 320, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, padding: 12, color: c.textDark, fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
    error: { color: "#DC2626", fontSize: 13, fontFamily: "Inter_500Medium" },
    actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    btn: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    save: { backgroundColor: c.accentGreen, paddingHorizontal: 28 },
    saveText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
    deleteConfirm: { backgroundColor: "rgba(220,38,38,0.12)" },
    deleteConfirmText: { color: "#DC2626", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  });
}
