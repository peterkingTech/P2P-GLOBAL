import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import { createMissionStory, uploadMissionStoryVideo, uploadMissionStoryPhoto, type MissionStoryType } from "@/lib/missionsApi";
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";
import { StoryMediaField, useStoryMedia, uploadStoryMedia } from "@/components/story/StoryMedia";
import { scriptureReferenceIdFor, ScriptureInputError } from "@/lib/scriptureInput";


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
  const media = useStoryMedia();
  const [submitting, setSubmitting] = useState(false);

  const isAuthorized = !!profile?.role && ADMIN_ROLES.has(profile.role);

  async function handleSubmit(status: "draft" | "published") {
    if (!profile?.id || !title.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      const mediaFields = await uploadStoryMedia(media, { userId: profile.id, uploadVideo: uploadMissionStoryVideo, uploadPhoto: uploadMissionStoryPhoto, idOf: (u) => u.storyId });
      if (!mediaFields) { setSubmitting(false); return; }
      let scriptureReferenceId: string | null;
      try { scriptureReferenceId = await scriptureReferenceIdFor(scripture); }
      catch (e) {
        if (!(e instanceof ScriptureInputError)) throw e;
        showAlert("Couldn't read that Scripture reference", e.message); setSubmitting(false); return;
      }
      await createMissionStory({
        ...mediaFields, storyType, title: title.trim(), summary: summary.trim() || null, body: body.trim(),
        scriptureReferenceId, status,
      });
      showAlert(status === "published" ? "Story published" : "Draft saved", status === "published" ? "Your mission story is now live." : "You can publish it later.");
      router.replace("/missions" as any);
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
        <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text style={styles.linkText}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={10} onPress={() => router.back()} accessibilityLabel="Back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={c.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Share a Mission Story</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.fieldLabel}>Type</Text>
        {STORY_TYPES.map((t) => (
          <TouchableOpacity accessibilityRole="button" key={t.key} style={styles.modeRow} onPress={() => setStoryType(t.key)}>
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

        <StoryMediaField media={media} disabled={submitting} photoHeight={200} />

        <View style={styles.btnRow}>
          <AppButton label="Save Draft" onPress={() => handleSubmit("draft")} variant="outline" disabled={submitting || !title.trim() || !body.trim()} style={{ flex: 1 }} />
          <AppButton label="Publish" onPress={() => handleSubmit("published")} disabled={submitting || !title.trim() || !body.trim()} loading={submitting} style={{ flex: 1 }} />
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
    photoPreviewBox: { borderRadius: 12, overflow: "hidden", position: "relative" },
    photoPreview: { width: "100%", height: 200, borderRadius: 12, backgroundColor: c.borderBeige },
    removeMediaBtn: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 12 },
    btnRow: { flexDirection: "row", gap: 10, marginTop: 24 },
  });
}
