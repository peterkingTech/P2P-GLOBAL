import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { useStudySession, StudyProgress } from "@/hooks/useStudySession";

export function StudyPeopleTab({
  session, myId, myName, otherUserId, otherUserName,
}: {
  session: ReturnType<typeof useStudySession>;
  myId: string; myName: string; otherUserId: string; otherUserName: string;
}) {
  const [progress, setProgress] = useState<StudyProgress | null>(null);
  const lessonId = session.lesson?.id;

  useEffect(() => {
    if (!lessonId) return;
    session.getStudyProgress(lessonId).then(setProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={styles.sectionLabel}>In This Session</Text>

      <View style={styles.personRow}>
        <View style={styles.avatarCircle}><Ionicons name="person" size={20} color="rgba(255,255,255,0.6)" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.personName}>{myName} {session.isLeader && <Text style={styles.hostTag}>· Study Leader</Text>}</Text>
          {progress && <Text style={styles.personSub}>{progress.mine.completed ? "Completed" : progress.mine.status.replace("_", " ")}</Text>}
        </View>
      </View>

      <View style={styles.personRow}>
        <View style={styles.avatarCircle}><Ionicons name="person" size={20} color="rgba(255,255,255,0.6)" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.personName}>{otherUserName} {!session.isLeader && <Text style={styles.hostTag}>· Study Leader</Text>}</Text>
          {progress && <Text style={styles.personSub}>{progress.theirs.completed ? "Completed" : progress.theirs.status.replace("_", " ")}</Text>}
        </View>
      </View>

      {session.isLeader && (
        <TouchableOpacity style={styles.passLeadBtn} onPress={() => session.passLead(otherUserId)}>
          <Ionicons name="swap-horizontal" size={16} color="#1D9E75" />
          <Text style={styles.passLeadText}>Pass the Lead to {otherUserName}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  personRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#1A241E", borderRadius: 14, padding: 14 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  personName: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  hostTag: { color: "#1D9E75", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  personSub: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, textTransform: "capitalize" },
  passLeadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: "#1D9E75", borderRadius: 10, paddingVertical: 12, marginTop: 4,
  },
  passLeadText: { color: "#1D9E75", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
});