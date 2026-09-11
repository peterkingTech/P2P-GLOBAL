import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import {
  getChurchCallSummary, setChurchCallHostSummary, setChurchCallContinuityNotes,
  CHURCH_CALL_PURPOSE_LABELS, type ChurchCallSummary,
} from "@/lib/churchCallApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

// Stage 5 — Call Summary. No AI content anywhere: every field is a raw
// count, a real logged timeline event, or the host's own manually-written
// text (host_summary/continuity_notes). Reuses the SAME p2p_church_calls
// row (once status='ended') rather than a second history table — see
// migration 131's own forensic-finding comments for why.
export default function CallSummaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ callId: string }>();

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ChurchCallSummary | null>(null);
  const [hostSummaryInput, setHostSummaryInput] = useState("");
  const [continuityInput, setContinuityInput] = useState("");
  const [savingSummary, setSavingSummary] = useState(false);
  const [savingContinuity, setSavingContinuity] = useState(false);

  const load = useCallback(async () => {
    if (!params.callId) return;
    setLoading(true);
    try {
      const s = await getChurchCallSummary(params.callId);
      setSummary(s);
      setHostSummaryInput(s.hostSummary ?? "");
      setContinuityInput(s.continuityNotes ?? "");
    } catch (e: any) {
      showAlert("Couldn't load this summary", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [params.callId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isHost = !!profile?.id && summary?.overview.host?.id === profile.id;

  async function handleSaveHostSummary() {
    if (!params.callId) return;
    setSavingSummary(true);
    try {
      await setChurchCallHostSummary(params.callId, hostSummaryInput.trim());
      setSummary((prev) => prev ? { ...prev, hostSummary: hostSummaryInput.trim() || null } : prev);
    } catch (e: any) { showAlert("Couldn't save", e.message ?? "Please try again."); }
    finally { setSavingSummary(false); }
  }
  async function handleSaveContinuity() {
    if (!params.callId) return;
    setSavingContinuity(true);
    try {
      await setChurchCallContinuityNotes(params.callId, continuityInput.trim());
      setSummary((prev) => prev ? { ...prev, continuityNotes: continuityInput.trim() || null } : prev);
    } catch (e: any) { showAlert("Couldn't save", e.message ?? "Please try again."); }
    finally { setSavingContinuity(false); }
  }

  if (loading || !summary) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{summary.overview.title}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>OVERVIEW</Text>
        <View style={styles.card}>
          <Text style={styles.rowText}>{CHURCH_CALL_PURPOSE_LABELS[summary.overview.purpose]}</Text>
          <Text style={styles.rowMeta}>{summary.overview.startedAt ? new Date(summary.overview.startedAt).toLocaleString() : "—"} · {formatDuration(summary.overview.durationSeconds)}</Text>
          <Text style={styles.rowMeta}>Host: {summary.overview.host?.name ?? "—"}</Text>
        </View>

        <Text style={styles.sectionLabel}>PARTICIPATION</Text>
        <View style={styles.card}>
          <Text style={styles.rowText}>{summary.participation.participantCount} participant{summary.participation.participantCount === 1 ? "" : "s"}</Text>
        </View>

        {summary.scripture.label && (
          <>
            <Text style={styles.sectionLabel}>SCRIPTURE</Text>
            <View style={styles.card}><Text style={styles.rowText}>📖 {summary.scripture.label} ({summary.scripture.reference?.translation})</Text></View>
          </>
        )}

        {summary.study && (
          <>
            <Text style={styles.sectionLabel}>STUDY</Text>
            <View style={styles.card}>
              <Text style={styles.rowText}>{summary.study.lessonTitle}</Text>
              <Text style={styles.rowMeta}>{summary.study.moduleTitle}{summary.study.curriculumTitle ? ` · ${summary.study.curriculumTitle}` : ""}</Text>
            </View>
          </>
        )}

        {summary.media && (
          <>
            <Text style={styles.sectionLabel}>MEDIA</Text>
            <View style={styles.card}><Text style={styles.rowText}>▶️ {summary.media.provider} media</Text></View>
          </>
        )}

        <Text style={styles.sectionLabel}>DISCUSSION</Text>
        <View style={styles.card}>
          <Text style={styles.rowText}>{summary.discussion.messageCount} message{summary.discussion.messageCount === 1 ? "" : "s"} · {summary.discussion.contributorCount} contributor{summary.discussion.contributorCount === 1 ? "" : "s"}</Text>
        </View>

        <Text style={styles.sectionLabel}>WHAT DID WE COVER?</Text>
        {isHost ? (
          <View style={styles.card}>
            <TextInput
              style={styles.textArea} value={hostSummaryInput} onChangeText={setHostSummaryInput}
              placeholder="What happened in this call?" placeholderTextColor={colors.textMuted} multiline
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveHostSummary} disabled={savingSummary}>
              {savingSummary ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}><Text style={styles.rowText}>{summary.hostSummary || "Not written yet."}</Text></View>
        )}

        <Text style={styles.sectionLabel}>CONTINUE NEXT TIME</Text>
        {isHost ? (
          <View style={styles.card}>
            <TextInput
              style={styles.textArea} value={continuityInput} onChangeText={setContinuityInput}
              placeholder="What should we pick up next time?" placeholderTextColor={colors.textMuted} multiline
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveContinuity} disabled={savingContinuity}>
              {savingContinuity ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}><Text style={styles.rowText}>{summary.continuityNotes || "Not written yet."}</Text></View>
        )}

        {summary.timeline.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>TIMELINE</Text>
            <View style={styles.card}>
              {summary.timeline.map((e, i) => (
                <Text key={i} style={styles.rowMeta}>{new Date(e.at).toLocaleTimeString()} — {e.type.replace(/_/g, " ")}</Text>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  scroll: { padding: 16, paddingBottom: 40 },
  sectionLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, gap: 6 },
  rowText: { fontSize: 14, color: colors.textDark, fontFamily: "Inter_500Medium" },
  rowMeta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  textArea: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", minHeight: 70 },
  saveBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
