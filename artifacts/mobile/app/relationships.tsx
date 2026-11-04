import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { confirmAction } from "@/lib/alerts";
import { changeRelationship, getMyRelationships, makePrimaryMentor, type RelationshipCard } from "@/lib/genealogyApi";

// MY RELATIONSHIPS: the people guiding me and the people I guide. Either of us
// may pause, resume or end a relationship (ended ones stay in history; a new
// request starts again); only I choose my primary mentor. The other person is
// told — never my reason. The server enforces every rule.

const STATUS: Record<RelationshipCard["status"], string> = { pending: "Asked — waiting for an answer", active: "Walking together", paused: "Paused", ended: "Ended" };
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

export default function RelationshipsScreen() {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [data, setData] = useState<{ mentors: RelationshipCard[]; disciples: RelationshipCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await getMyRelationships()); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (key: string, run: () => Promise<unknown>, done: string) => {
    setBusy(key); setNotice(null);
    try { await run(); setNotice(done); await load(); } catch (e) { setNotice((e as Error).message); } finally { setBusy(null); }
  };

  const card = (r: RelationshipCard, iAmDisciple: boolean) => {
    const who = r.person.name;
    return (
      <View key={r.linkId} style={[s.card, r.isPrimary && iAmDisciple && { borderColor: c.accentGreen }]}>
        <View style={s.head}>
          <Avatar photoUrl={r.person.photoUrl} name={who} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{who}</Text>
            <Text style={s.meta}>
              {STATUS[r.status]}{r.isPrimary ? (iAmDisciple ? " · Your primary mentor" : " · You are their primary mentor") : ""}
              {r.status === "ended" && r.endedAt ? ` · ${date(r.endedAt)}` : r.startedAt ? ` · since ${date(r.startedAt)}` : ""}
            </Text>
          </View>
        </View>
        {r.status === "active" || r.status === "paused" ? (
          <View style={s.actions}>
            {iAmDisciple && r.status === "active" && !r.isPrimary ? (
              <AppButton label="Make primary" size="sm" variant="secondary" loading={busy === r.linkId + "p"} onPress={() => act(r.linkId + "p", () => makePrimaryMentor(r.linkId), `${who} is now your primary mentor.`)} />
            ) : null}
            {r.status === "active" ? (
              <AppButton label="Pause" size="sm" variant="tertiary" loading={busy === r.linkId + "pa"}
                onPress={() => confirmAction("Pause this relationship?", `${who} will be told it's paused. You can resume it any time.`, () => act(r.linkId + "pa", () => changeRelationship(r.linkId, "pause"), "Paused."), { confirmLabel: "Pause" })} />
            ) : (
              <AppButton label="Resume" size="sm" variant="secondary" loading={busy === r.linkId + "r"} onPress={() => act(r.linkId + "r", () => changeRelationship(r.linkId, "resume"), "Resumed.")} />
            )}
            <AppButton label="End" size="sm" variant="tertiary" loading={busy === r.linkId + "e"}
              onPress={() => confirmAction("End this relationship?", `${who} will be told it has ended. It stays in your history, and either of you can ask to walk together again later.`, () => act(r.linkId + "e", () => changeRelationship(r.linkId, "end"), "Ended. It stays in your history."), { confirmLabel: "End", destructive: true })} />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: "My relationships" }} />
      {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text style={s.meta}>{error}</Text> : null}
      {!data && !error ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 24 }} accessibilityLabel="Loading" /> : null}
      {data ? (
        <>
          <Text style={s.section} accessibilityRole="header">Guiding me</Text>
          {!data.mentors.length ? <Text style={s.meta}>No one yet.</Text> : data.mentors.map((r) => card(r, true))}
          <Text style={s.section} accessibilityRole="header">I am guiding</Text>
          {!data.disciples.length ? <Text style={s.meta}>No one yet.</Text> : data.disciples.map((r) => card(r, false))}
        </>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 10, paddingBottom: 120 },
    section: { fontSize: 15, fontFamily: "Inter_700Bold", color: c.textDark, marginTop: 8 },
    card: { padding: 12, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, gap: 10 },
    head: { flexDirection: "row", alignItems: "center", gap: 10 },
    name: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.textDark },
    meta: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.textMuted, lineHeight: 18 },
    notice: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.accentGreen },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  });
}
