import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Platform, Alert, Modal,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { authedFetch } from "@/lib/adminFetch";
import { startPeerCall, buildCallRouteParams } from "@/lib/callStart";
import { ChooseLessonSheet } from "@/components/study/ChooseLessonSheet";
import type { StudyLessonMeta } from "@/hooks/useStudySession";

// Disciple Detail — My Discipleship Phase 1's primary workspace for an
// active discipleship relationship. Single load of the new
// GET /discipleship/:mentorId/disciple/:discipleId (authorization happens
// server-side there, not here). Message/Call reuse the shared
// startPeerCall/buildCallRouteParams helper (lib/callStart.ts) — the same
// peer-channel + p2p_start_direct_conversation + calls/start flow also used
// by help-requests.tsx/help-mail. Study Together first asks which lesson
// (the disciple's current one, or another chosen via the shared
// ChooseLessonSheet) before starting the call, then passes it as
// autoStudyLessonId/ModuleId/Title so the call screen can offer "Continue
// this lesson?" once connected (Phase 0's useStudySession/
// StudyTogetherOverlay, unmodified).

interface DiscipleDetailData {
  disciple: { id: string; name: string; username: string | null; photoUrl: string | null; country: string | null };
  relationship: { since: string; status: string };
  progress: {
    hasStarted: boolean;
    currentModuleId: string | null; currentModuleTitle: string | null; currentModuleNumber: number | null;
    totalModules: number | null; currentLessonId: string | null; currentLessonTitle: string | null;
    percentComplete: number | null; isFoundationComplete: boolean; lastActiveAt: string | null; isWilting: boolean;
  };
  recentActivity: { type: string; label: string; at: string }[];
  recentSessions: { id: string; title: string; sessionType: string; startedAt: string | null; durationMinutes: number | null }[];
  nextStep: { message: string; action: "view_completion_letters" | "encourage" | "study_together" | "message" | "none" };
}

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never active";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function formatSince(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatActivityDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function DiscipleDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { discipleId } = useLocalSearchParams<{ discipleId: string }>();

  const [detail, setDetail] = useState<DiscipleDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [calling, setCalling] = useState(false);
  const [startingStudy, setStartingStudy] = useState(false);
  const [studyPromptOpen, setStudyPromptOpen] = useState(false);
  const [chooseLessonOpen, setChooseLessonOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id || !discipleId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await authedFetch(`/discipleship/${user.id}/disciple/${discipleId}`);
      if (!res.ok) { setError(true); setLoading(false); return; }
      const data = await res.json();
      setDetail(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [user?.id, discipleId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Real-time: if the disciple completes a lesson while this screen is open,
  // silently refresh (same postgres_changes pattern used throughout this app).
  useEffect(() => {
    if (!discipleId) return;
    const channel = supabase
      .channel(`disciple_detail_${discipleId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "p2p_lesson_progress", filter: `user_id=eq.${discipleId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [discipleId, load]);

  async function handleMessage() {
    if (!detail) return;
    setMessaging(true);
    try {
      const { data: convId, error: err } = await supabase.rpc("p2p_start_direct_conversation", { target_id: detail.disciple.id });
      if (err || !convId) { showAlert("Can't message this user", "Please try again."); return; }
      router.push(`/messages/${convId}` as any);
    } finally {
      setMessaging(false);
    }
  }

  async function startCall(withAutoStudy: boolean, lessonOverride?: StudyLessonMeta) {
    if (!detail || !user?.id) return;
    withAutoStudy ? setStartingStudy(true) : setCalling(true);
    try {
      const result = await startPeerCall({
        supabase, currentUserId: user.id, otherUserId: detail.disciple.id, onAlert: showAlert,
      });
      if (!result) return;

      const autoStudy = !withAutoStudy ? undefined
        : lessonOverride
          ? { lessonId: lessonOverride.id, moduleId: lessonOverride.moduleId, lessonTitle: lessonOverride.title }
          : (detail.progress.currentLessonId && detail.progress.currentModuleId
              ? { lessonId: detail.progress.currentLessonId, moduleId: detail.progress.currentModuleId, lessonTitle: detail.progress.currentLessonTitle ?? "" }
              : undefined);

      router.push({
        pathname: "/call/audio",
        params: buildCallRouteParams({
          channelName: result.channelName, otherUserId: detail.disciple.id, otherUserName: detail.disciple.name,
          callId: result.incomingCallId, conversationId: result.conversationId, callLogId: result.callLogId,
          autoStudy,
        }),
      } as any);
    } finally {
      setCalling(false);
      setStartingStudy(false);
    }
  }

  function handleChooseLesson(lesson: StudyLessonMeta) {
    setChooseLessonOpen(false);
    startCall(true, lesson);
  }

  function handleNextStepAction() {
    if (!detail) return;
    switch (detail.nextStep.action) {
      case "study_together": setStudyPromptOpen(true); break;
      case "encourage": handleMessage(); break;
      case "message": handleMessage(); break;
      case "view_completion_letters": router.push("/graduates" as any); break;
      default: break;
    }
  }

  const NEXT_STEP_LABEL: Record<string, string> = {
    study_together: "Study Together", encourage: "Encourage", message: "Message",
    view_completion_letters: "Write Completion Letter", none: "",
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{detail?.disciple.name ?? "Disciple"}</Text>
      </View>

      {loading ? (
        <View style={s.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : error || !detail ? (
        <View style={s.centerFill}>
          <Text style={s.errorText}>Unable to load this discipleship profile.</Text>
          <TouchableOpacity style={s.retryBtn} onPress={load}><Text style={s.retryBtnText}>Retry</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          {/* ── Profile ── */}
          <View style={s.profileBlock}>
            {detail.disciple.photoUrl ? (
              <Image source={{ uri: detail.disciple.photoUrl }} style={s.avatar} />
            ) : (
              <View style={[s.avatar, s.avatarFallback]}>
                <Text style={s.avatarInitial}>{detail.disciple.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <Text style={s.name}>{detail.disciple.name}</Text>
            <Text style={s.relationLabel}>Your Disciple{detail.disciple.country ? ` · ${detail.disciple.country}` : ""}</Text>
            <Text style={s.sinceText}>Walking with you since {formatSince(detail.relationship.since)}</Text>
          </View>

          {/* ── Quick Actions ── */}
          <View style={s.actionsRow}>
            <TouchableOpacity style={s.actionBtn} onPress={handleMessage} disabled={messaging}>
              {messaging ? <ActivityIndicator size="small" color={colors.accentGreen} /> : (
                <><Ionicons name="chatbubble-outline" size={16} color={colors.accentGreen} /><Text style={s.actionBtnText}>Message</Text></>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={s.actionBtn} onPress={() => startCall(false)} disabled={calling}>
              {calling ? <ActivityIndicator size="small" color={colors.accentGreen} /> : (
                <><Ionicons name="call-outline" size={16} color={colors.accentGreen} /><Text style={s.actionBtnText}>Call</Text></>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.actionBtnPrimary]} onPress={() => setStudyPromptOpen(true)} disabled={startingStudy}>
              {startingStudy ? <ActivityIndicator size="small" color="#fff" /> : (
                <><Text style={s.actionBtnEmoji}>📖</Text><Text style={[s.actionBtnText, s.actionBtnTextPrimary]}>Study Together</Text></>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Next Step ── */}
          <Text style={s.sectionHeader}>Next Step</Text>
          <View style={s.nextStepCard}>
            <Text style={s.nextStepMessage}>{detail.nextStep.message}</Text>
            {detail.nextStep.action !== "none" && (
              <TouchableOpacity style={s.nextStepBtn} onPress={handleNextStepAction}>
                <Text style={s.nextStepBtnText}>{NEXT_STEP_LABEL[detail.nextStep.action]}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Current Journey ── */}
          <Text style={s.sectionHeader}>Kingdom School</Text>
          {!detail.progress.hasStarted ? (
            <View style={s.emptyCard}>
              <Text style={s.emptyCardText}>{detail.disciple.name} hasn't started a Kingdom School lesson yet.</Text>
            </View>
          ) : (
            <View style={s.journeyCard}>
              {detail.progress.isFoundationComplete ? (
                <Text style={s.journeyTitle}>Foundation Complete 🎉</Text>
              ) : (
                <>
                  <Text style={s.journeyTitle}>Module {detail.progress.currentModuleNumber} of {detail.progress.totalModules}</Text>
                  <Text style={s.journeySub}>{detail.progress.currentModuleTitle}</Text>
                  {detail.progress.currentLessonTitle && <Text style={s.journeyLesson}>Current: {detail.progress.currentLessonTitle}</Text>}
                </>
              )}
              {detail.progress.percentComplete !== null && (
                <>
                  <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${detail.progress.percentComplete}%` }]} />
                  </View>
                  <Text style={s.progressLabel}>{detail.progress.percentComplete}% complete</Text>
                </>
              )}
              <Text style={[s.lastActiveText, detail.progress.isWilting && s.lastActiveWarn]}>
                Last active: {timeAgo(detail.progress.lastActiveAt)}
                {detail.progress.isWilting ? ` — ${detail.disciple.name} hasn't been active in Kingdom School recently.` : ""}
              </Text>
            </View>
          )}

          {/* ── Discipleship Activity ── */}
          <Text style={s.sectionHeader}>Discipleship Activity</Text>
          {detail.recentActivity.length === 0 ? (
            <View style={s.emptyCard}><Text style={s.emptyCardText}>No recent discipleship activity.</Text></View>
          ) : (
            <View style={s.activityCard}>
              {detail.recentActivity.map((a, i) => (
                <View key={i} style={[s.activityRow, i > 0 && s.activityRowBorder]}>
                  <Text style={s.activityDate}>{formatActivityDate(a.at)}</Text>
                  <Text style={s.activityLabel}>{a.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Recent Sessions ── */}
          <Text style={s.sectionHeader}>Recent Sessions</Text>
          {detail.recentSessions.length === 0 ? (
            <View style={s.emptyCard}><Text style={s.emptyCardText}>You haven't had a study session together yet.</Text></View>
          ) : (
            <View style={{ gap: 8 }}>
              {detail.recentSessions.map((sess) => (
                <View key={sess.id} style={s.sessionCard}>
                  <View style={s.sessionIconWrap}><Text style={{ fontSize: 16 }}>📖</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sessionTitle}>{sess.title}</Text>
                    <Text style={s.sessionSub}>
                      {sess.durationMinutes !== null ? `${sess.durationMinutes} min` : ""}
                      {sess.startedAt ? ` · ${formatActivityDate(sess.startedAt)}` : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={studyPromptOpen} transparent animationType="fade" onRequestClose={() => setStudyPromptOpen(false)}>
        <View style={s.promptOverlay}>
          <View style={s.promptBox}>
            {detail?.progress.currentLessonId ? (
              <>
                <Text style={s.promptTitle}>Continue {detail.disciple.name}'s current lesson?</Text>
                {detail.progress.currentLessonTitle && <Text style={s.promptSub}>{detail.progress.currentLessonTitle}</Text>}
                <TouchableOpacity style={s.promptPrimaryBtn} onPress={() => { setStudyPromptOpen(false); startCall(true); }}>
                  <Text style={s.promptPrimaryBtnText}>Start Study</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.promptSecondaryBtn} onPress={() => { setStudyPromptOpen(false); setChooseLessonOpen(true); }}>
                  <Text style={s.promptSecondaryBtnText}>Choose Another Lesson</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.promptTitle}>{detail?.disciple.name} hasn't started a Kingdom School lesson yet.</Text>
                <TouchableOpacity style={s.promptPrimaryBtn} onPress={() => { setStudyPromptOpen(false); setChooseLessonOpen(true); }}>
                  <Text style={s.promptPrimaryBtnText}>Choose a Lesson</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={s.promptCancelBtn} onPress={() => setStudyPromptOpen(false)}>
              <Text style={s.promptCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ChooseLessonSheet
        visible={chooseLessonOpen}
        onClose={() => setChooseLessonOpen(false)}
        initialMode="browse"
        onChooseLesson={handleChooseLesson}
      />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", flex: 1 },
    centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    errorText: { color: c.textMuted, fontSize: 14, fontFamily: "Inter_400Regular" },
    retryBtn: { backgroundColor: c.primaryGreen, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
    retryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
    scroll: { paddingHorizontal: 16, paddingTop: 20 },

    profileBlock: { alignItems: "center", marginBottom: 20 },
    avatar: { width: 84, height: 84, borderRadius: 42, marginBottom: 10 },
    avatarFallback: { backgroundColor: c.primaryGreen, alignItems: "center", justifyContent: "center" },
    avatarInitial: { color: "#fff", fontSize: 30, fontWeight: "700", fontFamily: "Inter_700Bold" },
    name: { fontSize: 20, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    relationLabel: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 2 },
    sinceText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },

    actionsRow: { flexDirection: "row", gap: 8, marginBottom: 24 },
    actionBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
      borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 12, paddingVertical: 12,
    },
    actionBtnPrimary: { backgroundColor: c.primaryGreen, borderColor: c.primaryGreen },
    actionBtnEmoji: { fontSize: 15 },
    actionBtnText: { fontSize: 12, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    actionBtnTextPrimary: { color: "#fff" },

    sectionHeader: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10, marginTop: 4 },

    nextStepCard: {
      backgroundColor: "rgba(29,158,117,0.08)", borderWidth: 1, borderColor: "rgba(29,158,117,0.25)",
      borderRadius: 16, padding: 16, gap: 12, marginBottom: 24,
    },
    nextStepMessage: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium", lineHeight: 20 },
    nextStepBtn: { backgroundColor: c.primaryGreen, borderRadius: 10, alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10 },
    nextStepBtnText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

    emptyCard: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 24 },
    emptyCardText: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 19 },

    journeyCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, marginBottom: 24, gap: 4 },
    journeyTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    journeySub: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium" },
    journeyLesson: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
    progressTrack: { height: 6, backgroundColor: c.progressTrack, borderRadius: 3, marginTop: 10, overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: c.accentGreen, borderRadius: 3 },
    progressLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },
    lastActiveText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 },
    lastActiveWarn: { color: c.amber, fontFamily: "Inter_500Medium" },

    activityCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, marginBottom: 24, overflow: "hidden" },
    activityRow: { paddingHorizontal: 16, paddingVertical: 12 },
    activityRowBorder: { borderTopWidth: 1, borderTopColor: c.borderBeige },
    activityDate: { fontSize: 10, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
    activityLabel: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular" },

    sessionCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 24,
    },
    sessionIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
    sessionTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    sessionSub: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

    promptOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
    promptBox: { backgroundColor: c.card, borderRadius: 18, padding: 20, width: "100%", maxWidth: 360, gap: 10 },
    promptTitle: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    promptSub: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", marginBottom: 4 },
    promptPrimaryBtn: { backgroundColor: c.primaryGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 4 },
    promptPrimaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
    promptSecondaryBtn: { borderWidth: 1.5, borderColor: c.accentGreen, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
    promptSecondaryBtnText: { color: c.accentGreen, fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
    promptCancelBtn: { alignItems: "center", paddingVertical: 10 },
    promptCancelBtnText: { color: c.textMuted, fontSize: 13, fontFamily: "Inter_500Medium" },
  });
}