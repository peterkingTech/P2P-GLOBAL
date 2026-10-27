import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { getMyStudies, respondToStudy, invitationNote, DESTINATION_LABELS, type StudyCard } from "@/lib/studyTogetherApi";

// My Study Together: invitations to answer, studies to resume (Resume Study),
// and concluded ones. Group studies appear here for every member of the
// family / church / circle / group the moment a leader starts one.

export default function MyStudiesScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [data, setData] = useState<{ invitations: StudyCard[]; active: StudyCard[]; concluded: StudyCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await getMyStudies()); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load your studies."); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (id: string) => router.push(`/study-together/${id}` as any);
  async function respond(card: StudyCard, response: "accepted" | "declined") {
    setBusy(card.id);
    try { await respondToStudy(card.id, response); if (response === "accepted") open(card.id); await load(); }
    catch (e: any) { setError(e?.message ?? "That didn't work."); await load(); }
    finally { setBusy(null); }
  }
  const where = (x: StudyCard) => (x.destination.type === "peer" ? (x.isHost ? "You invited peers" : `With ${x.host.name}`) : `${DESTINATION_LABELS[x.destination.type]} · ${x.destination.name ?? ""}`);
  const kind = (x: StudyCard) => (x.contentType === "kingdom_story" ? "Kingdom Story" : "Lesson");

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: "Study Together" }} />
      <Text style={s.title} accessibilityRole="header">Study Together</Text>
      <Text style={s.meta}>Study a Kingdom Story or lesson with a peer or your group, each at your own pace. Start one from any story ("Study Together") or lesson.</Text>
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
      {!data && !error ? <ActivityIndicator style={{ marginTop: 24 }} color={c.accentGreen} /> : null}

      {data?.invitations.length ? <Text style={s.section} accessibilityRole="header">Invitations</Text> : null}
      {data?.invitations.map((x) => (
        <View key={x.id} style={s.card}>
          <Text style={s.kicker}>{kind(x)}</Text>
          <Text style={s.cardTitle}>{x.title}</Text>
          <Text style={s.meta}>{x.host.name} invited you. {invitationNote(x) ?? ""}</Text>
          <View style={s.row}>
            <TouchableOpacity style={s.btn} disabled={busy === x.id} onPress={() => respond(x, "accepted")} accessibilityRole="button" accessibilityLabel={`Accept invitation to study ${x.title}`}>
              {busy === x.id ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Accept</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.btnSecondary} disabled={busy === x.id} onPress={() => respond(x, "declined")} accessibilityRole="button" accessibilityLabel={`Decline invitation to study ${x.title}`}>
              <Text style={s.btnSecondaryText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnSecondary} onPress={() => open(x.id)} accessibilityRole="button"><Text style={s.btnSecondaryText}>Details</Text></TouchableOpacity>
          </View>
        </View>
      ))}

      {data ? <Text style={s.section} accessibilityRole="header">Studying now</Text> : null}
      {data && !data.active.length ? <Text style={s.meta}>Nothing yet. Open a Kingdom Story and tap Study Together.</Text> : null}
      {data?.active.map((x) => (
        <TouchableOpacity key={x.id} style={s.card} onPress={() => open(x.id)} accessibilityRole="button" accessibilityLabel={`Resume study: ${x.title}`}>
          <Text style={s.kicker}>{kind(x)}</Text>
          <View style={s.row}>
            <Text style={[s.cardTitle, { flex: 1 }]}>{x.title}</Text>
            <Text style={s.resume}>Resume Study</Text>
            <Ionicons name="chevron-forward" size={16} color={c.accentGreen} />
          </View>
          <Text style={s.meta}>{where(x)}</Text>
        </TouchableOpacity>
      ))}

      {data?.concluded.length ? <Text style={s.section} accessibilityRole="header">Concluded</Text> : null}
      {data?.concluded.map((x) => (
        <TouchableOpacity key={x.id} style={[s.card, { opacity: 0.8 }]} onPress={() => open(x.id)} accessibilityRole="button">
          <Text style={s.cardTitle}>{x.title}</Text>
          <Text style={s.meta}>{where(x)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 10, paddingBottom: 48, width: "100%", maxWidth: 760, alignSelf: "center" },
    title: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 12 },
    meta: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    error: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_500Medium" },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 6 },
    kicker: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    resume: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
    btn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.primaryGreen, alignItems: "center", justifyContent: "center" },
    btnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
    btnSecondary: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, alignItems: "center", justifyContent: "center" },
    btnSecondaryText: { color: c.textDark, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  });
}
