import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import FamilyIcon from "@/components/family/FamilyIcon";
import { Avatar } from "@/components/Avatar";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth } from "@/contexts/AuthContext";
import {
  getFamilyDetail, startFamilyWorship, removeFamilyMember, getContinueStudy,
  type FamilyDetailResponse, type ContinueStudyResponse,
} from "@/lib/familyApi";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

// One specific family's home screen — reached from MY FAMILIES
// (app/family/index.tsx). Everything here is scoped to this familyId only;
// a user who belongs to several families sees each one's own independent
// roster, prayer list, and Gathering sessions when they open it.
//
// Layout (simplified 2026-10-18): one primary action chosen by state —
// Join the live Gathering, else Continue Learning (with Start Gathering
// beside it), else Start Gathering — then a short list: Family chat (the
// permanent group conversation, migration 197), Learning, Prayer, People
// (roster, roles, invitations and per-person calls) and History & highlights.
// This replaces six equal header icons. Every destination screen is
// unchanged; app/family/calls.tsx and app/family/journey.tsx stay reachable
// (calling now lives on People's rows; Highlights from History).
export default function FamilyDetailScreen() {
  const { colors: c } = useTheme();
  const styles = makeStyles(c);
  const router = useRouter();
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<FamilyDetailResponse | null>(null);
  const [continueStudy, setContinueStudy] = useState<ContinueStudyResponse | null>(null);
  const [startingGathering, setStartingGathering] = useState(false);

  const load = useCallback(async () => {
    if (!familyId) return;
    try {
      const [detail, study] = await Promise.all([
        getFamilyDetail(familyId),
        getContinueStudy(familyId).catch(() => null),
      ]);
      setData(detail);
      setContinueStudy(study);
    } catch (e: any) {
      showAlert("Couldn't load this Family Circle", e.message ?? "Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [familyId]);

  useEffect(() => { load(); }, [load]);

  async function handleStartGathering() {
    if (!data?.family) return;
    // A Gathering already in progress just gets joined directly — no need
    // to re-call startFamilyWorship (which itself already tolerates this
    // by returning the existing session either way).
    if (data.activeSessionId) {
      router.push({ pathname: "/family/worship/[sessionId]", params: { sessionId: data.activeSessionId } } as any);
      return;
    }
    setStartingGathering(true);
    try {
      const session = await startFamilyWorship(data.family.id);
      router.push({ pathname: "/family/worship/[sessionId]", params: { sessionId: session.id } } as any);
    } catch (e: any) {
      showAlert("Couldn't start", e.message ?? "Please try again.");
    } finally {
      setStartingGathering(false);
    }
  }

  function handleLeaveFamily() {
    if (!data?.family || !profile?.id) return;
    const familyName = data.family.name;
    Alert.alert(`Leave ${familyName}?`, "You can be invited back later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave", style: "destructive", onPress: async () => {
          try {
            await removeFamilyMember(data.family.id, profile.id);
            router.replace("/family" as any);
          } catch (e: any) {
            showAlert("Couldn't leave Family Circle", e.message ?? "Please try again.");
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "Family Circle" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  if (!data?.family) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Stack.Screen options={{ title: "Family Circle" }} />
        <Text style={{ color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center" }}>
          You're not part of this Family Circle.
        </Text>
      </View>
    );
  }

  const isShepherd = data.myRole === "shepherd";
  const family = data.family;
  const live = !!data.activeSessionId;
  const next = continueStudy?.continueStudy ?? null;
  // The most relevant action for right now.
  const primary: "join" | "continue" | "start" = live ? "join" : next ? "continue" : "start";
  const openPeople = () => router.push({ pathname: "/family/members", params: { familyId } } as any);
  const openLesson = () => next && router.push({ pathname: "/lesson/[id]", params: { id: next.nextLessonId } } as any);
  const shownAvatars = data.members.slice(0, 5);

  const rows: { key: string; icon: React.ReactNode; label: string; detail?: string; onPress: () => void }[] = [
    ...(data.conversationId ? [{
      key: "chat", icon: <Ionicons name="chatbubbles-outline" size={20} color={c.accentGreen} />,
      label: "Family chat", detail: "Messages and voice notes with everyone",
      onPress: () => router.push({ pathname: "/messages/[id]", params: { id: data.conversationId! } } as any),
    }] : []),
    {
      key: "learning", icon: <Ionicons name="book-outline" size={20} color={c.accentGreen} />,
      label: "Learning", detail: "P2P Library, your series and custom lessons",
      onPress: () => router.push({ pathname: "/learning/[scope]/[groupId]", params: { scope: "family", groupId: familyId } } as any),
    },
    {
      key: "files", icon: <Ionicons name="folder-open-outline" size={20} color={c.accentGreen} />,
      label: "Files & Resources", detail: "PDFs, photos and documents for your family",
      onPress: () => router.push({ pathname: "/resources/[scope]/[groupId]", params: { scope: "family", groupId: familyId, name: data.family?.name ?? "" } } as any),
    },
    {
      key: "prayer", icon: <FamilyIcon name="prayer" size={19} color={c.accentGreen} />,
      label: "Prayer", detail: "Your family's prayer requests",
      onPress: () => router.push({ pathname: "/family/prayer", params: { familyId } } as any),
    },
    {
      key: "people", icon: <Ionicons name="people-outline" size={20} color={c.accentGreen} />,
      label: "People", detail: data.canManage ? "Members, roles, invitations and calls" : "Members and calls",
      onPress: openPeople,
    },
    {
      key: "history", icon: <Ionicons name="time-outline" size={20} color={c.accentGreen} />,
      label: "History & highlights", detail: "Past Gatherings and what you've covered",
      onPress: () => router.push({ pathname: "/family/history", params: { familyId } } as any),
    },
  ];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: family.name }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        <View style={styles.headerCard}>
          <TouchableOpacity
            style={styles.identityRow} onPress={openPeople}
            accessibilityRole="button" accessibilityLabel={`${family.name}, ${data.members.length} ${data.members.length === 1 ? "person" : "people"}`} accessibilityHint="Opens People"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.familyName}>{family.name}</Text>
              <Text style={styles.familySub}>{data.members.length} {data.members.length === 1 ? "person" : "people"}</Text>
            </View>
            <View style={styles.avatarStack} importantForAccessibility="no-hide-descendants">
              {shownAvatars.map((m, i) => (
                <View key={m.id} style={[styles.avatarRing, i > 0 && { marginLeft: -10 }]}>
                  <Avatar photoUrl={m.avatarUrl} name={m.name} size={30} />
                </View>
              ))}
            </View>
          </TouchableOpacity>

          {live && (
            <View style={styles.liveRow} accessibilityLiveRegion="polite">
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>A Gathering is happening now</Text>
            </View>
          )}
          {primary === "continue" && next && (
            <Text style={styles.nextText} numberOfLines={2}>Next: {next.nextLessonTitle}</Text>
          )}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={primary === "continue" ? openLesson : handleStartGathering}
            disabled={startingGathering && primary !== "continue"}
            accessibilityRole="button"
          >
            {startingGathering && primary !== "continue" ? <ActivityIndicator color={c.primaryGreen} size="small" /> : (
              <Text style={styles.primaryBtnText}>
                {primary === "join" ? "Join Gathering" : primary === "continue" ? "Continue Learning" : "Start Gathering"}
              </Text>
            )}
          </TouchableOpacity>
          {primary === "continue" && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleStartGathering} disabled={startingGathering} accessibilityRole="button">
              {startingGathering ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.secondaryBtnText}>Start Gathering</Text>}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.listCard}>
          {rows.map((r, i) => (
            <TouchableOpacity
              key={r.key} style={[styles.listRow, i === rows.length - 1 && styles.listRowLast]} onPress={r.onPress}
              accessibilityRole="button" accessibilityLabel={r.label} accessibilityHint={r.detail}
            >
              <View style={styles.listIcon}>{r.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listLabel}>{r.label}</Text>
                {r.detail ? <Text style={styles.listDetail} numberOfLines={1}>{r.detail}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Continue Study — shown as a card only when the main button isn't
            already "Continue Learning" (a Gathering is live), so the same
            lesson link never appears twice. */}
        {live && next && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Continue Study</Text>
            {!!next.curriculumTitle && <Text style={styles.cardSub}>{next.curriculumTitle}</Text>}
            <Text style={styles.cardBody}>Next: {next.nextLessonTitle}</Text>
            <TouchableOpacity style={styles.cardLinkBtn} onPress={openLesson} accessibilityRole="button">
              <Text style={styles.cardLinkBtnText}>Open Study Workspace →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Last Gathering — the same data already on the Session Summary,
            surfaced here so a family doesn't have to open History first. */}
        {continueStudy?.previousGathering && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Last Gathering</Text>
            {!!continueStudy.previousGathering.lessonTitle && <Text style={styles.cardSub}>{continueStudy.previousGathering.lessonTitle}</Text>}
            <Text style={styles.cardBody}>
              {Math.round(continueStudy.previousGathering.durationSeconds / 60)}m · {continueStudy.previousGathering.participantCount} participant{continueStudy.previousGathering.participantCount === 1 ? "" : "s"}
            </Text>
            <TouchableOpacity
              style={styles.cardLinkBtn}
              onPress={() => router.push({ pathname: "/family/gathering-summary", params: { historyId: continueStudy.previousGathering!.historyId, familyId } } as any)}
              accessibilityRole="button"
            >
              <Text style={styles.cardLinkBtnText}>View Summary →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Discipleship Journey — a visualization of which existing
            curriculum lessons this family has covered together in past
            Gatherings, not a duplicate progress system (§7). */}
        {continueStudy?.discipleshipJourney && continueStudy.discipleshipJourney.lessons.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Discipleship Journey</Text>
            {!!continueStudy.discipleshipJourney.curriculumTitle && <Text style={styles.cardSub}>{continueStudy.discipleshipJourney.curriculumTitle}</Text>}
            {continueStudy.discipleshipJourney.lessons.slice(0, 8).map((l) => (
              <View key={l.id} style={styles.journeyRow}>
                <Ionicons
                  name={l.status === "done" ? "checkmark-circle" : l.status === "current" ? "arrow-forward-circle" : "ellipse-outline"}
                  size={16}
                  color={l.status === "done" ? c.primaryGreen : l.status === "current" ? c.accentGreen : c.textMuted}
                />
                <Text style={[styles.journeyRowText, l.status === "upcoming" && { color: c.textMuted }]} numberOfLines={1}>{l.title}</Text>
              </View>
            ))}
          </View>
        )}

        {!isShepherd && (
          <TouchableOpacity style={styles.leaveRow} onPress={handleLeaveFamily} accessibilityRole="button">
            <Ionicons name="exit-outline" size={18} color={c.textMuted} />
            <Text style={styles.leaveText}>Leave this Family Circle</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    scroll: { padding: 16, paddingBottom: 40, gap: 14 },

    headerCard: {
      backgroundColor: c.primaryGreen, borderRadius: 18, padding: 20, gap: 4,
    },
    identityRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
    familyName: { fontSize: 20, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    familySub: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
    avatarStack: { flexDirection: "row", alignItems: "center" },
    avatarRing: { borderRadius: 17, borderWidth: 2, borderColor: c.primaryGreen },
    liveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ADE80" },
    liveText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
    nextText: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 12 },
    primaryBtn: {
      alignItems: "center", justifyContent: "center", minHeight: 48,
      backgroundColor: "#fff", borderRadius: 12, paddingVertical: 13, marginTop: 14,
    },
    primaryBtnText: { color: c.primaryGreen, fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
    secondaryBtn: {
      alignItems: "center", justifyContent: "center", minHeight: 44,
      backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 12, paddingVertical: 11, marginTop: 8,
    },
    secondaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

    listCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, paddingHorizontal: 14 },
    listRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderBeige },
    listRowLast: { borderBottomWidth: 0 },
    listIcon: { width: 32, alignItems: "center" },
    listLabel: { fontSize: 15, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    listDetail: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

    leaveRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10 },
    leaveText: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium" },

    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 16, gap: 4 },
    cardTitle: { fontSize: 14, color: c.textDark, fontFamily: "Inter_700Bold" },
    cardSub: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    cardBody: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular" },
    cardLinkBtn: { marginTop: 6 },
    cardLinkBtnText: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    journeyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
    journeyRowText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_400Regular", flex: 1 },
  });
}
