import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform, Alert } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, JournalReflection } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

// Reflection chain view — shows the FULL history (spec §15: never
// overwrite). The original reflection and every later "Reflection Update"
// are separate, permanent rows (p2p_journal_reflections, migrations/082);
// "Reflect Again" only ever inserts a new row via addReflectionUpdate,
// never edits an existing one.

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function ReflectionChainScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reflectionId, revisit } = useLocalSearchParams<{ reflectionId: string; revisit?: string }>();
  const { getMyReflections, addReflectionUpdate } = useData();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [chain, setChain] = useState<JournalReflection[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(revisit === "true");
  const [updateText, setUpdateText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const all = await getMyReflections();
    setChain(all.filter((r) => r.rootId === reflectionId).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    setLoading(false);
  }, [getMyReflections, reflectionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const original = chain[0] ?? null;
  const latest = chain[chain.length - 1] ?? null;

  async function handleAddUpdate() {
    if (!updateText.trim() || !reflectionId || !latest || saving) return;
    setSaving(true);
    const err = await addReflectionUpdate(reflectionId, latest.id, updateText.trim());
    setSaving(false);
    if (err) { showAlert("Couldn't save update", err); return; }
    setUpdateText("");
    setComposerOpen(false);
    load();
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Reflection</Text>
      </View>

      {loading ? (
        <View style={s.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : !original ? (
        <View style={s.centerFill}><Text style={s.errorText}>This reflection couldn't be found.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          {original.prompt && <Text style={s.promptText}>{original.prompt}</Text>}
          {original.linkedLessonTitle && (
            <View style={s.linkedChip}>
              <Ionicons name="book-outline" size={12} color={colors.accentGreen} />
              <Text style={s.linkedChipText}>{original.linkedLessonTitle}</Text>
            </View>
          )}

          {chain.map((entry, i) => (
            <View key={entry.id} style={s.entryCard}>
              <Text style={s.entryLabel}>{i === 0 ? "REFLECTION" : "REFLECTION UPDATE"}</Text>
              <Text style={s.entryDate}>
                {new Date(entry.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
              </Text>
              <Text style={s.entryContent}>{entry.content}</Text>
            </View>
          ))}

          {composerOpen ? (
            <View style={s.composerCard}>
              <Text style={s.composerLabel}>What has changed since you wrote this?</Text>
              <TextInput
                style={s.composerInput}
                placeholder="Write an update..."
                placeholderTextColor={colors.textMuted}
                value={updateText}
                onChangeText={setUpdateText}
                multiline
                autoFocus
              />
              <View style={s.composerActionsRow}>
                <TouchableOpacity style={s.composerCancelBtn} onPress={() => { setComposerOpen(false); setUpdateText(""); }}>
                  <Text style={s.composerCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.composerSaveBtn, !updateText.trim() && s.composerSaveBtnDisabled]} onPress={handleAddUpdate} disabled={!updateText.trim() || saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.composerSaveText}>Save Update</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={s.reflectAgainBtn} onPress={() => setComposerOpen(true)}>
              <Ionicons name="refresh" size={16} color={colors.primaryGreen} />
              <Text style={s.reflectAgainBtnText}>Reflect Again</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
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
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
    errorText: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular" },
    scroll: { paddingHorizontal: 16, paddingTop: 20 },

    promptText: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", lineHeight: 24, marginBottom: 8 },
    linkedChip: {
      flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
      backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 16,
    },
    linkedChipText: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },

    entryCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 14 },
    entryLabel: { fontSize: 10, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
    entryDate: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2, marginBottom: 10 },
    entryContent: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 21 },

    reflectAgainBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 13, marginTop: 4,
    },
    reflectAgainBtnText: { color: c.accentGreen, fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

    composerCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginTop: 4 },
    composerLabel: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
    composerInput: {
      backgroundColor: c.lightCream, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
      padding: 12, minHeight: 100, textAlignVertical: "top", fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular",
    },
    composerActionsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    composerCancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    composerCancelText: { color: c.textMid, fontSize: 13, fontFamily: "Inter_600SemiBold" },
    composerSaveBtn: { flex: 1, backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    composerSaveBtnDisabled: { opacity: 0.5 },
    composerSaveText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  });
}