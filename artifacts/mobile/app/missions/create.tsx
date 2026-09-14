import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Image, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import VideoRecorder from "@/components/VideoRecorder";
import { createMissionStory, uploadMissionStoryVideo, uploadMissionStoryPhoto, type MissionStoryType } from "@/lib/missionsApi";
import { createOrFindScriptureReference, parseScriptureInput } from "@/lib/prayerTopicsApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Server-side ADMIN_ROLES (middleware/adminAuth.ts) — mirrored here only
// to decide whether to show this screen's submit action; the API's own
// requireAdmin check is the actual authorization boundary, not this list.
const ADMIN_ROLES = new Set([
  "peer_guide", "church_leader", "regional_admin", "moderator", "super_admin",
  "admin_supervisor", "admin_zone", "admin_national", "admin_content", "admin_translation",
  "admin_moderation", "admin_verification", "admin_help", "admin_username", "admin_finance", "admin_marketing", "admin_church",
]);

const STORY_TYPES: { key: MissionStoryType; label: string }[] = [
  { key: "story", label: "Mission Story" },
  { key: "testimony", label: "Mission Testimony" },
  { key: "update", label: "Mission Update" },
  { key: "growth_story", label: "Growth Story" },
  { key: "scripture_reflection", label: "Scripture Reflection" },
];

// Missions Stage 3 — story + video testimony creation. No "verified
// missionary" role exists yet (Stage 0/1 finding), so this is gated on
// the same broad admin-role set already used for Pray the Word's content
// curation — real per-missionary contributor accounts are a documented
// future stage, not invented here.
export default function CreateMissionStoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [storyType, setStoryType] = useState<MissionStoryType>("story");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [scripture, setScripture] = useState("");
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [photoAsset, setPhotoAsset] = useState<{ uri: string; mimeType?: string; fileName?: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isAuthorized = !!profile?.role && ADMIN_ROLES.has(profile.role);

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { showAlert("Photo access needed", "Please allow photo library access to add a picture."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPhotoAsset({ uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName });
  }

  async function handleSubmit(status: "draft" | "published") {
    if (!profile?.id || !title.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      let mediaFields: { id?: string; mediaType?: "video" | "photo"; mediaPath?: string; mediaDurationSeconds?: number } = {};
      if (videoUri) {
        const uploaded = await uploadMissionStoryVideo(videoUri, profile.id);
        if (!uploaded) { showAlert("Couldn't upload your video", "Please check your connection and try again."); setSubmitting(false); return; }
        mediaFields = { id: uploaded.storyId, mediaType: "video", mediaPath: uploaded.mediaPath, mediaDurationSeconds: videoDuration };
      } else if (photoAsset) {
        const uploaded = await uploadMissionStoryPhoto(photoAsset, profile.id);
        if (!uploaded) { showAlert("Couldn't upload your photo", "Please check your connection and try again."); setSubmitting(false); return; }
        mediaFields = { id: uploaded.storyId, mediaType: "photo", mediaPath: uploaded.mediaPath };
      }
      let scriptureReferenceId: string | null = null;
      if (scripture.trim()) {
        const parsed = parseScriptureInput(scripture);
        if (!parsed) { showAlert("Couldn't read that Scripture reference", "Try a format like \"Philippians 4:6-7\"."); setSubmitting(false); return; }
        const ref = await createOrFindScriptureReference(parsed);
        scriptureReferenceId = ref.id;
      }
      await createMissionStory({
        ...mediaFields, storyType, title: title.trim(), summary: summary.trim() || null, body: body.trim(),
        scriptureReferenceId, status,
      });
      showAlert(status === "published" ? "Story published" : "Draft saved", status === "published" ? "Your mission story is now live." : "You can publish it later.");
      router.replace("/(tabs)/missions" as any);
    } catch (e: any) {
      showAlert("Couldn't save this story", e.message ?? "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isAuthorized) {
    return (
      <View style={[styles.screen, styles.centerFill]}>
        <Ionicons name="lock-closed-outline" size={32} color={c.textMuted} />
        <Text style={styles.emptyText}>Mission Story creation is currently limited to authorized contributors.</Text>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.linkText}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Share a Mission Story</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.fieldLabel}>Type</Text>
        {STORY_TYPES.map((t) => (
          <TouchableOpacity key={t.key} style={styles.modeRow} onPress={() => setStoryType(t.key)}>
            <Ionicons name={storyType === t.key ? "radio-button-on" : "radio-button-off"} size={20} color={c.accentGreen} />
            <Text style={styles.modeLabel}>{t.label}</Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="What happened?" placeholderTextColor={c.textMuted} maxLength={100} />

        <Text style={styles.fieldLabel}>Summary (optional)</Text>
        <TextInput style={styles.input} value={summary} onChangeText={setSummary} placeholder="A one-line summary for the story card" placeholderTextColor={c.textMuted} />

        <Text style={styles.fieldLabel}>Story</Text>
        <TextInput
          style={[styles.input, { minHeight: 140, textAlignVertical: "top" }]} value={body} onChangeText={setBody} multiline
          placeholder="What happened, what God taught us, what we're praying for..." placeholderTextColor={c.textMuted}
        />

        <Text style={styles.fieldLabel}>Scripture reference (optional, e.g. Philippians 4:6-7)</Text>
        <TextInput style={styles.input} value={scripture} onChangeText={setScripture} placeholder="Book chapter:verse" placeholderTextColor={c.textMuted} />

        <Text style={styles.fieldLabel}>Media (optional — a photo or a video, not both)</Text>
        {photoAsset ? (
          <View style={styles.photoPreviewBox}>
            <Image source={{ uri: photoAsset.uri }} style={styles.photoPreview} resizeMode="cover" />
            <TouchableOpacity style={styles.removeMediaBtn} onPress={() => setPhotoAsset(null)}>
              <Ionicons name="close-circle" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : videoUri ? (
          <View style={styles.videoChosenBox}>
            <Ionicons name="videocam" size={16} color={c.accentGreen} />
            <Text style={styles.videoChosenText}>Video attached ({videoDuration}s)</Text>
            <TouchableOpacity onPress={() => { setVideoUri(null); setVideoDuration(0); }}>
              <Ionicons name="close-circle" size={18} color={c.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity style={styles.addPhotoBtn} onPress={handlePickPhoto} disabled={submitting}>
              <Ionicons name="image-outline" size={18} color={c.accentGreen} />
              <Text style={styles.addPhotoBtnText}>Add Photo</Text>
            </TouchableOpacity>
            <VideoRecorder disabled={submitting} onSubmit={async (localUri, durationSeconds) => { setVideoUri(localUri); setVideoDuration(durationSeconds); }} />
          </>
        )}

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.draftBtn} onPress={() => handleSubmit("draft")} disabled={submitting || !title.trim() || !body.trim()}>
            <Text style={styles.draftBtnText}>Save Draft</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.publishBtn} onPress={() => handleSubmit("published")} disabled={submitting || !title.trim() || !body.trim()}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishBtnText}>Publish</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    centerFill: { alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
    emptyText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
    linkText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
    title: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    fieldLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    modeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
    modeLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    videoChosenBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 12 },
    videoChosenText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    addPhotoBtn: {
      flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
      borderWidth: 1, borderColor: c.accentGreen, borderStyle: "dashed", borderRadius: 12, paddingVertical: 14, marginBottom: 10,
    },
    addPhotoBtnText: { fontSize: 14, fontWeight: "600", color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    photoPreviewBox: { borderRadius: 12, overflow: "hidden", position: "relative" },
    photoPreview: { width: "100%", height: 200, borderRadius: 12, backgroundColor: c.borderBeige },
    removeMediaBtn: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 12 },
    btnRow: { flexDirection: "row", gap: 10, marginTop: 24 },
    draftBtn: { flex: 1, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
    draftBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
    publishBtn: { flex: 1, backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
    publishBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
