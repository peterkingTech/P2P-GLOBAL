import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import {
  getMyStudies, respondToStudy, invitationNote, hubItems, hubFilters, HUB_FILTER_LABELS,
  type MyStudies, type StudyCard, type HubFilter, type HubItem,
} from "@/lib/studyTogetherApi";
import { AppButton, ChipRow, FilterChip, SegmentedControl } from "@/components/ui";

// Study Together — the hub for every shared study the reader may open, wherever
// it was started (a Kingdom Story, a Kingdom School lesson, a Family Circle,
// Church, circle or group). One collection over the real records:
//   • shared studies (migration 216: peer invitations and group studies), and
//   • the custom studies a Family Circle or Church has published.
// Every card opens its own study screen; nothing is copied and nobody's
// personal progress or private reflections are read here.
// Sections: Continue Studying Together · Invitations · All Shared Studies
// (filters only for kinds that exist, In progress / Completed) · Start a Study
// · Join a Study. Scheduled studies and reminders are not offered yet — a
// shared study has no date or time to schedule (that needs a reviewed
// database change).

export default function StudyTogetherHub() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [data, setData] = useState<MyStudies | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<HubFilter>("all");
  const [view, setView] = useState<"progress" | "completed">("progress");

  const load = useCallback(async () => {
    try { setData(await getMyStudies()); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load your studies."); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (r: HubItem["route"]) => router.push(r as any);
  async function respond(card: StudyCard, response: "accepted" | "declined") {
    setBusy(card.id);
    try { await respondToStudy(card.id, response); if (response === "accepted") router.push(`/study-together/${card.id}` as any); await load(); }
    catch (e: any) { setError(e?.message ?? "That didn't work."); await load(); }
    finally { setBusy(null); }
  }

  const items = data ? hubItems(data) : [];
  const filters = hubFilters(items);
  const activeFilter = filters.includes(filter) ? filter : "all";
  const continuing = items.filter((x) => x.kind === "shared" && !x.concluded).slice(0, 3);
  const listed = items.filter((x) => (activeFilter === "all" || x.filter === activeFilter) && (view === "completed" ? x.concluded : !x.concluded));
  const hasCompleted = items.some((x) => x.concluded);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: "Study Together" }} />
      <Text style={s.title} accessibilityRole="header">Study Together</Text>
      <Text style={s.meta}>Every study you share with a peer, your Family Circle, Church, circle or group — wherever it started. Each person keeps their own progress, and your reflections stay private unless you post them.</Text>
      {error ? (
        <View style={s.row}>
          <Text style={[s.error, { flex: 1 }]} accessibilityRole="alert">{error}</Text>
          <AppButton label="Try again" onPress={load} variant="secondary" />
        </View>
      ) : null}
      {!data && !error ? <ActivityIndicator style={{ marginTop: 24 }} color={c.accentGreen} accessibilityLabel="Loading your studies" /> : null}

      {/* Continue Studying Together */}
      {continuing.length ? <Text style={s.section} accessibilityRole="header">Continue Studying Together</Text> : null}
      {continuing.map((x) => (
        <TouchableOpacity key={x.key} style={[s.card, s.lead]} onPress={() => open(x.route)} accessibilityRole="button" accessibilityLabel={`Continue study: ${x.title}. ${x.typeLabel}. ${x.where}`}>
          <View style={s.icon}><Ionicons name={x.filter === "kingdom_story" ? "library-outline" : "school-outline"} size={22} color={c.accentGreen} /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.kicker}>{x.typeLabel}</Text>
            <Text style={s.cardTitle} numberOfLines={2}>{x.title}</Text>
            <Text style={s.meta} numberOfLines={1}>{x.where} · {lastActive(x.when)}</Text>
          </View>
          <View style={s.continueBtn}><Text style={s.btnText}>Continue</Text></View>
        </TouchableOpacity>
      ))}

      {/* Invitations (Join a Study) */}
      {data?.invitations.length ? <Text style={s.section} accessibilityRole="header">Invitations</Text> : null}
      {data?.invitations.map((x) => (
        <View key={x.id} style={s.card}>
          <Text style={s.kicker}>{x.contentType === "kingdom_story" ? "Kingdom Story" : "Kingdom School lesson"}</Text>
          <Text style={s.cardTitle}>{x.title}</Text>
          <Text style={s.meta}>{x.host.name} invited you. {invitationNote(x) ?? ""}</Text>
          <View style={s.row}>
            <AppButton label="Accept" onPress={() => respond(x, "accepted")} disabled={busy === x.id} loading={busy === x.id} accessibilityLabel={`Accept invitation to study ${x.title}`} />
            <AppButton label="Decline" onPress={() => respond(x, "declined")} variant="secondary" disabled={busy === x.id} accessibilityLabel={`Decline invitation to study ${x.title}`} />
            <AppButton label="Details" onPress={() => router.push(`/study-together/${x.id}` as any)} variant="secondary" accessibilityLabel={`Details: ${x.title}`} />
          </View>
        </View>
      ))}

      {/* All Shared Studies */}
      {data ? (
        <>
          <Text style={s.section} accessibilityRole="header">All Shared Studies</Text>
          {filters.length > 2 ? (
            <ChipRow accessibilityLabel="Filter by kind" single>
              {filters.map((f) => (
                <FilterChip key={f} label={HUB_FILTER_LABELS[f]} selected={activeFilter === f} selection="single" onPress={() => setFilter(f)} />
              ))}
            </ChipRow>
          ) : null}
          {hasCompleted ? (
            <SegmentedControl accessibilityLabel="Show" value={view} onChange={setView}
              options={[{ value: "progress", label: "In progress" }, { value: "completed", label: "Completed" }]} />
          ) : null}
          {listed.length === 0 ? <Text style={s.meta}>{view === "completed" ? "No completed studies yet." : "No shared studies yet. Start one below, or accept an invitation."}</Text> : null}
          {listed.map((x) => (
            <TouchableOpacity key={x.key} style={[s.card, x.concluded && { opacity: 0.85 }]} onPress={() => open(x.route)} accessibilityRole="button" accessibilityLabel={`${x.concluded ? "Completed" : "Open"} study: ${x.title}. ${x.typeLabel}. ${x.where}`}>
              <Text style={s.kicker}>{x.typeLabel}{x.concluded ? " · Completed" : ""}</Text>
              <View style={s.row}>
                <Text style={[s.cardTitle, { flex: 1 }]}>{x.title}</Text>
                <Ionicons name="chevron-forward" size={16} color={c.accentGreen} />
              </View>
              <Text style={s.meta}>{x.where}</Text>
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      {/* Start a Study / Join a Study */}
      <Text style={s.section} accessibilityRole="header">Start a Study</Text>
      <Text style={s.meta}>Choose what to study, then tap Study Together on it to invite a peer or start it with a group you lead.</Text>
      <View style={s.row}>
        <AppButton label="A Kingdom Story" onPress={() => router.push("/kingdom-stories" as any)} variant="secondary" icon="library-outline" accessibilityLabel="Choose a Kingdom Story to study together" />
        <AppButton label="A Kingdom School lesson" onPress={() => router.push("/kingdom-school" as any)} variant="secondary" icon="school-outline" accessibilityLabel="Choose a Kingdom School lesson to study together" />
      </View>
      <Text style={s.section} accessibilityRole="header">Join a Study</Text>
      <Text style={s.meta}>Peer invitations appear under Invitations. Studies your Family Circle, Church, circle or group starts appear here automatically for every member.</Text>
    </ScrollView>
  );
}

function lastActive(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "Active today" : days === 1 ? "Active yesterday" : `Active ${days} days ago`;
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 10, paddingBottom: 48, width: "100%", maxWidth: 760, alignSelf: "center" },
    title: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    section: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold", marginTop: 14 },
    meta: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular" },
    error: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_500Medium" },
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 6 },
    lead: { flexDirection: "row", alignItems: "center", gap: 12 },
    icon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: `${c.accentGreen}1F` },
    kicker: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    cardTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
    continueBtn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.primaryGreen, alignItems: "center", justifyContent: "center" },
    btnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  });
}
