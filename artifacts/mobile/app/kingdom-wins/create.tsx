import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Switch, Image, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import VideoRecorder from "@/components/VideoRecorder";
import {
  createKingdomWin, uploadKingdomWinVideo, uploadKingdomWinPhoto,
  KINGDOM_CATEGORY_LABELS, type KingdomEntryType, type KingdomCategory,
} from "@/lib/kingdomWinsApi";
import { createOrFindScriptureReference, parseScriptureInput } from "@/lib/prayerTopicsApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const CATEGORIES = Object.keys(KINGDOM_CATEGORY_LABELS) as KingdomCategory[];

// Kingdom Wins Stage 6 — any authenticated user may share their own
// Kingdom Win or Testimony (no admin gate, unlike Mission Stories — this
// is peer testimony, not curated editorial content).
export default function CreateKingdomWinScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);

  const [entryType, setEntryType] = useState<KingdomEntryType>("kingdom_win");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [lessonLearned, setLessonLearned] = useState("");
  const [scripture, setScripture] = useState("");
  const [category, setCategory] = useState<KingdomCategory>("answered_prayer");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [visibility, setVisibility] = useState<"p2p_network" | "private">("p2p_network");
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [photoAsset, setPhotoAsset] = useState<{ uri: string; mimeType?: string; fileName?: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        const uploaded = await uploadKingdomWinVideo(videoUri, profile.id);
        if (!uploaded) { showAlert("Couldn't upload your video", "Please check your connection and try again."); setSubmitting(false); return; }
        mediaFields = { id: uploaded.entryId, mediaType: "video", mediaPath: uploaded.mediaPath, mediaDurationSeconds: videoDuration };
      } else if (photoAsset) {
        const uploaded = await uploadKingdomWinPhoto(photoAsset, profile.id);
        if (!uploaded) { showAlert("Couldn't upload your photo", "Please check your connection and try again."); setSubmitting(false); return; }
        mediaFields = { id: uploaded.entryId, mediaType: "photo", mediaPath: uploaded.mediaPath };
      }
      let scriptureReferenceId: string | null = null;
      if (scripture.trim()) {
        const parsed = parseScriptureInput(scripture);
        if (!parsed) { showAlert("Couldn't read that Scripture reference", "Try a format like \"Philippians 4:6-7\"."); setSubmitting(false); return; }
        const ref = await createOrFindScriptureReference(parsed);
        scriptureReferenceId = ref.id;
      }
      await createKingdomWin({
        ...mediaFields, entryType, title: title.trim(), body: body.trim(),
        lessonLearned: lessonLearned.trim() || null, category, scriptureReferenceId,
        isAnonymous, visibility, status,
      });
      showAlert(status === "published" ? "Shared!" : "Draft saved", status === "published" ? "Your story is now live." : "You can publish it later from My Stories.");
      router.replace("/kingdom-wins" as any);
    } catch (e: any) {
      showAlert("Couldn't save your story", e.message ?? "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Share Your Story</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.typeRow}>
          <TouchableOpacity style={[styles.typeBtn, entryType === "kingdom_win" && styles.typeBtnActive]} onPress={() => setEntryType("kingdom_win")}>
            <Text style={[styles.typeBtnText, entryType === "kingdom_win" && styles.typeBtnTextActive]}>Kingdom Win</Text>
            <Text style={[styles.typeBtnHint, entryType === "kingdom_win" && styles.typeBtnHintActive]}>A shorter celebration</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.typeBtn, entryType === "testimony" && styles.typeBtnActive]} onPress={() => setEntryType("testimony")}>
            <Text style={[styles.typeBtnText, entryType === "testimony" && styles.typeBtnTextActive]}>Testimony</Text>
            <Text style={[styles.typeBtnHint, entryType === "testimony" && styles.typeBtnHintActive]}>A longer, deeper story</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="What happened?" placeholderTextColor={c.textMuted} maxLength={100} />

        <Text style={styles.fieldLabel}>Your Story</Text>
        <TextInput
          style={[styles.input, { minHeight: 120, textAlignVertical: "top" }]} value={body} onChangeText={setBody} multiline
          placeholder="Look what God has done..." placeholderTextColor={c.textMuted}
        />

        <Text style={styles.fieldLabel}>What did you learn? (optional)</Text>
        <TextInput style={styles.input} value={lessonLearned} onChangeText={setLessonLearned} placeholder="What this taught you" placeholderTextColor={c.textMuted} />

        <Text style={styles.fieldLabel}>Scripture (optional, e.g. Philippians 4:6-7)</Text>
        <TextInput style={styles.input} value={scripture} onChangeText={setScripture} placeholder="Book chapter:verse" placeholderTextColor={c.textMuted} />

        <Text style={styles.fieldLabel}>Category</Text>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity key={cat} style={[styles.categoryChip, category === cat && styles.categoryChipActive]} onPress={() => setCategory(cat)}>
              <Text style={[styles.categoryChipText, category === cat && styles.categoryChipTextActive]}>{KINGDOM_CATEGORY_LABELS[cat]}</Text>
            </TouchableOpacity>
          ))}
        </View>

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

        <Text style={styles.fieldLabel}>Who can see this?</Text>
        <View style={styles.visRow}>
          <TouchableOpacity style={[styles.visBtn, visibility === "p2p_network" && styles.visBtnActive]} onPress={() => setVisibility("p2p_network")}>
            <Ionicons name="earth" size={14} color={visibility === "p2p_network" ? c.accentGreen : c.textMuted} />
            <Text style={[styles.visBtnText, visibility === "p2p_network" && styles.visBtnTextActive]}>P2P Network</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.visBtn, visibility === "private" && styles.visBtnActive]} onPress={() => setVisibility("private")}>
            <Ionicons name="lock-closed" size={14} color={visibility === "private" ? c.accentGreen : c.textMuted} />
            <Text style={[styles.visBtnText, visibility === "private" && styles.visBtnTextActive]}>Private draft</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.anonRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.anonLabel}>Share anonymously</Text>
            <Text style={styles.typeBtnHint}>Your name won't be shown to peers</Text>
          </View>
          <Switch value={isAnonymous} onValueChange={setIsAnonymous} trackColor={{ false: c.borderBeige, true: c.accentGreen }} thumbColor="#fff" />
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.draftBtn} onPress={() => handleSubmit("draft")} disabled={submitting || !title.trim() || !body.trim()}>
            <Text style={styles.draftBtnText}>Save Draft</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.publishBtn} onPress={() => handleSubmit("published")} disabled={submitting || !title.trim() || !body.trim()}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishBtnText}>Share</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
    title: { fontSize: 17, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    typeRow: { flexDirection: "row", gap: 10 },
    typeBtn: { flex: 1, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12, padding: 14, backgroundColor: c.card },
    typeBtnActive: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
    typeBtnText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    typeBtnTextActive: { color: c.accentGreen },
    typeBtnHint: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    typeBtnHintActive: { color: c.accentGreen },
    fieldLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 14, marginBottom: 6 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular" },
    categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    categoryChip: { borderWidth: 1, borderColor: c.borderBeige, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.card },
    categoryChipActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
    categoryChipText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium" },
    categoryChipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
    addPhotoBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.accentGreen, borderStyle: "dashed", borderRadius: 12, paddingVertical: 14, marginBottom: 10 },
    addPhotoBtnText: { fontSize: 14, fontWeight: "600", color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    photoPreviewBox: { borderRadius: 12, overflow: "hidden", position: "relative" },
    photoPreview: { width: "100%", height: 180, borderRadius: 12, backgroundColor: c.borderBeige },
    removeMediaBtn: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 12 },
    videoChosenBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10, padding: 12 },
    videoChosenText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    visRow: { flexDirection: "row", gap: 8 },
    visBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    visBtnActive: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
    visBtnText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    visBtnTextActive: { color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    anonRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18, padding: 12, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    anonLabel: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    btnRow: { flexDirection: "row", gap: 10, marginTop: 24 },
    draftBtn: { flex: 1, borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
    draftBtnText: { color: c.accentGreen, fontSize: 14, fontFamily: "Inter_700Bold" },
    publishBtn: { flex: 1, backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
    publishBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
