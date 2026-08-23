import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform, Alert } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { ChooseLessonSheet } from "@/components/study/ChooseLessonSheet";
import type { StudyLessonMeta } from "@/hooks/useStudySession";

// New Journal reflection — the one genuinely new piece of My Discipleship
// Journal. Free-form, prompts are suggestions only (spec explicitly says
// don't force every prompt), and the optional lesson link reuses
// ChooseLessonSheet's existing browse UI in initialMode="browse" rather
// than building a second curriculum picker.

const PROMPTS = [
  "What has God been teaching you recently?",
  "What are you currently struggling to apply?",
  "What has changed since your last reflection?",
  "What are you grateful for in your discipleship journey?",
  "What do you want to grow in next?",
  "What lesson do you find yourself returning to?",
];

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function NewReflectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { addReflection } = useData();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [linkedLesson, setLinkedLesson] = useState<StudyLessonMeta | null>(null);
  const [lessonPickerOpen, setLessonPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!content.trim() || saving) return;
    setSaving(true);
    const err = await addReflection({ prompt: selectedPrompt, content: content.trim(), linkedLessonId: linkedLesson?.id ?? null });
    setSaving(false);
    if (err) { showAlert("Couldn't save reflection", err); return; }
    router.back();
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>New Reflection</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        {!selectedPrompt ? (
          <>
            <Text style={s.sectionLabel}>Choose a prompt, or write freely</Text>
            {PROMPTS.map((p) => (
              <TouchableOpacity key={p} style={s.promptCard} onPress={() => setSelectedPrompt(p)}>
                <Text style={s.promptCardText}>{p}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.freeWriteBtn} onPress={() => setSelectedPrompt("")}>
              <Text style={s.freeWriteBtnText}>Write Freely (No Prompt)</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {selectedPrompt !== "" && (
              <View style={s.chosenPromptCard}>
                <Text style={s.chosenPromptText}>{selectedPrompt}</Text>
                <TouchableOpacity onPress={() => setSelectedPrompt(null)}>
                  <Text style={s.changePromptText}>Change</Text>
                </TouchableOpacity>
              </View>
            )}
            <TextInput
              style={s.textarea}
              placeholder="Write your reflection..."
              placeholderTextColor={colors.textMuted}
              value={content}
              onChangeText={setContent}
              multiline
              autoFocus
            />

            <TouchableOpacity style={s.linkRow} onPress={() => setLessonPickerOpen(true)}>
              <Ionicons name="book-outline" size={18} color={colors.accentGreen} />
              <Text style={s.linkRowText}>
                {linkedLesson ? `Linked: ${linkedLesson.title}` : "Link a Kingdom School lesson (optional)"}
              </Text>
              {linkedLesson && (
                <TouchableOpacity onPress={() => setLinkedLesson(null)}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={[s.saveBtn, !content.trim() && s.saveBtnDisabled]} onPress={handleSave} disabled={!content.trim() || saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save Reflection</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <ChooseLessonSheet
        visible={lessonPickerOpen}
        onClose={() => setLessonPickerOpen(false)}
        initialMode="browse"
        onChooseLesson={(lesson) => { setLinkedLesson(lesson); setLessonPickerOpen(false); }}
      />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { paddingHorizontal: 16, paddingTop: 20 },

    sectionLabel: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", marginBottom: 12 },
    promptCard: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 10 },
    promptCardText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium", lineHeight: 20 },
    freeWriteBtn: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
    freeWriteBtnText: { color: c.accentGreen, fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

    chosenPromptCard: {
      backgroundColor: "rgba(29,158,117,0.08)", borderWidth: 1, borderColor: "rgba(29,158,117,0.25)",
      borderRadius: 14, padding: 14, marginBottom: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10,
    },
    chosenPromptText: { flex: 1, fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    changePromptText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },

    textarea: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14,
      padding: 16, minHeight: 180, textAlignVertical: "top", fontSize: 15, color: c.textDark,
      fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 14,
    },
    linkRow: {
      flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card,
      borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, padding: 13, marginBottom: 20,
    },
    linkRowText: { flex: 1, fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular" },

    saveBtn: { backgroundColor: c.primaryGreen, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}