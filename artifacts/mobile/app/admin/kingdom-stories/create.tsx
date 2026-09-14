import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import colors from "@/constants/colors";
import {
  createKingdomStory, getKingdomStoryCategories, CONTENT_TYPE_LABELS,
  type KingdomStoryCategory, type KingdomStoryContentType,
} from "@/lib/kingdomStoriesApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const CONTENT_TYPES = Object.keys(CONTENT_TYPE_LABELS) as KingdomStoryContentType[];

// Minimal first step: title, body, category, content type. Media, Scripture,
// sources, related links, and publish controls all live in the full editor
// (app/admin/kingdom-stories/[id].tsx) once the story row exists — media
// rows are path-scoped by story id, so the story must be created first.
export default function CreateKingdomStoryScreen() {
  const router = useRouter();
  const [categories, setCategories] = useState<KingdomStoryCategory[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [contentType, setContentType] = useState<KingdomStoryContentType | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { getKingdomStoryCategories().then((c) => { setCategories(c); setLoading(false); }); }, []);

  async function handleCreate() {
    if (!title.trim() || !body.trim() || !categoryId) return;
    setSubmitting(true);
    try {
      const story = await createKingdomStory({ title: title.trim(), body: body.trim(), categoryId, contentType: contentType ?? undefined });
      router.replace(`/admin/kingdom-stories/${story.id}` as any);
    } catch (e: any) {
      showAlert("Couldn't create story", e.message ?? "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 4, paddingBottom: 60 }}>
      <Text style={styles.pageTitle}>New Kingdom Story</Text>
      <Text style={styles.fieldLabel}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. The Moravian Prayer Watch" placeholderTextColor={colors.textMuted} />

      <Text style={styles.fieldLabel}>Story</Text>
      <TextInput style={[styles.input, styles.multiline]} value={body} onChangeText={setBody} multiline placeholder="Tell the story..." placeholderTextColor={colors.textMuted} />

      <Text style={styles.fieldLabel}>Category</Text>
      <View style={styles.chipGrid}>
        {categories.map((cat) => (
          <TouchableOpacity key={cat.id} style={[styles.chip, categoryId === cat.id && styles.chipActive]} onPress={() => setCategoryId(cat.id)}>
            <Text style={[styles.chipText, categoryId === cat.id && styles.chipTextActive]}>{cat.title}{cat.status !== "published" ? ` (${cat.status})` : ""}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Content Type (optional)</Text>
      <View style={styles.chipGrid}>
        {CONTENT_TYPES.map((ct) => (
          <TouchableOpacity key={ct} style={[styles.chip, contentType === ct && styles.chipActive]} onPress={() => setContentType(contentType === ct ? null : ct)}>
            <Text style={[styles.chipText, contentType === ct && styles.chipTextActive]}>{CONTENT_TYPE_LABELS[ct]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.createBtn} onPress={handleCreate} disabled={submitting || !title.trim() || !body.trim() || !categoryId}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create Draft</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.lightCream },
  pageTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 8 },
  fieldLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  multiline: { minHeight: 140, textAlignVertical: "top" },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  chipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  chipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  createBtn: { backgroundColor: colors.primaryGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 24 },
  createBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
});
