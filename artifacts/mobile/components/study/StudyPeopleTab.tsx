import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { useStudySession, StudyProgress, OtherParticipant } from "@/hooks/useStudySession";
import type { GroupStudyProgress } from "@/lib/groupStudy";

function showConfirm(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: confirmLabel, style: "destructive", onPress: onConfirm },
    ]);
  }
}

export function StudyPeopleTab({
  session, myId, myName, otherParticipants,
}: {
  session: ReturnType<typeof useStudySession>;
  myId: string; myName: string; otherParticipants: OtherParticipant[];
}) {
  const [progress, setProgress] = useState<StudyProgress | null>(null);
  const [groupProgress, setGroupProgress] = useState<GroupStudyProgress>({});
  const [studyParticipantIds, setStudyParticipantIds] = useState<Set<string> | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const lessonId = session.lesson?.id;
  const isGroup = session.isGroup;

  useEffect(() => {
    if (!lessonId) return;
    if (isGroup) session.getGroupProgress(lessonId).then(setGroupProgress);
    else session.getStudyProgress(lessonId).then(setProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, isGroup]);

  // Study Together C6.1 — "Joined" (in the call, not yet in the study) vs
  // "Studying" (an active study participant), from the server-authoritative
  // roster rather than assuming every call participant has joined the study.
  useEffect(() => {
    if (!isGroup) return;
    session.checkActiveStudy().then((current) => {
      if (current?.participants) setStudyParticipantIds(new Set(current.participants.map((p) => p.userId)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, session.currentSectionIndex]);

  function statusLabel(p?: { status: string; completed: boolean }): string {
    if (!p) return "Not started";
    return p.completed ? "Completed" : p.status.replace("_", " ");
  }

  function participantStateLabel(userId: string): string | null {
    if (!isGroup || !studyParticipantIds) return null;
    return studyParticipantIds.has(userId) ? "Studying" : "Joined";
  }

  async function handleRemove(userId: string, name: string) {
    showConfirm(`Remove ${name}?`, `Remove ${name} from this Study Together session?`, "Remove", async () => {
      setRemovingId(userId);
      await session.removeParticipant(userId);
      setRemovingId(null);
    });
  }

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={styles.sectionLabel}>In This Session</Text>

      <View style={styles.personRow}>
        <View style={styles.avatarCircle}><Ionicons name="person" size={20} color="rgba(255,255,255,0.6)" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.personName}>{myName} {session.isLeader && <Text style={styles.hostTag}>· Study Leader</Text>}</Text>
          <Text style={styles.personSub}>{isGroup ? statusLabel(groupProgress[myId]) : statusLabel(progress?.mine)}</Text>
        </View>
      </View>

      {otherParticipants.map((p) => {
        const stateLabel = participantStateLabel(p.userId);
        return (
          <View key={p.userId} style={styles.personRow}>
            <View style={styles.avatarCircle}><Ionicons name="person" size={20} color="rgba(255,255,255,0.6)" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.personName}>
                {p.name} {session.leaderId === p.userId && <Text style={styles.hostTag}>· Study Leader</Text>}
              </Text>
              <Text style={styles.personSub}>
                {stateLabel ? `${stateLabel} · ` : ""}{isGroup ? statusLabel(groupProgress[p.userId]) : statusLabel(progress?.theirs)}
              </Text>
            </View>
            {isGroup && session.isLeader && session.leaderId !== p.userId && (
              <TouchableOpacity onPress={() => handleRemove(p.userId, p.name)} disabled={removingId === p.userId}>
                <Text style={styles.removeLink}>{removingId === p.userId ? "…" : "Remove"}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      {!isGroup && session.isLeader && otherParticipants[0] && (
        <TouchableOpacity style={styles.passLeadBtn} onPress={() => session.passLead(otherParticipants[0].userId)}>
          <Ionicons name="swap-horizontal" size={16} color="#1D9E75" />
          <Text style={styles.passLeadText}>Pass the Lead to {otherParticipants[0].name}</Text>
        </TouchableOpacity>
      )}

      {isGroup && (
        <Text style={styles.autoNote}>Leadership passes automatically if the leader leaves the call.</Text>
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
  removeLink: { color: "#DC2626", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  passLeadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: "#1D9E75", borderRadius: 10, paddingVertical: 12, marginTop: 4,
  },
  passLeadText: { color: "#1D9E75", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  autoNote: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
});