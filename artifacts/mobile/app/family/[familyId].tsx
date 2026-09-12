import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform, RefreshControl } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
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
// Members and Prayer are reachable via the small icon buttons in the
// header (not full-width cards) — they used to be duplicated as their own
// landing-page cards here, which read as redundant next to the same
// information already surfaced elsewhere (member count in the header,
// Prayer itself inside the Study Workspace). The routes/screens
// (app/family/members.tsx, app/family/prayer.tsx) are unchanged.
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
      showAlert("Couldn't load this family", e.message ?? "Please try again.");
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
            showAlert("Couldn't leave family", e.message ?? "Please try again.");
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Stack.Screen options={{ title: "Family" }} />
        <ActivityIndicator color={c.primaryGreen} />
      </View>
    );
  }

  if (!data?.family) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Stack.Screen options={{ title: "Family" }} />
        <Text style={{ color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center" }}>
          You're not a member of this Family Gathering.
        </Text>
      </View>
    );
  }

  const isShepherd = data.myRole === "shepherd";

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: data.family.name }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.primaryGreen} />}
      >
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.familyName}>{data.family.name}</Text>
              <Text style={styles.familySub}>{data.members.length} member{data.members.length === 1 ? "" : "s"}</Text>
            </View>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push({ pathname: "/family/members", params: { familyId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Members"
            >
              <Ionicons name="people" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push({ pathname: "/family/prayer", params: { familyId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Prayer"
            >
              <Text style={{ fontSize: 16 }}>🙏</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push({ pathname: "/family/calls", params: { fid: familyId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Calls"
            >
              <Ionicons name="call" size={16} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push({ pathname: "/family/studies", params: { familyId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Study"
            >
              <Ionicons name="book-outline" size={16} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push({ pathname: "/family/history", params: { familyId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Gathering History"
            >
              <Ionicons name="time-outline" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push({ pathname: "/family/journey", params: { familyId } } as any)}
              accessibilityRole="button"
              accessibilityLabel="Family Journey"
            >
              <Ionicons name="trail-sign-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.gatheringBtn} onPress={handleStartGathering} disabled={startingGathering}>
            {startingGathering ? <ActivityIndicator color="#fff" size="small" /> : (
              <Text style={styles.gatheringBtnText}>{data.activeSessionId ? "Join Family Gathering" : "Start Gathering"}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Continue Study — only when the last Gathering was explicitly
            about a lesson and the curriculum has a next one. Never assumes
            an unrelated (prayer-only/fellowship) Gathering continues
            anything — see familyWorship.ts's GET /worship/continue-study. */}
        {continueStudy?.continueStudy && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Continue Study</Text>
            {!!continueStudy.continueStudy.curriculumTitle && <Text style={styles.cardSub}>{continueStudy.continueStudy.curriculumTitle}</Text>}
            <Text style={styles.cardBody}>Next: {continueStudy.continueStudy.nextLessonTitle}</Text>
            <TouchableOpacity
              style={styles.cardLinkBtn}
              onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: continueStudy.continueStudy!.nextLessonId } } as any)}
              accessibilityRole="button"
            >
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
            <Text style={styles.leaveText}>Leave this family</Text>
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
    headerTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    headerIconBtn: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.16)",
      alignItems: "center", justifyContent: "center",
    },
    familyName: { fontSize: 20, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
    familySub: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
    gatheringBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 12, paddingVertical: 13, marginTop: 14,
    },
    gatheringBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

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
