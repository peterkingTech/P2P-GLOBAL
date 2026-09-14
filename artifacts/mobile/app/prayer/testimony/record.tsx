import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Switch, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import VideoRecorder from "@/components/VideoRecorder";
import { createTestimony, uploadTestimonyVideo, type TestimonyType, type TestimonyVisibility } from "@/lib/prayerTestimonyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// Prayer 2.0 Stage 6 — two conceptually distinct testimony types share this
// one recording screen (same fields, same media/moderation plumbing), but
// the type choice is always explicit and drives what gets saved — a
// 'growth' testimony can never carry requestId, enforced both here and by
// the API/DB constraint.
const TYPES: { key: TestimonyType; label: string; hint: string }[] = [
  { key: "answered_prayer", label: "Answered Prayer", hint: "God answered this specific prayer" },
  { key: "growth", label: "Growth Testimony", hint: "How you've grown in your walk" },
];

export default function RecordTestimonyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  // Deep-link params from a real answered-prayer context (my-prayer.tsx) or
  // a just-completed gathering (complete/[id].tsx) — never a free-form
  // request picker, since that would be new browsing UI beyond this stage's
  // scope. Growth testimonies never receive requestId/requestTitle.
  const { requestId, requestTitle, scripture } = useLocalSearchParams<{ requestId?: string; requestTitle?: string; scripture?: string }>();

  const [testimonyType, setTestimonyType] = useState<TestimonyType>(requestId ? "answered_prayer" : "growth");
  const [title, setTitle] = useState(requestTitle ? `Answered: ${requestTitle}` : "");
  const [testimonyText, setTestimonyText] = useState("");
  const [scriptureRef, setScriptureRef] = useState(scripture ?? "");
  const [visibility, setVisibility] = useState<TestimonyVisibility>("p2p_network");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const linkedToRequest = testimonyType === "answered_prayer" && !!requestId;

  async function handleSubmit() {
    if (!profile?.id || !title.trim() || !testimonyText.trim()) return;
    setSubmitting(true);
    try {
      let mediaFields: { id?: string; mediaType?: "video"; mediaPath?: string; mediaDurationSeconds?: number } = {};
      if (videoUri) {
        const uploaded = await uploadTestimonyVideo(videoUri, profile.id);
        if (!uploaded) { showAlert("Couldn't upload your video", "Please check your connection and try again."); setSubmitting(false); return; }
        mediaFields = { id: uploaded.testimonyId, mediaType: "video", mediaPath: uploaded.mediaPath, mediaDurationSeconds: videoDuration };
      }
      await createTestimony({
        ...mediaFields,
        testimonyType, title: title.trim(), testimonyText: testimonyText.trim(),
        requestId: linkedToRequest ? requestId : null,
        scriptureReference: scriptureRef.trim() ? { reference: scriptureRef.trim() } : null,
        isAnonymous, visibility,
      });
      router.replace("/prayer/testimony/feed" as any);
    } catch (e: any) {
      showAlert("Couldn't share your testimony", e.message ?? "Please try again.");
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
        <Text style={styles.title}>Share a Testimony</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.fieldLabel}>What kind of testimony?</Text>
        {TYPES.map((t) => (
          <TouchableOpacity
            key={t.key} style={styles.modeRow}
            onPress={() => setTestimonyType(t.key)}
            disabled={linkedToRequest}
          >
            <Ionicons name={testimonyType === t.key ? "radio-button-on" : "radio-button-off"} size={20} color={c.accentGreen} />
            <View style={{ flex: 1 }}>
              <Text style={styles.modeLabel}>{t.label}</Text>
              <Text style={styles.modeHint}>{t.hint}</Text>
            </View>
          </TouchableOpacity>
        ))}
        {linkedToRequest && (
          <View style={styles.linkedChip}>
            <Ionicons name="link" size={13} color={c.accentGreen} />
            <Text style={styles.linkedChipText}>Linked to: {requestTitle}</Text>
          </View>
        )}

        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. He provided right on time" placeholderTextColor={c.textMuted} maxLength={80} />

        <Text style={styles.fieldLabel}>Your Testimony</Text>
        <TextInput
          style={[styles.input, { minHeight: 110, textAlignVertical: "top" }]} value={testimonyText} onChangeText={setTestimonyText} multiline
          placeholder="Share what happened and how you saw God at work..." placeholderTextColor={c.textMuted}
        />

        <Text style={styles.fieldLabel}>Scripture (optional)</Text>
        <TextInput style={styles.input} value={scriptureRef} onChangeText={setScriptureRef} placeholder="e.g. Philippians 4:19" placeholderTextColor={c.textMuted} />

        <Text style={styles.fieldLabel}>Video (optional)</Text>
        {videoUri ? (
          <View style={styles.videoChosenBox}>
            <Ionicons name="videocam" size={16} color={c.accentGreen} />
            <Text style={styles.videoChosenText}>Video attached ({videoDuration}s)</Text>
            <TouchableOpacity onPress={() => { setVideoUri(null); setVideoDuration(0); }}>
              <Ionicons name="close-circle" size={18} color={c.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <VideoRecorder
            disabled={submitting}
            onSubmit={async (localUri, durationSeconds) => { setVideoUri(localUri); setVideoDuration(durationSeconds); }}
          />
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
            <Text style={styles.modeHint}>Your name won't be shown to peers</Text>
          </View>
          <Switch value={isAnonymous} onValueChange={setIsAnonymous} trackColor={{ false: c.borderBeige, true: c.accentGreen }} thumbColor="#fff" />
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting || !title.trim() || !testimonyText.trim()}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Share Testimony</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
    title: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    fieldLabel: { fontSize: 12, color: c.textMid, fontFamily: "Inter_600SemiBold", marginTop: 14, marginBottom: 6 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular",
    },
    modeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    modeLabel: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    modeHint: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 1 },
    linkedChip: {
      flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start",
      backgroundColor: "rgba(29,158,117,0.08)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 4,
    },
    linkedChipText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_500Medium" },
    videoChosenBox: {
      flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderWidth: 1,
      borderColor: c.borderBeige, borderRadius: 10, padding: 12,
    },
    videoChosenText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium" },
    visRow: { flexDirection: "row", gap: 8 },
    visBtn: {
      flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
      paddingVertical: 10, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
    },
    visBtnActive: { borderColor: c.accentGreen, backgroundColor: "rgba(29,158,117,0.08)" },
    visBtnText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    visBtnTextActive: { color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    anonRow: {
      flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18, padding: 12,
      borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige,
    },
    anonLabel: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    submitBtn: { backgroundColor: c.primaryGreen, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 24 },
    submitBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  });
}
