import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Switch, Image, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import colors from "@/constants/colors";
import VideoRecorder from "@/components/VideoRecorder";
import {
  getKingdomStory, updateKingdomStory, deleteKingdomStory,
  addKingdomStoryMedia, updateKingdomStoryMedia, deleteKingdomStoryMedia,
  addKingdomStorySource, deleteKingdomStorySource,
  uploadKingdomStoryImage, uploadKingdomStoryVideo, getKingdomStoryMediaSignedUrl,
  getKingdomStoryCategories, CONTENT_TYPE_LABELS,
  type KingdomStory, type KingdomStoryCategory, type KingdomStoryContentType,
} from "@/lib/kingdomStoriesApi";
import { createOrFindScriptureReference, parseScriptureInput, getScriptureReference } from "@/lib/prayerTopicsApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const CONTENT_TYPES = Object.keys(CONTENT_TYPE_LABELS) as KingdomStoryContentType[];

function MediaThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  React.useEffect(() => { getKingdomStoryMediaSignedUrl(path).then(setUrl); }, [path]);
  if (!url) return <View style={styles.mediaThumbPlaceholder}><ActivityIndicator size="small" color={colors.accentGreen} /></View>;
  return <Image source={{ uri: url }} style={styles.mediaThumb} resizeMode="cover" />;
}

export default function EditKingdomStoryScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [story, setStory] = useState<KingdomStory | null>(null);
  const [categories, setCategories] = useState<KingdomStoryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scriptureInput, setScriptureInput] = useState("");
  const [scriptureDisplay, setScriptureDisplay] = useState<string | null>(null);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourcePublisher, setSourcePublisher] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [s, cats] = await Promise.all([getKingdomStory(id), getKingdomStoryCategories()]);
      setStory(s);
      setCategories(cats);
      if (s.scriptureReferenceId) getScriptureReference(s.scriptureReferenceId).then((r) => setScriptureDisplay(r.referenceDisplay)).catch(() => {});
      else setScriptureDisplay(null);
    } catch (e: any) {
      showAlert("Couldn't load story", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function saveField(updates: Partial<KingdomStory>) {
    if (!story) return;
    setSaving(true);
    try {
      const updated = await updateKingdomStory(story.id, updates);
      setStory({ ...story, ...updated });
    } catch (e: any) {
      showAlert("Couldn't save", e.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAttachScripture() {
    if (!scriptureInput.trim() || !story) return;
    const parsed = parseScriptureInput(scriptureInput);
    if (!parsed) { showAlert("Couldn't read that reference", "Try a format like \"Habakkuk 2:14\"."); return; }
    try {
      const ref = await createOrFindScriptureReference(parsed);
      await saveField({ scriptureReferenceId: ref.id });
      setScriptureDisplay(ref.referenceDisplay);
      setScriptureInput("");
    } catch (e: any) {
      showAlert("Couldn't attach Scripture", e.message ?? "Please try again.");
    }
  }

  async function handlePickPhoto() {
    if (!story) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { showAlert("Photo access needed", "Please allow photo library access."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setSaving(true);
    try {
      const uploaded = await uploadKingdomStoryImage(story.id, { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName });
      if (!uploaded) { showAlert("Upload failed", "Please check your connection and try again."); return; }
      await addKingdomStoryMedia(story.id, { mediaType: "image", mediaPath: uploaded.mediaPath, displayOrder: story.media?.length ?? 0, isCover: !story.media?.length });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleAddVideo(localUri: string, durationSeconds: number) {
    if (!story) return;
    setSaving(true);
    try {
      const uploaded = await uploadKingdomStoryVideo(story.id, localUri);
      if (!uploaded) { showAlert("Upload failed", "Please check your connection and try again."); return; }
      await addKingdomStoryMedia(story.id, { mediaType: "video", mediaPath: uploaded.mediaPath, displayOrder: story.media?.length ?? 0, isCover: !story.media?.length, durationSeconds });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleSetCover(mediaId: string) {
    if (!story) return;
    setSaving(true);
    try {
      // Clear any existing cover first — the DB enforces at most one via a
      // partial unique index, so a naive "just set this one" would 409 if
      // another item is still flagged as cover.
      const current = story.media?.find((m) => m.isCover);
      if (current && current.id !== mediaId) await updateKingdomStoryMedia(story.id, current.id, { isCover: false });
      await updateKingdomStoryMedia(story.id, mediaId, { isCover: true });
      await load();
    } catch (e: any) {
      showAlert("Couldn't set cover", e.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMedia(mediaId: string) {
    if (!story) return;
    setSaving(true);
    try { await deleteKingdomStoryMedia(story.id, mediaId); await load(); }
    finally { setSaving(false); }
  }

  async function handleAddSource() {
    if (!story || !sourceTitle.trim()) return;
    setSaving(true);
    try {
      await addKingdomStorySource(story.id, { title: sourceTitle.trim(), publisher: sourcePublisher.trim() || undefined, displayOrder: story.sources?.length ?? 0 });
      setSourceTitle(""); setSourcePublisher("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSource(sourceId: string) {
    if (!story) return;
    setSaving(true);
    try { await deleteKingdomStorySource(story.id, sourceId); await load(); }
    finally { setSaving(false); }
  }

  async function handleStatusChange(status: "review" | "published" | "archived" | "draft") {
    if (!story) return;
    setSaving(true);
    try {
      const updated = await updateKingdomStory(story.id, { status });
      setStory({ ...story, ...updated });
      showAlert("Updated", `Story is now ${status}.`);
    } catch (e: any) {
      showAlert("Couldn't update status", e.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!story) return;
    Alert.alert("Delete this story?", "This permanently removes the story and all its media/sources. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await deleteKingdomStory(story.id); router.replace("/admin/kingdom-stories" as any); }
        catch (e: any) { showAlert("Couldn't delete", e.message ?? "Please try again."); }
      } },
    ]);
  }

  if (loading || !story) return <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 4, paddingBottom: 80 }}>
      <View style={styles.topRow}>
        <View style={[styles.statusPill, styles[`statusPill_${story.status}` as const]]}>
          <Text style={styles.statusPillText}>{story.status.toUpperCase()}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push(`/kingdom-stories/${story.id}` as any)} style={styles.previewBtn}>
          <Ionicons name="eye-outline" size={14} color={colors.accentGreen} />
          <Text style={styles.previewBtnText}>Preview as Peer</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.fieldLabel}>Title</Text>
      <TextInput style={styles.input} defaultValue={story.title} onEndEditing={(e) => saveField({ title: e.nativeEvent.text })} />

      <Text style={styles.fieldLabel}>Subtitle (optional)</Text>
      <TextInput style={styles.input} defaultValue={story.subtitle ?? ""} onEndEditing={(e) => saveField({ subtitle: e.nativeEvent.text })} />

      <Text style={styles.fieldLabel}>Category</Text>
      <View style={styles.chipGrid}>
        {categories.map((cat) => (
          <TouchableOpacity key={cat.id} style={[styles.chip, story.categoryId === cat.id && styles.chipActive]} onPress={() => saveField({ categoryId: cat.id })}>
            <Text style={[styles.chipText, story.categoryId === cat.id && styles.chipTextActive]}>{cat.title}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Content Type</Text>
      <View style={styles.chipGrid}>
        {CONTENT_TYPES.map((ct) => (
          <TouchableOpacity key={ct} style={[styles.chip, story.contentType === ct && styles.chipActive]} onPress={() => saveField({ contentType: story.contentType === ct ? null : ct })}>
            <Text style={[styles.chipText, story.contentType === ct && styles.chipTextActive]}>{CONTENT_TYPE_LABELS[ct]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Story</Text>
      <TextInput style={[styles.input, styles.multiline]} defaultValue={story.body} multiline onEndEditing={(e) => saveField({ body: e.nativeEvent.text })} />

      <Text style={styles.sectionHeading}>Optional Context</Text>
      <Text style={styles.fieldLabel}>Historical Period</Text>
      <TextInput style={styles.input} defaultValue={story.historicalPeriod ?? ""} placeholder="e.g. Early Church" placeholderTextColor={colors.textMuted} onEndEditing={(e) => saveField({ historicalPeriod: e.nativeEvent.text })} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Start Year</Text>
          <TextInput style={styles.input} defaultValue={story.startYear?.toString() ?? ""} keyboardType="numeric" onEndEditing={(e) => saveField({ startYear: e.nativeEvent.text ? parseInt(e.nativeEvent.text, 10) : null })} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>End Year</Text>
          <TextInput style={styles.input} defaultValue={story.endYear?.toString() ?? ""} keyboardType="numeric" onEndEditing={(e) => saveField({ endYear: e.nativeEvent.text ? parseInt(e.nativeEvent.text, 10) : null })} />
        </View>
      </View>
      <Text style={styles.fieldLabel}>Location</Text>
      <TextInput style={styles.input} defaultValue={story.location ?? ""} onEndEditing={(e) => saveField({ location: e.nativeEvent.text })} />
      <Text style={styles.fieldLabel}>People</Text>
      <TextInput style={styles.input} defaultValue={story.people ?? ""} onEndEditing={(e) => saveField({ people: e.nativeEvent.text })} />
      <Text style={styles.fieldLabel}>What can we learn?</Text>
      <TextInput style={[styles.input, styles.multilineSm]} defaultValue={story.learningSection ?? ""} multiline onEndEditing={(e) => saveField({ learningSection: e.nativeEvent.text })} />
      <Text style={styles.fieldLabel}>Reflection</Text>
      <TextInput style={[styles.input, styles.multilineSm]} defaultValue={story.reflection ?? ""} multiline onEndEditing={(e) => saveField({ reflection: e.nativeEvent.text })} />

      <View style={styles.featuredRow}>
        <Text style={styles.fieldLabelInline}>Featured</Text>
        <Switch value={story.isFeatured} onValueChange={(v) => saveField({ isFeatured: v })} trackColor={{ false: colors.borderBeige, true: colors.accentGreen }} thumbColor="#fff" />
      </View>

      <Text style={styles.sectionHeading}>Scripture</Text>
      {scriptureDisplay && <Text style={styles.attachedScripture}>Attached: {scriptureDisplay}</Text>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={[styles.input, { flex: 1 }]} value={scriptureInput} onChangeText={setScriptureInput} placeholder="e.g. Habakkuk 2:14" placeholderTextColor={colors.textMuted} />
        <TouchableOpacity style={styles.smallBtn} onPress={handleAttachScripture}><Text style={styles.smallBtnText}>Attach</Text></TouchableOpacity>
      </View>
      {story.contentType === "scripture_story" && !story.scriptureReferenceId && (
        <Text style={styles.warningText}>Scripture Stories need a Scripture reference before they can be published.</Text>
      )}

      <Text style={styles.sectionHeading}>Media ({story.media?.length ?? 0})</Text>
      <View style={styles.mediaGrid}>
        {(story.media ?? []).map((m) => (
          <View key={m.id} style={styles.mediaCard}>
            {m.mediaType === "image" ? <MediaThumb path={m.mediaPath} /> : <View style={styles.mediaThumbPlaceholder}><Ionicons name="videocam" size={20} color={colors.accentGreen} /></View>}
            {m.isCover && <View style={styles.coverBadge}><Text style={styles.coverBadgeText}>COVER</Text></View>}
            <View style={styles.mediaActions}>
              {!m.isCover && <TouchableOpacity onPress={() => handleSetCover(m.id)}><Text style={styles.mediaActionText}>Set Cover</Text></TouchableOpacity>}
              <TouchableOpacity onPress={() => handleDeleteMedia(m.id)}><Ionicons name="trash-outline" size={14} color="#B91C1C" /></TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        <TouchableOpacity style={styles.addMediaBtn} onPress={handlePickPhoto} disabled={saving}>
          <Ionicons name="image-outline" size={16} color={colors.accentGreen} />
          <Text style={styles.addMediaBtnText}>Add Photo</Text>
        </TouchableOpacity>
        <VideoRecorder disabled={saving} onSubmit={handleAddVideo} />
      </View>

      <Text style={styles.sectionHeading}>Sources ({story.sources?.length ?? 0})</Text>
      {(story.sources ?? []).map((s) => (
        <View key={s.id} style={styles.sourceRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sourceTitle}>{s.title}</Text>
            {!!s.publisher && <Text style={styles.sourceMeta}>{s.publisher}</Text>}
          </View>
          <TouchableOpacity onPress={() => handleDeleteSource(s.id)}><Ionicons name="trash-outline" size={14} color="#B91C1C" /></TouchableOpacity>
        </View>
      ))}
      <TextInput style={styles.input} value={sourceTitle} onChangeText={setSourceTitle} placeholder="Source title" placeholderTextColor={colors.textMuted} />
      <TextInput style={styles.input} value={sourcePublisher} onChangeText={setSourcePublisher} placeholder="Publisher (optional)" placeholderTextColor={colors.textMuted} />
      <TouchableOpacity style={styles.smallBtn} onPress={handleAddSource}><Text style={styles.smallBtnText}>Add Source</Text></TouchableOpacity>

      <Text style={styles.sectionHeading}>Lifecycle</Text>
      <View style={styles.lifecycleRow}>
        {story.status === "draft" && <TouchableOpacity style={styles.lifecycleBtn} onPress={() => handleStatusChange("review")}><Text style={styles.lifecycleBtnText}>Move to Review</Text></TouchableOpacity>}
        {(story.status === "draft" || story.status === "review") && <TouchableOpacity style={[styles.lifecycleBtn, styles.publishBtn]} onPress={() => handleStatusChange("published")}><Text style={styles.publishBtnText}>Publish</Text></TouchableOpacity>}
        {story.status === "published" && <TouchableOpacity style={styles.lifecycleBtn} onPress={() => handleStatusChange("archived")}><Text style={styles.lifecycleBtnText}>Archive</Text></TouchableOpacity>}
        {story.status === "archived" && <TouchableOpacity style={styles.lifecycleBtn} onPress={() => handleStatusChange("draft")}><Text style={styles.lifecycleBtnText}>Restore to Draft</Text></TouchableOpacity>}
      </View>
      <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
        <Text style={styles.deleteBtnText}>Delete Story</Text>
      </TouchableOpacity>
      {saving && <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 10 }} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.lightCream },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusPillText: { fontSize: 11, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  statusPill_draft: { backgroundColor: colors.textMuted },
  statusPill_review: { backgroundColor: "#D97706" },
  statusPill_published: { backgroundColor: colors.primaryGreen },
  statusPill_archived: { backgroundColor: "#6b7280" },
  previewBtn: { flexDirection: "row", gap: 5, alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(29,158,117,0.1)" },
  previewBtnText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  fieldLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 12, marginBottom: 6 },
  fieldLabelInline: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  multiline: { minHeight: 140, textAlignVertical: "top" },
  multilineSm: { minHeight: 70, textAlignVertical: "top" },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  chipText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium" },
  chipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  sectionHeading: { fontSize: 12, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 22, marginBottom: 6 },
  featuredRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: 12, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige },
  attachedScripture: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  warningText: { fontSize: 11, color: "#D97706", fontFamily: "Inter_500Medium", marginTop: 6 },
  smallBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center" },
  smallBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  mediaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  mediaCard: { width: 100, gap: 4 },
  mediaThumb: { width: 100, height: 100, borderRadius: 10, backgroundColor: colors.cardBeige },
  mediaThumbPlaceholder: { width: 100, height: 100, borderRadius: 10, backgroundColor: colors.cardBeige, alignItems: "center", justifyContent: "center" },
  coverBadge: { position: "absolute", top: 4, left: 4, backgroundColor: colors.primaryGreen, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  coverBadgeText: { color: "#fff", fontSize: 8, fontFamily: "Inter_700Bold" },
  mediaActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mediaActionText: { fontSize: 10, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  addMediaBtn: { flexDirection: "row", gap: 6, alignItems: "center", borderWidth: 1, borderColor: colors.accentGreen, borderStyle: "dashed", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  addMediaBtnText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  sourceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 10, marginBottom: 6 },
  sourceTitle: { fontSize: 12, color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  sourceMeta: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  lifecycleRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  lifecycleBtn: { borderWidth: 1.5, borderColor: colors.accentGreen, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  lifecycleBtnText: { color: colors.accentGreen, fontSize: 13, fontFamily: "Inter_700Bold" },
  publishBtn: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  publishBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  deleteBtn: { marginTop: 24, alignItems: "center", padding: 12 },
  deleteBtnText: { color: "#B91C1C", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
