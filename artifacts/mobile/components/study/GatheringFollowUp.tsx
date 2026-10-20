import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import type { GatheringFollowUp as FollowUp, GroupScope } from "@/lib/groupLearningApi";

// What a Gathering leaves behind (Prompt 8) — shared by the Family and Church
// Gathering summaries. Everything here is something the group really did:
// notes their authors chose to SHARE (private notes never appear), follow-up
// assignments published during the Gathering, and where the group's learning
// journey continues next time (a reference to central content, not a copy).
export default function GatheringFollowUp({ followUp, scope }: { followUp: FollowUp; scope: GroupScope }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const notes = followUp.sharedNotes ?? [];
  const work = followUp.assignmentsCreated ?? [];
  const next = followUp.nextTime ?? null;

  return (
    <>
      <View style={styles.section}>
        <Text style={styles.title} accessibilityRole="header">Shared notes & next steps</Text>
        {notes.length === 0 ? (
          <Text style={styles.empty}>No one shared a note in this Gathering.</Text>
        ) : notes.map((n, i) => (
          <View key={i} style={styles.note}>
            <Text style={styles.noteAuthor}>{n.authorName}</Text>
            <Text style={styles.body}>{n.content}</Text>
          </View>
        ))}
        <Text style={styles.hint}>Only notes their authors chose to share appear here. Private notes and reflections stay private.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.title} accessibilityRole="header">Follow-up assignments</Text>
        {work.length === 0 ? (
          <Text style={styles.empty}>No assignments were given during this Gathering.</Text>
        ) : work.map((a) => (
          <TouchableOpacity key={a.assignmentId} style={styles.row} onPress={() => router.push({ pathname: "/learning/assignment/[assignmentId]", params: { assignmentId: a.assignmentId, s: scope } } as any)}
            accessibilityRole="button" accessibilityLabel={`Assignment ${a.title}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.body}>{a.title}</Text>
              <Text style={styles.meta}>{a.lessonTitle ?? ""}{a.dueAt ? `${a.lessonTitle ? " · " : ""}due ${new Date(a.dueAt).toLocaleDateString()}` : ""}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      {next && (
        <View style={styles.section}>
          <Text style={styles.title} accessibilityRole="header">Next time</Text>
          <Text style={styles.meta}>{next.curriculum.title} · {next.covered} of {next.total} covered together</Text>
          {next.lesson ? (
            <TouchableOpacity style={styles.row} onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: next.lesson!.id } } as any)}
              accessibilityRole="button" accessibilityLabel={`Next lesson: ${next.lesson.title}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>{next.lesson.title}</Text>
                <Text style={styles.meta}>{next.lesson.moduleTitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ) : <Text style={styles.empty}>Every lesson in this series has been covered together.</Text>}
        </View>
      )}
    </>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    section: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: c.borderBeige, gap: 6 },
    title: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    empty: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    hint: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
    note: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.borderBeige },
    noteAuthor: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    row: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingVertical: 6 },
  });
}
