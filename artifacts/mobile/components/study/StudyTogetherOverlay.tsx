import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { useStudySession, StudyLessonMeta, StudySessionSummary as Summary } from "@/hooks/useStudySession";
import { StudyLessonTab } from "./StudyLessonTab";
import { StudyQuestionsTab } from "./StudyQuestionsTab";
import { StudyScriptureTab } from "./StudyScriptureTab";
import { StudyPeopleTab } from "./StudyPeopleTab";

type Tab = "lesson" | "questions" | "scripture" | "people";
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "lesson", label: "Lesson", icon: "book-outline" },
  { key: "questions", label: "Questions", icon: "help-circle-outline" },
  { key: "scripture", label: "Scripture", icon: "book" },
  { key: "people", label: "People", icon: "people-outline" },
];

function showConfirm(title: string, message: string, options: { text: string; onPress: () => void; style?: "destructive" | "cancel" }[]) {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) options.find((o) => o.style !== "cancel")?.onPress();
  } else {
    Alert.alert(title, message, options.map((o) => ({ text: o.text, onPress: o.onPress, style: o.style })));
  }
}

// The dominant learning layout Study Together switches into — lesson primary,
// participants as a small strip (spec section 8). Doesn't know anything about
// Agora itself: the host screen (audio.tsx/video.tsx) passes in whatever
// mini call-control strip fits its own medium via `participantStrip`.
export function StudyTogetherOverlay({
  session, myId, myName, otherParticipants, participantStrip, onReturnToCall, onSessionEnded,
}: {
  session: ReturnType<typeof useStudySession>;
  myId: string; myName: string; otherParticipants: { userId: string; name: string }[];
  participantStrip: React.ReactNode;
  onReturnToCall: () => void;
  onSessionEnded: (summary: Summary | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("lesson");

  function handleEndStudy() {
    showConfirm("End Study Session?", "Ending study does not end the call.", [
      { text: "Continue Call", style: "cancel", onPress: () => {} },
      {
        text: "End Study", style: "destructive", onPress: async () => {
          const summary = await session.endStudy();
          onSessionEnded(summary);
        },
      },
    ]);
  }

  const moduleLessonLabel = session.lesson ? session.lesson.title : "";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>KINGDOM SCHOOL · STUDY TOGETHER</Text>
          <Text style={styles.title} numberOfLines={1}>{moduleLessonLabel}</Text>
          <Text style={styles.participants} numberOfLines={1}>{[myName, ...otherParticipants.map((p) => p.name)].join(" • ")}</Text>
        </View>
        <TouchableOpacity style={styles.returnBtn} onPress={onReturnToCall}>
          <Ionicons name="videocam-outline" size={16} color="#fff" />
          <Text style={styles.returnBtnText}>Return to Call</Text>
        </TouchableOpacity>
      </View>

      {participantStrip}

      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
            <Ionicons name={t.icon} size={16} color={tab === t.key ? "#1D9E75" : "rgba(255,255,255,0.55)"} />
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flex: 1 }}>
        {tab === "lesson" && <StudyLessonTab session={session} />}
        {tab === "questions" && <StudyQuestionsTab session={session} otherParticipants={otherParticipants} />}
        {tab === "scripture" && <StudyScriptureTab session={session} />}
        {tab === "people" && <StudyPeopleTab session={session} myId={myId} myName={myName} otherParticipants={otherParticipants} />}
      </View>

      <TouchableOpacity style={styles.endStudyBtn} onPress={handleEndStudy}>
        <Ionicons name="checkmark-done" size={16} color="#fff" />
        <Text style={styles.endStudyBtnText}>End Study</Text>
      </TouchableOpacity>
    </View>
  );
}

export type { StudyLessonMeta };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B120E" },
  header: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  eyebrow: { color: "#1D9E75", fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  title: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 2 },
  participants: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  returnBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#1A241E", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
  returnBtnText: { color: "#fff", fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  tabBar: { flexDirection: "row", paddingHorizontal: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: "#1D9E75" },
  tabLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  tabLabelActive: { color: "#1D9E75" },
  endStudyBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#141F19", paddingVertical: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
  },
  endStudyBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
});