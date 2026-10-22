import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import colors from "@/constants/colors";
import {
  getTopic, createTopic, updateTopic, createStoryFromTopic, linkStoryToTopic, unlinkStoryFromTopic,
  getKingdomStoryCategories, editorCategoryOrder, getKingdomStoriesAdminList,
  TOPIC_STATUSES, TOPIC_STATUS_LABELS, TOPIC_PRIORITIES, PRIORITY_LABELS,
  type KingdomStoryTopic, type KingdomStoryCategory, type KingdomStory, type TopicInput,
} from "@/lib/kingdomStoriesApi";

// One catalogue topic (editors): its category, tags, status and research
// fields; its story — start one (an empty draft; nothing is generated) or
// link an existing one — and the reader preview. Unknown facts stay empty:
// period, region and key people are filled in from research, never guessed.
function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function TopicEditorScreen() {
  const router = useRouter();
  const { topicId, category: categoryParam } = useLocalSearchParams<{ topicId: string; category?: string }>();
  const isNew = topicId === "new";
  const [topic, setTopic] = useState<KingdomStoryTopic | null>(null);
  const [categories, setCategories] = useState<KingdomStoryCategory[]>([]);
  const [draft, setDraft] = useState<{ title: string; categoryId?: string }>({ title: "", categoryId: categoryParam });
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [stories, setStories] = useState<KingdomStory[]>([]);
  const [storyQuery, setStoryQuery] = useState("");

  const load = useCallback(async () => {
    if (isNew || !topicId) return;
    try { setTopic(await getTopic(topicId)); }
    catch (e: any) { showAlert("Couldn't load topic", e?.message ?? "Please try again."); }
  }, [topicId, isNew]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { getKingdomStoryCategories().then((c) => setCategories(editorCategoryOrder(c))).catch(() => {}); }, []);

  async function save(input: TopicInput) {
    if (!topic) return;
    setBusy(true);
    try { setTopic(await updateTopic(topic.id, input)); }
    catch (e: any) { showAlert("Couldn't save", e?.message ?? "Please try again."); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!draft.title.trim() || !draft.categoryId) { showAlert("Missing details", "A topic needs a title and a category."); return; }
    setBusy(true);
    try {
      const t = await createTopic({ title: draft.title.trim(), categoryId: draft.categoryId });
      router.replace(`/admin/kingdom-stories/topics/${t.id}` as any);
    } catch (e: any) { showAlert("Couldn't create topic", e?.message ?? "Please try again."); }
    finally { setBusy(false); }
  }

  async function startStory() {
    if (!topic) return;
    setBusy(true);
    try {
      const { story } = await createStoryFromTopic(topic.id);
      router.push(`/admin/kingdom-stories/${story.id}` as any);
    } catch (e: any) { showAlert("Couldn't create the story", e?.message ?? "Please try again."); }
    finally { setBusy(false); }
  }

  async function openLinkPicker() {
    setLinking(true);
    try { setStories(await getKingdomStoriesAdminList()); } catch { setStories([]); }
  }

  const categoryChips = (selected: string | undefined, onPick: (id: string) => void) => (
    <View style={styles.chips}>
      {categories.map((c) => (
        <TouchableOpacity key={c.id} style={[styles.chip, selected === c.id && styles.chipActive]} onPress={() => onPick(c.id)}>
          <Text style={[styles.chipText, selected === c.id && styles.chipTextActive]}>{c.title}{c.status !== "published" ? " (inactive)" : ""}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const back = (
    <TouchableOpacity onPress={() => router.push(`/admin/kingdom-stories/topics${(topic?.categoryId ?? draft.categoryId) ? `?category=${topic?.categoryId ?? draft.categoryId}` : ""}` as any)} style={styles.back} accessibilityRole="link">
      <Ionicons name="chevron-back" size={16} color={colors.textMid} />
      <Text style={styles.backText}>Topics</Text>
    </TouchableOpacity>
  );

  if (isNew) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {back}
        <Text style={styles.title}>New topic</Text>
        <Text style={styles.label}>Title</Text>
        <TextInput style={styles.input} value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} placeholder="Topic title" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Category</Text>
        {categoryChips(draft.categoryId, (categoryId) => setDraft({ ...draft, categoryId }))}
        <Text style={styles.hint}>New topics start with the status “Topic”. Add research details after creating it.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={create} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create topic</Text>}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (!topic) return <View style={[styles.container, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={colors.primaryGreen} /></View>;

  const linkedIds = new Set((topic.stories ?? []).map((s) => s.id));
  const pickable = stories.filter((s) => !linkedIds.has(s.id) && (!storyQuery.trim() || s.title.toLowerCase().includes(storyQuery.trim().toLowerCase())));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {back}
      <Text style={styles.slug}>{topic.slug}</Text>

      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} defaultValue={topic.title} onEndEditing={(e) => e.nativeEvent.text.trim() && e.nativeEvent.text.trim() !== topic.title && save({ title: e.nativeEvent.text })} />

      {!!topic.overlapNote && (
        <View style={styles.overlapBox}>
          <Ionicons name="git-compare-outline" size={16} color="#92400E" />
          <Text style={styles.overlapText}>{topic.overlapNote}</Text>
        </View>
      )}

      <Text style={styles.label}>Status</Text>
      <View style={styles.chips}>
        {TOPIC_STATUSES.map((s) => (
          <TouchableOpacity key={s} style={[styles.chip, topic.status === s && styles.chipActive]} onPress={() => topic.status !== s && save({ status: s })} disabled={busy}>
            <Text style={[styles.chipText, topic.status === s && styles.chipTextActive]}>{TOPIC_STATUS_LABELS[s]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Priority</Text>
      <View style={styles.chips}>
        {TOPIC_PRIORITIES.map((p) => (
          <TouchableOpacity key={p} style={[styles.chip, topic.priority === p && styles.chipActive]} onPress={() => topic.priority !== p && save({ priority: p })} disabled={busy}>
            <Text style={[styles.chipText, topic.priority === p && styles.chipTextActive]}>{PRIORITY_LABELS[p]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Category</Text>
      {categoryChips(topic.categoryId, (categoryId) => categoryId !== topic.categoryId && save({ categoryId }))}

      <Text style={styles.label}>Tags (comma-separated)</Text>
      <TextInput style={styles.input} defaultValue={topic.tags.join(", ")} onEndEditing={(e) => save({ tags: e.nativeEvent.text.split(",").map((t) => t.trim()).filter(Boolean) })} />

      <Text style={styles.label}>Summary</Text>
      <TextInput style={[styles.input, styles.multiline]} multiline defaultValue={topic.summary ?? ""} onEndEditing={(e) => save({ summary: e.nativeEvent.text })} />

      <Text style={styles.sectionHeading}>Research</Text>
      <Text style={styles.hint}>Leave a field empty until research confirms it.</Text>
      <Text style={styles.label}>Historical period</Text>
      <TextInput style={styles.input} defaultValue={topic.historicalPeriod ?? ""} placeholder="Not yet researched" placeholderTextColor={colors.textMuted} onEndEditing={(e) => save({ historicalPeriod: e.nativeEvent.text })} />
      <Text style={styles.label}>Region</Text>
      <TextInput style={styles.input} defaultValue={topic.region ?? ""} placeholder="Not yet researched" placeholderTextColor={colors.textMuted} onEndEditing={(e) => save({ region: e.nativeEvent.text })} />
      <Text style={styles.label}>Key people</Text>
      <TextInput style={styles.input} defaultValue={topic.keyPeople ?? ""} placeholder="Not yet researched" placeholderTextColor={colors.textMuted} onEndEditing={(e) => save({ keyPeople: e.nativeEvent.text })} />
      <Text style={styles.label}>Research notes</Text>
      <TextInput style={[styles.input, styles.multiline]} multiline defaultValue={topic.researchNotes ?? ""} onEndEditing={(e) => save({ researchNotes: e.nativeEvent.text })} />

      <Text style={styles.sectionHeading}>Story</Text>
      {(topic.stories ?? []).map((s) => (
        <View key={s.id} style={styles.storyRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.storyTitle}>{s.title}</Text>
            <Text style={styles.storyMeta}>{s.status}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push(`/admin/kingdom-stories/${s.id}` as any)} style={styles.smallBtn}><Text style={styles.smallBtnText}>Edit</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/kingdom-stories/${s.id}` as any)} style={styles.outlineBtn} accessibilityLabel="Preview as reader">
            <Ionicons name="eye-outline" size={14} color={colors.accentGreen} />
          </TouchableOpacity>
          <TouchableOpacity onPress={async () => { try { await unlinkStoryFromTopic(topic.id, s.id); await load(); } catch (e: any) { showAlert("Couldn't unlink", e?.message ?? ""); } }} accessibilityLabel="Unlink story">
            <Ionicons name="unlink-outline" size={16} color="#B91C1C" />
          </TouchableOpacity>
        </View>
      ))}
      {!(topic.stories ?? []).length && <Text style={styles.hint}>No story yet. Start an empty draft for this topic, or link a story that already exists.</Text>}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {!(topic.stories ?? []).length && (
          <TouchableOpacity style={styles.primaryBtn} onPress={startStory} disabled={busy}>
            <Text style={styles.primaryBtnText}>Start story draft</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.outlineBtnWide} onPress={linking ? () => setLinking(false) : openLinkPicker}>
          <Text style={styles.outlineBtnText}>{linking ? "Cancel" : "Link existing story"}</Text>
        </TouchableOpacity>
      </View>
      {linking && (
        <View style={{ gap: 6, marginTop: 6 }}>
          <TextInput style={styles.input} value={storyQuery} onChangeText={setStoryQuery} placeholder="Find a story by title" placeholderTextColor={colors.textMuted} />
          {pickable.slice(0, 20).map((s) => (
            <TouchableOpacity key={s.id} style={styles.storyRow} onPress={async () => {
              try { await linkStoryToTopic(topic.id, s.id); setLinking(false); await load(); }
              catch (e: any) { showAlert("Couldn't link", e?.message ?? ""); }
            }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.storyTitle}>{s.title}</Text>
                <Text style={styles.storyMeta}>{s.status}{s.topicId ? " · linked to another topic (will move here)" : ""}</Text>
              </View>
              <Ionicons name="link-outline" size={16} color={colors.accentGreen} />
            </TouchableOpacity>
          ))}
          {!pickable.length && <Text style={styles.hint}>No stories to link.</Text>}
        </View>
      )}
      {busy && <ActivityIndicator color={colors.primaryGreen} style={{ marginTop: 10 }} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { padding: 16, gap: 4, paddingBottom: 80 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", paddingVertical: 4 },
  backText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  title: { fontSize: 20, color: colors.textDark, fontFamily: "Inter_700Bold", marginTop: 4 },
  slug: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  label: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 12, marginBottom: 6 },
  sectionHeading: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 22, marginBottom: 4 },
  hint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17, marginVertical: 4 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  chipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  chipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  overlapBox: { flexDirection: "row", gap: 8, backgroundColor: "#FEF3C7", borderRadius: 10, padding: 10, marginTop: 10 },
  overlapText: { flex: 1, fontSize: 12, color: "#92400E", fontFamily: "Inter_500Medium", lineHeight: 17 },
  storyRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 10 },
  storyTitle: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  storyMeta: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", textTransform: "capitalize" },
  primaryBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingHorizontal: 16, minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  smallBtn: { backgroundColor: colors.primaryGreen, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  smallBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  outlineBtn: { borderWidth: 1, borderColor: colors.accentGreen, borderRadius: 8, padding: 6 },
  outlineBtnWide: { borderWidth: 1.5, borderColor: colors.accentGreen, borderRadius: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: "center", marginTop: 8 },
  outlineBtnText: { color: colors.accentGreen, fontSize: 13, fontFamily: "Inter_700Bold" },
});
