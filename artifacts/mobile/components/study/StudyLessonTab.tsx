import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { useStudySession, StudyLessonData } from "@/hooks/useStudySession";

// The primary content of Study Together (spec: "lesson = primary, video =
// small floating windows") — renders the current section, leader-controlled
// Prev/Next broadcasting position to the follower, and a local-only
// Explore/Return-to-Group toggle so nobody is forced to stay in lockstep.
export function StudyLessonTab({ session }: { session: ReturnType<typeof useStudySession> }) {
  const [data, setData] = useState<StudyLessonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const lessonId = session.lesson?.id;

  useEffect(() => {
    if (!lessonId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    session.getSharedLessonData(lessonId).then((d) => {
      if (!cancelled) { setData(d); setLoading(false); }
    }).catch(() => { if (!cancelled) { setLoadError(true); setLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  if (loading) {
    return <View style={styles.centerFill}><ActivityIndicator color="#1D9E75" /></View>;
  }
  if (loadError || !data) {
    return (
      <View style={styles.centerFill}>
        <Text style={styles.errorText}>Kingdom School couldn't load this lesson.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => lessonId && session.getSharedLessonData(lessonId).then(setData)}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalSections = data.sections.length;
  const index = Math.min(session.currentSectionIndex, Math.max(0, totalSections - 1));
  const section = data.sections[index];
  const canControl = session.isLeader || !session.isFollowing;

  function goTo(newIndex: number) {
    if (newIndex < 0 || newIndex >= totalSections) return;
    if (session.isFollowing) session.changeSection(newIndex);
  }

  return (
    <View style={{ flex: 1 }}>
      {!session.isFollowing && (
        <View style={styles.exploreBanner}>
          <Text style={styles.exploreBannerText}>You're exploring on your own.</Text>
          <TouchableOpacity onPress={session.returnToGroup}>
            <Text style={styles.exploreBannerLink}>Return to Group</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {data.scriptures.length > 0 && index === 0 && (
          <View style={styles.scriptureBlock}>
            {data.scriptures.map((s) => (
              <View key={s.id} style={styles.scriptureCard}>
                <Text style={styles.scriptureText}>"{s.verse}"</Text>
                <Text style={styles.scriptureRef}>— {s.reference}</Text>
              </View>
            ))}
          </View>
        )}
        {section ? (
          <>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.content.split("\n\n").filter(Boolean).map((p, i) => (
              <Text key={i} style={styles.paragraph}>{p}</Text>
            ))}
          </>
        ) : (
          <Text style={styles.paragraph}>No sections in this lesson yet.</Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.navBtn, (!canControl || index === 0) && styles.navBtnDisabled]}
          onPress={() => (session.isFollowing ? goTo(index - 1) : session.exploreIndependently())}
          disabled={session.isFollowing ? (!canControl || index === 0) : false}
        >
          <Ionicons name="chevron-back" size={18} color="#fff" />
          <Text style={styles.navBtnText}>Previous</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.exploreToggleBtn}
          onPress={() => (session.isFollowing ? session.exploreIndependently() : session.returnToGroup())}
        >
          <Text style={styles.exploreToggleText}>{session.isFollowing ? "Explore on My Own" : "Return to Group"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, (!canControl || index >= totalSections - 1) && styles.navBtnDisabled]}
          onPress={() => goTo(index + 1)}
          disabled={!canControl || index >= totalSections - 1}
        >
          <Text style={styles.navBtnText}>Next</Text>
          <Ionicons name="chevron-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  errorText: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "Inter_400Regular" },
  retryBtn: { backgroundColor: "#1D9E75", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  retryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  exploreBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(184,134,11,0.15)", paddingHorizontal: 16, paddingVertical: 8,
  },
  exploreBannerText: { color: "#D9A441", fontSize: 12, fontFamily: "Inter_500Medium" },
  exploreBannerLink: { color: "#1D9E75", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  scriptureBlock: { gap: 8, marginBottom: 16 },
  scriptureCard: { backgroundColor: "#1A241E", borderRadius: 12, padding: 14 },
  scriptureText: { color: "#fff", fontSize: 14, fontStyle: "italic", fontFamily: "Inter_400Regular", lineHeight: 20 },
  scriptureRef: { color: "#1D9E75", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold", marginTop: 6 },
  sectionTitle: { color: "#fff", fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 10 },
  paragraph: { color: "rgba(255,255,255,0.85)", fontSize: 15, lineHeight: 23, fontFamily: "Inter_400Regular", marginBottom: 12 },
  footer: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)",
  },
  navBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8 },
  navBtnDisabled: { opacity: 0.35 },
  navBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  exploreToggleBtn: { backgroundColor: "#1A241E", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  exploreToggleText: { color: "#1D9E75", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
});