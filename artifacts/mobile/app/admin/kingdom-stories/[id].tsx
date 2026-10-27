import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Switch, Image, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import colors from "@/constants/colors";
import VideoRecorder from "@/components/VideoRecorder";
import {
  getKingdomStory, updateKingdomStory, deleteKingdomStory,
  addKingdomStoryMedia, updateKingdomStoryMedia, deleteKingdomStoryMedia, syncKingdomStoryLearning,
  addKingdomStorySource, deleteKingdomStorySource,
  uploadKingdomStoryImage, uploadKingdomStoryVideo, getKingdomStoryMediaSignedUrl,
  getKingdomStoryCategories, editorCategoryOrder, CONTENT_TYPE_LABELS,
  type KingdomStory, type KingdomStoryCategory, type KingdomStoryContentType,
} from "@/lib/kingdomStoriesApi";
import { createOrFindScriptureReference, parseScriptureInput, getScriptureReference } from "@/lib/prayerTopicsApi";
import { useAuth } from "@/contexts/AuthContext";
import { STUDIO_VIEW_ROLES, REVIEW_LABELS, reviewStateOf } from "@/lib/studioModel";
import { getStudioItem, type StudioItem } from "@/lib/studioApi";
import type { ActionOutcome } from "@/lib/studioActions";
import { StudioSteps } from "@/components/studio/StudioSteps";
import { Banner, Chip, reviewTone } from "@/components/studio/StudioUI";
import ChaptersEditor from "@/components/kingdom-stories/ChaptersEditor";
import MediaDetailsEditor from "@/components/kingdom-stories/MediaDetailsEditor";
import ImageSlots from "@/components/kingdom-stories/ImageSlots";

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
  // Refusals from the Publishing Studio approval gate / live-story freeze
  // (migration 188): shown in the screen, never as a bare error.
  const [studioNotice, setStudioNotice] = useState<{ message: string; where: "top" | "lifecycle" } | null>(null);
  const { profile } = useAuth();
  const canOpenStudio = !!profile && STUDIO_VIEW_ROLES.includes(profile.role);
  // The story's Publishing Studio state: submitting, approving and publishing
  // happen through the Studio's steps (one review process), right here.
  const [studioItem, setStudioItem] = useState<StudioItem | null>(null);
  const [studioEditable, setStudioEditable] = useState(false);
  const [studioOutcome, setStudioOutcome] = useState<ActionOutcome | null>(null);
  // Shown next to where the action happened: field edits at the top,
  // Publish / Unpublish / Archive next to the lifecycle buttons.
  function reportError(title: string, e: any, where: "top" | "lifecycle" = "top") {
    if (e?.studioRequired) setStudioNotice({ message: e.message, where });
    else showAlert(title, e?.message ?? "Please try again.");
  }

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [s, cats] = await Promise.all([getKingdomStory(id), getKingdomStoryCategories()]);
      setStory(s);
      setCategories(editorCategoryOrder(cats));
      if (s.scriptureReferenceId) getScriptureReference(s.scriptureReferenceId).then((r) => setScriptureDisplay(r.referenceDisplay)).catch(() => {});
      else setScriptureDisplay(null);
      if (canOpenStudio) getStudioItem(id).then((r) => { setStudioItem(r.item); setStudioEditable(r.editable); }).catch(() => setStudioItem(null));
    } catch (e: any) {
      showAlert("Couldn't load story", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [id, canOpenStudio]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function studioDone(outcome: ActionOutcome, fresh: StudioItem | null) {
    setStudioOutcome(outcome);
    if (fresh) setStudioItem(fresh);
    if (!fresh || fresh.nativeStatus !== story?.status) load(); // e.g. just published
  }

  async function saveField(updates: Partial<KingdomStory>) {
    if (!story) return;
    setSaving(true);
    try {
      const updated = await updateKingdomStory(story.id, updates);
      setStory({ ...story, ...updated });
    } catch (e: any) {
      reportError("Couldn't save", e);
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
    } catch (e: any) {
      reportError("Couldn't add photo", e);
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
    } catch (e: any) {
      reportError("Couldn't add video", e);
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
      reportError("Couldn't set cover", e);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMedia(mediaId: string) {
    if (!story) return;
    setSaving(true);
    try { await deleteKingdomStoryMedia(story.id, mediaId); await load(); }
    catch (e: any) { reportError("Couldn't remove media", e); }
    finally { setSaving(false); }
  }

  async function handleAddSource() {
    if (!story || !sourceTitle.trim()) return;
    setSaving(true);
    try {
      await addKingdomStorySource(story.id, { title: sourceTitle.trim(), publisher: sourcePublisher.trim() || undefined, displayOrder: story.sources?.length ?? 0 });
      setSourceTitle(""); setSourcePublisher("");
      await load();
    } catch (e: any) {
      reportError("Couldn't add source", e);
    } finally {
      setSaving(false);
    }
  }

  // Storybook: turn the chapters' reflections and Comprehensive Checks into
  // learning activities now, to preview them (publishing does this anyway).
  async function handlePrepareActivities() {
    if (!story) return;
    try {
      const r = await syncKingdomStoryLearning(story.id);
      showAlert("Activities ready", `${r.lessons} chapters · ${r.reflection_questions} reflection questions · ${r.comprehensive_checks} Comprehensive Checks. Readers can use them once the story is published.`);
      await load();
    } catch (e) { reportError("Couldn't prepare the activities", e); }
  }

  async function handleDeleteSource(sourceId: string) {
    if (!story) return;
    setSaving(true);
    try { await deleteKingdomStorySource(story.id, sourceId); await load(); }
    catch (e: any) { reportError("Couldn't remove source", e); }
    finally { setSaving(false); }
  }

  async function handleStatusChange(status: "review" | "published" | "archived" | "draft") {
    if (!story) return;
    setSaving(true);
    try {
      const updated = await updateKingdomStory(story.id, { status });
      setStory({ ...story, ...updated });
      setStudioNotice(null);
      showAlert("Updated", `Story is now ${status}.`);
    } catch (e: any) {
      reportError("Couldn't update status", e, "lifecycle");
    } finally {
      setSaving(false);
    }
  }

  // Deleting moves the story (chapters, images, sources) to the Admin Recycle
  // Bin (migration 214); a live story must be unpublished first.
  function handleDelete() {
    if (!story) return;
    const title = "Move this story to the Recycle Bin?";
    const message = `"${story.title}" and its chapters, images and sources move to the Recycle Bin. Readers stop seeing it now; it can be restored from Admin → Recycle Bin.`;
    const doDelete = async () => {
      try { await deleteKingdomStory(story.id); router.replace("/admin/kingdom-stories" as any); }
      catch (e: any) { showAlert("Couldn't delete", e.message ?? "Please try again."); }
    };
    if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${message}`)) doDelete(); return; }
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Move to Recycle Bin", style: "destructive", onPress: doDelete },
    ]);
  }

  if (loading || !story) return <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 4, paddingBottom: 80 }}>
      {studioNotice?.where === "top" ? (
        <View style={styles.studioNotice} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#8A5410" />
            <Text style={styles.studioNoticeText}>{studioNotice.message}</Text>
          </View>
          <View style={styles.studioNoticeRow}>
            {canOpenStudio ? (
              <TouchableOpacity style={styles.studioNoticeBtn} onPress={() => router.push("/admin/studio/review" as any)} accessibilityRole="button" accessibilityLabel="Open Publishing Studio">
                <Text style={styles.studioNoticeBtnText}>Open Publishing Studio</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.studioNoticeDismiss} onPress={() => setStudioNotice(null)} accessibilityRole="button" accessibilityLabel="Dismiss">
              <Text style={styles.studioNoticeDismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      <View style={styles.topRow}>
        <View style={[styles.statusPill, styles[`statusPill_${story.status}` as const]]}>
          <Text style={styles.statusPillText}>{story.status.toUpperCase()}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push(`/kingdom-stories/${story.id}` as any)} style={styles.previewBtn}>
          <Ionicons name="eye-outline" size={14} color={colors.accentGreen} />
          <Text style={styles.previewBtnText}>Preview as Peer</Text>
        </TouchableOpacity>
        {story.status !== "published" && !!story.chapters?.length && (
          <TouchableOpacity onPress={handlePrepareActivities} style={styles.previewBtn} accessibilityRole="button" accessibilityLabel="Prepare reflections and Comprehensive Checks">
            <Ionicons name="school-outline" size={14} color={colors.accentGreen} />
            <Text style={styles.previewBtnText}>Prepare activities</Text>
          </TouchableOpacity>
        )}
      </View>
      {!!story.topicId && (
        <TouchableOpacity onPress={() => router.push(`/admin/kingdom-stories/topics/${story.topicId}` as any)} style={styles.topicLink} accessibilityRole="link">
          <Ionicons name="git-branch-outline" size={13} color={colors.textMid} />
          <Text style={styles.topicLinkText}>Open this story's catalogue topic</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionHeading}>Story information</Text>
      <Text style={styles.fieldLabel}>Topic number</Text>
      <Text style={styles.fieldHint}>The story's stable number in its category (shown as “Topic 012”). It never changes the story's identity or readers' progress.</Text>
      <TextInput style={[styles.input, { maxWidth: 140 }]} defaultValue={story.topicNumber ? String(story.topicNumber) : ""} keyboardType="number-pad" placeholder="e.g. 12"
        placeholderTextColor={colors.textMuted} accessibilityLabel="Topic number"
        onEndEditing={(e) => { const t = e.nativeEvent.text.trim(); const n = t ? Number(t) : null; if (t && (!Number.isInteger(n) || n! < 1 || n! > 9999)) { showAlert("Topic number", "Use a whole number from 1 to 9999."); return; } if (n !== (story.topicNumber ?? null)) saveField({ topicNumber: n } as any); }} />

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

      <Text style={styles.fieldLabel}>{story.chapters?.length ? "Introduction" : "Story"}</Text>
      <TextInput style={[styles.input, styles.multiline]} defaultValue={story.body} multiline onEndEditing={(e) => saveField({ body: e.nativeEvent.text })} />

      <ChaptersEditor story={story} locked={story.status === "published"} onChanged={load} onError={(title, e) => reportError(title, e)} />

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

      <Text style={styles.sectionHeading}>Story artwork</Text>
      <ImageSlots story={story} locked={story.status === "published"} onChanged={load} onError={(title, e) => reportError(title, e)} />

      <Text style={styles.sectionHeading}>All media ({story.media?.length ?? 0})</Text>
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
      <MediaDetailsEditor story={story} locked={story.status === "published"} onChanged={load} onError={(title, e) => reportError(title, e)} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        <TouchableOpacity style={styles.addMediaBtn} onPress={handlePickPhoto} disabled={saving}>
          <Ionicons name="image-outline" size={16} color={colors.accentGreen} />
          <Text style={styles.addMediaBtnText}>Add Photo</Text>
        </TouchableOpacity>
        <VideoRecorder disabled={saving} onSubmit={handleAddVideo} />
      </View>

      <Text style={styles.sectionHeading}>Story sources ({story.sources?.filter((s) => !s.chapterId).length ?? 0})</Text>
      {(story.sources ?? []).filter((s) => !s.chapterId).map((s) => (
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
      {(story.status === "draft" || story.status === "review") && studioItem ? (
        <View style={{ gap: 8, marginBottom: 8 }}>
          <View style={styles.lifecycleRow}>
            <Text style={styles.studioStateLabel}>Publishing Studio:</Text>
            <Chip label={REVIEW_LABELS[reviewStateOf(studioItem)]} tone={reviewTone(reviewStateOf(studioItem))} />
          </View>
          {studioOutcome ? <Banner tone={studioOutcome.tone} text={studioOutcome.text} onDismiss={() => setStudioOutcome(null)} /> : null}
          <View style={styles.lifecycleRow}>
            <StudioSteps item={studioItem} editable={studioEditable} userId={profile?.id ?? null} role={profile?.role ?? null} onDone={studioDone} />
          </View>
        </View>
      ) : null}
      {(story.status === "draft" || story.status === "review") && !studioItem && canOpenStudio ? (
        <TouchableOpacity style={[styles.lifecycleBtn, styles.publishBtn, { alignSelf: "flex-start", marginBottom: 8 }]} onPress={() => router.push("/admin/studio/review" as any)} accessibilityRole="button" accessibilityLabel="Submit, approve and publish in the Publishing Studio">
          <Text style={styles.publishBtnText}>Submit, approve and publish in the Publishing Studio</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.lifecycleRow}>
        {story.status === "published" && <TouchableOpacity style={styles.lifecycleBtn} onPress={() => handleStatusChange("draft")} accessibilityRole="button" accessibilityLabel="Unpublish to edit"><Text style={styles.lifecycleBtnText}>Unpublish to edit</Text></TouchableOpacity>}
        {story.status === "published" && <TouchableOpacity style={styles.lifecycleBtn} onPress={() => handleStatusChange("archived")}><Text style={styles.lifecycleBtnText}>Archive</Text></TouchableOpacity>}
        {story.status === "archived" && <TouchableOpacity style={styles.lifecycleBtn} onPress={() => handleStatusChange("draft")}><Text style={styles.lifecycleBtnText}>Restore to Draft</Text></TouchableOpacity>}
      </View>
      {studioNotice?.where === "lifecycle" ? (
        <View style={[styles.studioNotice, { marginTop: 10 }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#8A5410" />
            <Text style={styles.studioNoticeText}>{studioNotice.message}</Text>
          </View>
          <View style={styles.studioNoticeRow}>
            {canOpenStudio ? (
              <TouchableOpacity style={styles.studioNoticeBtn} onPress={() => router.push("/admin/studio/review" as any)} accessibilityRole="button" accessibilityLabel="Open Publishing Studio">
                <Text style={styles.studioNoticeBtnText}>Open Publishing Studio</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.studioNoticeDismiss} onPress={() => setStudioNotice(null)} accessibilityRole="button" accessibilityLabel="Dismiss">
              <Text style={styles.studioNoticeDismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      <View>
        {story.status === "draft" || story.status === "review"
          ? <Text style={styles.lifecycleHint}>Publishing needs approval by another editor in the Publishing Studio. Until then, Publish leaves the story unpublished.</Text>
          : story.status === "published"
            ? <Text style={styles.lifecycleHint}>This story is live, so its text, media and sources are locked. Unpublish it to make changes, then get it approved again.</Text>
            : null}
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
  topicLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4 },
  topicLinkText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_500Medium", textDecorationLine: "underline" },
  fieldLabel: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_600SemiBold", marginTop: 12, marginBottom: 6 },
  fieldHint: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: -2, marginBottom: 6 },
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
  lifecycleRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  studioStateLabel: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  lifecycleHint: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 },
  studioNotice: { backgroundColor: "#FDF6EA", borderColor: "#EBCB95", borderWidth: 1, borderRadius: 12, padding: 12, gap: 10, marginBottom: 8 },
  studioNoticeText: { flex: 1, fontSize: 13, color: "#5C3A0B", fontFamily: "Inter_500Medium", lineHeight: 19 },
  studioNoticeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  studioNoticeBtn: { backgroundColor: colors.primaryGreen, borderRadius: 9, paddingHorizontal: 14, minHeight: 44, justifyContent: "center" },
  studioNoticeBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  studioNoticeDismiss: { borderRadius: 9, paddingHorizontal: 14, minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: "#EBCB95" },
  studioNoticeDismissText: { color: "#5C3A0B", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  lifecycleBtn: { borderWidth: 1.5, borderColor: colors.accentGreen, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  lifecycleBtnText: { color: colors.accentGreen, fontSize: 13, fontFamily: "Inter_700Bold" },
  publishBtn: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  publishBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  deleteBtn: { marginTop: 24, alignItems: "center", padding: 12 },
  deleteBtnText: { color: "#B91C1C", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
