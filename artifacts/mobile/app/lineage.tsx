import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, TextInput, RefreshControl } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { getBranch, getCollective, getMyLineage, searchLineage, generationLabel, type Collective, type LineagePerson, type MyLineage } from "@/lib/genealogyApi";

// MY DISCIPLESHIP LINEAGE: who discipled me, whom I disciple, and the
// generations growing from them — from discipleship relationships only (never
// connections, Family or Church membership). Built progressively for phones:
// my own mentors and disciples first, then each branch opens on a tap, so even
// a lineage of thousands never loads at once. Beyond my own relationships,
// people appear as their privacy allows. Forest of Nations below is what P2P
// Global's disciples are together — totals only, never a ranking.

export default function LineageScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [data, setData] = useState<MyLineage | null>(null);
  const [collective, setCollective] = useState<Collective | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LineagePerson[] | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.allSettled([getMyLineage(), getCollective()]);
    if (a.status === "fulfilled") { setData(a.value); setError(null); } else setError((a.reason as Error)?.message ?? "Couldn't load your lineage.");
    if (b.status === "fulfilled") setCollective(b.value);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const runSearch = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults(null); return; }
    try { setResults((await searchLineage(q.trim())).people); } catch { setResults([]); }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen options={{ title: "My discipleship lineage" }} />
      <Text style={s.lead}>Who walked with you, whom you walk with, and the generations growing from them.</Text>

      <View style={s.search}>
        <Ionicons name="search" size={18} color={c.textMuted} />
        <TextInput style={s.searchInput} value={query} onChangeText={runSearch} placeholder="Find someone in your lineage" placeholderTextColor={c.textMuted}
          accessibilityLabel="Find someone in your lineage" autoCapitalize="none" autoCorrect={false} />
      </View>
      {results ? (
        <View style={{ gap: 8 }}>
          {!results.length ? <Text style={s.meta}>No one in your lineage matches “{query.trim()}”.</Text> : results.map((p, i) => (
            <PersonRow key={(p.id ?? "p") + i} p={p} c={c} s={s} detail={p.generation ? generationLabel(p.generation, 1).split(" · ")[0] : undefined} />
          ))}
        </View>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
      {!data && !error ? <ActivityIndicator color={c.accentGreen} style={{ marginTop: 24 }} accessibilityLabel="Loading your lineage" /> : null}

      {data ? (
        <>
          <Text style={s.section} accessibilityRole="header">Above me</Text>
          {!data.mentors.length ? <Text style={s.meta}>No mentor yet. A Peer Guide walks with you once you ask and they accept.</Text> : null}
          {[...data.lineAbove].reverse().map((p, i) => <PersonRow key={"a" + i} p={p} c={c} s={s} detail={`${p.generationsAbove} generations above you`} />)}
          {data.mentors.map((p, i) => (
            <PersonRow key={"m" + i} p={p} c={c} s={s} detail={p.isPrimary ? "Your primary mentor" : "Also walking with you"} highlight={p.isPrimary} />
          ))}

          <View style={s.meCard} accessible accessibilityLabel={`You${data.me.stage ? `, ${data.me.stage.name}` : ""}`}>
            <Avatar photoUrl={data.me.photoUrl} name={data.me.name} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>You</Text>
              {data.me.stage ? <Text style={s.meta}>{data.me.stage.emoji} {data.me.stage.name}</Text> : null}
            </View>
          </View>

          <Text style={s.section} accessibilityRole="header">Below me</Text>
          {data.generations.length ? (
            <View style={s.genRow}>
              {data.generations.map((g) => <View key={g.generation} style={s.genChip}><Text style={s.genText}>{generationLabel(g.generation, g.people)}</Text></View>)}
            </View>
          ) : <Text style={s.meta}>When someone you guide accepts your walk together, they appear here — and the people they go on to disciple.</Text>}
          {data.disciples.map((p, i) => <Branch key={(p.id ?? "d") + i} p={p} depth={0} c={c} s={s} />)}

          <AppButton label="Manage my relationships" icon="people-outline" variant="secondary" onPress={() => router.push("/relationships" as any)} style={{ marginTop: 12 }} />
        </>
      ) : null}

      {collective ? (
        <View style={s.collective}>
          <Text style={s.collectiveLabel}>TOGETHER</Text>
          <Text style={s.title} accessibilityRole="header">🌍 Forest of Nations</Text>
          <Text style={s.meta}>Generations of disciples sheltering, feeding and multiplying one another across P2P Global — what we are together, not a personal stage or a ranking.</Text>
          <View style={s.stats}>
            <Stat n={collective.peopleBeingDiscipled} label="being discipled" s={s} />
            <Stat n={collective.peopleDiscipling} label="discipling others" s={s} />
            <Stat n={collective.generations} label={collective.generations === 1 ? "generation" : "generations"} s={s} />
            <Stat n={collective.countries} label={collective.countries === 1 ? "nation" : "nations"} s={s} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Stat({ n, label, s }: { n: number; label: string; s: ReturnType<typeof makeStyles> }) {
  return <View style={s.stat} accessible accessibilityLabel={`${n} ${label}`}><Text style={s.statN}>{n}</Text><Text style={s.statL}>{label}</Text></View>;
}

function PersonRow({ p, c, s, detail, highlight }: { p: LineagePerson; c: AppColors; s: ReturnType<typeof makeStyles>; detail?: string; highlight?: boolean }) {
  return (
    <View style={[s.row, highlight && { borderColor: c.accentGreen }]} accessible accessibilityLabel={`${p.name}${detail ? `. ${detail}` : ""}${p.stage ? `. ${p.stage.name}` : ""}`}>
      {p.private ? <View style={s.privateDot}><Ionicons name="person" size={18} color={c.textMuted} /></View> : <Avatar photoUrl={p.photoUrl} name={p.name} size={36} />}
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{p.name}</Text>
        <Text style={s.meta} numberOfLines={1}>{[detail, p.stage ? `${p.stage.emoji} ${p.stage.name}` : null, p.status === "paused" ? "Paused" : null].filter(Boolean).join(" · ")}</Text>
      </View>
    </View>
  );
}

/** One person below me; their own disciples open on a tap (loaded only then). */
function Branch({ p, depth, c, s }: { p: LineagePerson; depth: number; c: AppColors; s: ReturnType<typeof makeStyles> }) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<LineagePerson[] | null>(null);
  const [failed, setFailed] = useState(false);
  const has = (p.disciples ?? 0) > 0 && !!p.id;
  const toggle = async () => {
    if (!has) return;
    const next = !open; setOpen(next);
    if (next && !kids) { try { setKids((await getBranch(p.id!)).people); setFailed(false); } catch { setFailed(true); } }
  };
  return (
    <View style={{ marginLeft: Math.min(depth, 6) * 14 }}>
      <Pressable onPress={toggle} disabled={!has} style={s.row} accessibilityRole={has ? "button" : undefined}
        accessibilityState={has ? { expanded: open } : undefined}
        accessibilityLabel={`${p.name}${p.stage ? `, ${p.stage.name}` : ""}${has ? `, disciples ${p.disciples} ${p.disciples === 1 ? "person" : "people"}` : ""}`}>
        {p.private ? <View style={s.privateDot}><Ionicons name="person" size={18} color={c.textMuted} /></View> : <Avatar photoUrl={p.photoUrl} name={p.name} size={36} />}
        <View style={{ flex: 1 }}>
          <Text style={s.name} numberOfLines={1}>{p.name}</Text>
          <Text style={s.meta} numberOfLines={1}>
            {[p.stage ? `${p.stage.emoji} ${p.stage.name}` : null, has ? `Disciples ${p.disciples}` : null, p.status === "paused" ? "Paused" : null].filter(Boolean).join(" · ") || " "}
          </Text>
        </View>
        {has ? <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} /> : null}
      </Pressable>
      {open ? (
        failed ? <Text style={s.meta}>Couldn't open this branch.</Text>
          : !kids ? <ActivityIndicator color={c.accentGreen} style={{ marginVertical: 6 }} />
          : kids.map((k, i) => <Branch key={(k.id ?? "k") + i} p={k} depth={depth + 1} c={c} s={s} />)
      ) : null}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    content: { padding: 16, gap: 10, paddingBottom: 120 },
    lead: { color: c.textMid, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
    search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 14, backgroundColor: c.card },
    searchInput: { flex: 1, minHeight: 44, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 15 },
    section: { fontSize: 15, fontFamily: "Inter_700Bold", color: c.textDark, marginTop: 10 },
    row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, marginBottom: 6, minHeight: 56 },
    meCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 2, borderColor: c.accentGreen, backgroundColor: c.card, marginVertical: 4 },
    privateDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.borderBeige, alignItems: "center", justifyContent: "center" },
    title: { fontSize: 16, fontFamily: "Inter_700Bold", color: c.textDark },
    name: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.textDark },
    meta: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.textMuted, lineHeight: 18 },
    error: { color: c.textMid, fontFamily: "Inter_400Regular", fontSize: 13 },
    genRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    genChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    genText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.textMid },
    collective: { marginTop: 18, padding: 14, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, gap: 6 },
    collectiveLabel: { fontSize: 10, letterSpacing: 1.5, color: c.amber, fontFamily: "Inter_600SemiBold" },
    stats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
    stat: { flexGrow: 1, flexBasis: "40%", padding: 10, borderRadius: 12, backgroundColor: c.lightCream, alignItems: "center" },
    statN: { fontSize: 20, fontFamily: "Inter_700Bold", color: c.accentGreen },
    statL: { fontSize: 12, fontFamily: "Inter_400Regular", color: c.textMid, textAlign: "center" },
  });
}
