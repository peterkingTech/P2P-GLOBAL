import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { StudySessionSummary as Summary } from "@/hooks/useStudySession";

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Shown after "End Study" — a historical record, not a completion claim
// (spec: being present does not automatically complete the lesson).
export function StudySessionSummary({
  visible, summary, otherUserName, onContinueCall, onEndCall,
}: {
  visible: boolean;
  summary: Summary | null;
  otherUserName: string;
  onContinueCall: () => void;
  onEndCall: () => void;
}) {
  const [prayed, setPrayed] = useState(false);
  if (!summary) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>KINGDOM SCHOOL STUDY</Text>
          <Text style={styles.title}>{summary.lessonTitle || "Study Together"}</Text>
          <Text style={styles.duration}>{formatDuration(summary.durationSeconds)}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{summary.questionsDiscussedCount}</Text>
              <Text style={styles.statLabel}>Questions Discussed</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{summary.scripturesDiscussed.length}</Text>
              <Text style={styles.statLabel}>Scriptures Shared</Text>
            </View>
          </View>

          <Text style={styles.footnote}>Lesson progress was updated individually for everyone in the session.</Text>

          {!prayed ? (
            <TouchableOpacity style={styles.prayBtn} onPress={() => setPrayed(true)}>
              <Ionicons name="heart" size={16} color="#fff" />
              <Text style={styles.prayBtnText}>Pray Together</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.prayedText}>Take a moment to pray together before you go. 🙏</Text>
          )}

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onEndCall}>
              <Text style={styles.secondaryBtnText}>End Call</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={onContinueCall}>
              <Text style={styles.primaryBtnText}>Continue Call</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#141F19", borderRadius: 20, padding: 22, width: "100%", gap: 6 },
  eyebrow: { color: "#1D9E75", fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  title: { color: "#fff", fontSize: 19, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 2 },
  duration: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 10 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  statBox: { flex: 1, backgroundColor: "#1A241E", borderRadius: 12, padding: 12, alignItems: "center" },
  statValue: { color: "#fff", fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" },
  statLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
  footnote: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "Inter_400Regular", fontStyle: "italic", marginBottom: 14 },
  prayBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#1D9E75", borderRadius: 10, paddingVertical: 12, marginBottom: 14,
  },
  prayBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  prayedText: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 14 },
  actionsRow: { flexDirection: "row", gap: 10 },
  secondaryBtn: { flex: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  secondaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  primaryBtn: { flex: 1, backgroundColor: "#1D9E75", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
});