import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Animated, Platform } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Circle } from "react-native-svg";
import { useAuth } from "@/contexts/AuthContext";
import { useData, GenerationalForestData, ForestPerson } from "@/contexts/DataContext";
import type { ForestMenteeNode } from "@/contexts/data/types";
import colors from "@/constants/colors";
import { STAGES, getStageFromPoints } from "@/constants/stages";
import { getContinent, getFlagEmoji, CONTINENT_LABELS, type Continent } from "@/lib/countryGeo";
import { Avatar } from "@/components/Avatar";
import { VerificationBadge } from "@/components/VerificationBadge";
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";
import { getCollective, type Collective } from "@/lib/genealogyApi";

// MY GENERATIONAL FOREST.
//   • My Forest — your place in discipleship: who walked with you (above),
//     you, and each generation growing from you, as people (not icons), with
//     their personal stage. Totals for your own lineage. Tap a person to open
//     their profile; the full, searchable lineage is one tap away.
//   • Global — Forest of Nations: what P2P Global's disciples are together,
//     from real totals only (no names, never a ranking), and your own reach
//     across the nations.
// Data: GET /profiles/:id/forest (your lineage, signed in) and
// GET /genealogy/collective (totals). Personal stages top out at Forest
// Builder; Forest of Nations is collective.

type Tab = "mine" | "global";
const ACTIVE_DAYS = 14;
const isActive = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < ACTIVE_DAYS * 86_400_000;
const stageOf = (points: number) => STAGES[getStageFromPoints(points)];
const firstName = (name: string) => (name || "A disciple").split(" ")[0];

/** The lineage below you, generation by generation (generation 1 = the people you disciple). */
function generationsOf(mentees: ForestMenteeNode[]): ForestMenteeNode[][] {
  const out: ForestMenteeNode[][] = [];
  let level = mentees;
  while (level.length && out.length < 12) {
    out.push(level);
    level = level.flatMap((m) => m.mentees ?? []);
  }
  return out;
}

export default function ForestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { forestData, forestDataLoading, loadForestData } = useData();
  const params = useLocalSearchParams<{ reveal?: string }>();
  const isReveal = params.reveal === "true";

  const [tab, setTab] = useState<Tab>("mine");
  const [refreshing, setRefreshing] = useState(false);
  const [collective, setCollective] = useState<Collective | null>(null);
  const [collectiveError, setCollectiveError] = useState(false);
  const reveal = useRef(new Animated.Value(isReveal ? 0 : 1)).current;

  const load = useCallback(async () => {
    if (!profile?.id) return;
    await Promise.all([
      loadForestData(profile.id),
      getCollective().then((c) => { setCollective(c); setCollectiveError(false); }).catch(() => setCollectiveError(true)),
    ]);
  }, [profile?.id, loadForestData]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isReveal || !forestData) return;
    Animated.timing(reveal, { toValue: 1, duration: 1400, useNativeDriver: Platform.OS !== "web" }).start();
  }, [isReveal, forestData, reveal]);

  const openPerson = (p: ForestPerson) => {
    if (p.username) { router.push(`/profile/${p.username}` as any); return; }
    const st = stageOf(p.growthLevel);
    showAlert(p.displayName || "A disciple", `${getFlagEmoji(p.country)} ${p.country ?? "Location not shared"}\n${st.emoji} ${st.name}`);
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity accessibilityLabel="Back" accessibilityRole="button" onPress={() => router.back()} hitSlop={10} style={s.headerBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.primaryGreen} />
        </TouchableOpacity>
        <Text style={s.headerTitle} accessibilityRole="header">My Generational Forest</Text>
        <TouchableOpacity accessibilityLabel="My discipleship lineage" accessibilityRole="button" onPress={() => router.push("/lineage" as any)} hitSlop={10} style={s.headerBtn}>
          <Ionicons name="git-network-outline" size={20} color={colors.primaryGreen} />
        </TouchableOpacity>
      </View>

      <View style={s.segment} accessibilityRole="tablist">
        {(["mine", "global"] as const).map((t) => (
          <TouchableOpacity key={t} style={[s.segmentBtn, tab === t && s.segmentBtnActive]} onPress={() => setTab(t)}
            accessibilityRole="tab" accessibilityState={{ selected: tab === t }} accessibilityLabel={t === "mine" ? "My Forest" : "Global: Forest of Nations"}>
            <Ionicons name={t === "mine" ? "leaf" : "earth"} size={15} color={tab === t ? "#fff" : colors.textMid} />
            <Text style={[s.segmentText, tab === t && s.segmentTextActive]}>{t === "mine" ? "My Forest" : "Global"}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.accentGreen} />}>
        {tab === "mine" ? (
          forestDataLoading && !forestData ? <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 40 }} accessibilityLabel="Loading your forest" />
            : !forestData ? <Text style={s.empty}>Couldn't load your forest. Pull down to try again.</Text>
            : <MyForest data={forestData} reveal={reveal} onPerson={openPerson} onLineage={() => router.push("/lineage" as any)} onRelationships={() => router.push("/relationships" as any)} />
        ) : (
          <GlobalForest collective={collective} failed={collectiveError} mine={forestData} />
        )}
      </ScrollView>
    </View>
  );
}

// ── My Forest ────────────────────────────────────────────────────────────────

function MyForest({ data, reveal, onPerson, onLineage, onRelationships }: {
  data: GenerationalForestData; reveal: Animated.Value; onPerson: (p: ForestPerson) => void; onLineage: () => void; onRelationships: () => void;
}) {
  const gens = useMemo(() => generationsOf(data.mentees), [data.mentees]);
  const ancestry = useMemo(() => [...data.ancestry].sort((a, b) => b.generation - a.generation), [data.ancestry]);
  const me = stageOf(data.self.growthLevel);
  const nations = data.stats.countriesRepresented.length;
  const scale = reveal.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

  return (
    <>
      <Animated.View style={[s.hero, { opacity: reveal, transform: [{ scale }] }]}>
        <View style={s.heroTop}>
          <View style={s.heroBadge}><Text style={s.heroEmoji}>{me.emoji}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroKicker}>YOUR FOREST</Text>
            <Text style={s.heroTitle}>{data.stats.totalInLineage ? `${data.stats.totalInLineage} ${data.stats.totalInLineage === 1 ? "person" : "people"} growing from your walk` : "Your forest begins with you"}</Text>
            <Text style={s.heroSub}>You: {me.name}</Text>
          </View>
        </View>
        <View style={s.tiles}>
          <Tile icon="people" value={data.stats.totalInLineage} label="In your lineage" />
          <Tile icon="layers" value={gens.length} label={gens.length === 1 ? "Generation" : "Generations"} />
          <Tile icon="earth" value={nations} label={nations === 1 ? "Nation" : "Nations"} />
          <Tile icon="book" value={data.stats.totalModulesCompletedAcrossLineage} label="Modules learned" />
          <Tile icon="sparkles" value={data.stats.totalFruitsAcrossLineage} label="Fruits recognised" />
        </View>
      </Animated.View>

      <Text style={s.section} accessibilityRole="header">Who walked with you</Text>
      {!ancestry.length ? (
        <View style={s.note}><Ionicons name="leaf-outline" size={18} color={colors.accentGreen} /><Text style={s.noteText}>Your story begins here. A Peer Guide walks with you once you ask and they accept.</Text></View>
      ) : (
        <View>
          {ancestry.map((a) => (
            <PathRow key={a.userId} person={a} label={a.generation === 1 ? "Your mentor" : `${a.generation} generations above you`} onPress={() => onPerson(a)} />
          ))}
        </View>
      )}

      <View style={s.youCard} accessible accessibilityLabel={`You, ${me.name}`}>
        <Avatar photoUrl={data.self.photoUrl} name={data.self.displayName} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={s.youName}>You</Text>
          <Text style={s.meta}>{me.emoji} {me.name}{data.self.country ? ` · ${getFlagEmoji(data.self.country)} ${data.self.country}` : ""}</Text>
        </View>
        <Ionicons name="location" size={18} color={colors.accentGreen} />
      </View>

      <Text style={s.section} accessibilityRole="header">Growing from you</Text>
      {!gens.length ? (
        <View style={s.note}><Ionicons name="hand-left-outline" size={18} color={colors.accentGreen} /><Text style={s.noteText}>When someone you guide accepts your walk together, they appear here — and the people they go on to disciple.</Text></View>
      ) : gens.map((people, i) => (
        <View key={i} style={s.gen}>
          <View style={s.genHead}>
            <View style={s.genDot}><Text style={s.genDotText}>{i + 1}</Text></View>
            <Text style={s.genTitle}>Generation {i + 1}</Text>
            <Text style={s.meta}>{people.length} {people.length === 1 ? "person" : "people"}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.genRow}>
            {people.map((p) => <PersonChip key={p.userId} person={p} onPress={() => onPerson(p)} />)}
          </ScrollView>
        </View>
      ))}

      <View style={s.actions}>
        <AppButton label="My discipleship lineage" icon="git-network-outline" variant="secondary" onPress={onLineage} palette="fixedLight" />
        <AppButton label="My relationships" icon="people-outline" variant="tertiary" onPress={onRelationships} palette="fixedLight" />
      </View>
    </>
  );
}

function Tile({ icon, value, label, half }: { icon: keyof typeof Ionicons.glyphMap; value: number; label: string; half?: boolean }) {
  return (
    <View style={[s.tile, half && s.tileHalf]} accessible accessibilityLabel={`${value} ${label}`}>
      <Ionicons name={icon} size={16} color={colors.accentGreen} />
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

function PathRow({ person, label, onPress }: { person: ForestPerson; label: string; onPress: () => void }) {
  const st = stageOf(person.growthLevel);
  return (
    <TouchableOpacity style={s.pathRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${person.displayName}, ${label}, ${st.name}`}>
      <Avatar photoUrl={person.photoUrl} name={person.displayName} size={36} />
      <View style={{ flex: 1 }}>
        <View style={s.nameRow}><Text style={s.name} numberOfLines={1}>{person.displayName}</Text><VerificationBadge isVerified={person.isVerified} size="small" /></View>
        <Text style={s.meta} numberOfLines={1}>{label} · {st.emoji} {st.name}{person.country ? ` · ${getFlagEmoji(person.country)}` : ""}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function PersonChip({ person, onPress }: { person: ForestPerson; onPress: () => void }) {
  const st = stageOf(person.growthLevel);
  const active = isActive(person.lastActiveAt);
  return (
    <TouchableOpacity style={s.chip} onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${person.displayName}, ${st.name}${active ? ", active recently" : ""}`}>
      <View>
        <Avatar photoUrl={person.photoUrl} name={person.displayName} size={52} />
        {active ? <View style={s.activeDot} /> : null}
      </View>
      <Text style={s.chipName} numberOfLines={1}>{firstName(person.displayName)}</Text>
      <Text style={s.chipStage} numberOfLines={1}>{st.emoji} {st.name}</Text>
      {person.country ? <Text style={s.chipFlag}>{getFlagEmoji(person.country)}</Text> : null}
    </TouchableOpacity>
  );
}

// ── Global: Forest of Nations ───────────────────────────────────────────────

// Stylised continent shapes (no map library; relative position only) and where "you" sits on each.
const CONTINENTS: { key: Continent; d: string; pin: [number, number] }[] = [
  { key: "north_america", d: "M22,26 C12,48 22,78 46,86 C64,90 78,72 74,48 C70,28 52,14 22,26 Z", pin: [46, 54] },
  { key: "south_america", d: "M58,98 C46,118 52,150 64,160 C76,166 82,140 78,116 C76,102 68,94 58,98 Z", pin: [66, 128] },
  { key: "europe", d: "M136,22 C128,34 136,48 152,48 C168,48 176,32 166,22 C156,14 144,14 136,22 Z", pin: [152, 32] },
  { key: "africa", d: "M138,56 C124,80 130,116 148,130 C166,138 180,108 174,76 C170,56 154,48 138,56 Z", pin: [154, 92] },
  { key: "asia", d: "M180,20 C170,44 186,72 216,80 C246,86 270,64 266,36 C262,16 230,6 180,20 Z", pin: [222, 46] },
  { key: "oceania", d: "M222,116 C214,130 226,146 244,146 C262,144 266,126 254,114 C244,106 230,108 222,116 Z", pin: [240, 128] },
];

function GlobalForest({ collective, failed, mine }: { collective: Collective | null; failed: boolean; mine: GenerationalForestData | null }) {
  const myCountries = mine?.stats.countriesRepresented ?? [];
  const lit = new Set(myCountries.map((c) => getContinent(c)).filter((c): c is Continent => !!c));
  const home = getContinent(mine?.self.country ?? null);
  const homePin = CONTINENTS.find((z) => z.key === home)?.pin;
  const total = collective ? collective.stages.reduce((n, x) => n + (x.people ?? 0), 0) : 0;
  const months = collective?.relationshipsBegun ?? [];
  const peak = Math.max(1, ...months.map((m) => m.relationships ?? 0));
  const few = (n: number | null | undefined) => `fewer than ${n ?? 5}`;

  return (
    <>
      <View style={[s.hero, s.heroGlobal]}>
        <Text style={s.heroKickerLight}>TOGETHER</Text>
        <Text style={s.heroTitleLight} accessibilityRole="header">🌍 Forest of Nations</Text>
        <Text style={s.heroSubLight}>“The nations will walk by its light.” — Revelation 21:24</Text>
        <Text style={s.heroBodyLight}>Generations of disciples sheltering, feeding and multiplying one another across P2P Global. Not a personal stage, and never a ranking — this is what we are together.</Text>
      </View>

      {failed && !collective ? <Text style={s.empty}>Couldn't load the Forest of Nations. Pull down to try again.</Text> : !collective ? <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 20 }} /> : (
        <>
          <View style={[s.card, s.tiles]}>
            <Tile half icon="people" value={collective.peopleBeingDiscipled} label="Being discipled" />
            <Tile half icon="hand-left" value={collective.peopleDiscipling} label="Discipling others" />
            <Tile half icon="layers" value={collective.generations} label={collective.generations === 1 ? "Generation" : "Generations"} />
            <Tile half icon="earth" value={collective.countries} label={collective.countries === 1 ? "Nation" : "Nations"} />
          </View>

          {total > 0 ? (
            <View style={s.card}>
              <Text style={s.cardTitle} accessibilityRole="header">Milestones across P2P Global</Text>
              <Text style={s.meta}>Totals only. Groups smaller than {collective.minimumGroup ?? 5} are not shown, so no one can be identified.</Text>
              {collective.stages.map((st) => (
                <View key={st.stage} style={s.barRow} accessible accessibilityLabel={`${st.name}: ${st.people == null ? (st.fewerThan ? few(st.fewerThan) : "none") : st.people} people`}>
                  <Text style={s.barEmoji}>{STAGES[st.stage - 1]?.emoji}</Text>
                  <Text style={s.barLabel} numberOfLines={1}>{st.name}</Text>
                  <View style={s.barTrack}><View style={[s.barFill, { flex: (st.people ?? 0) / total }]} /><View style={{ flex: 1 - (st.people ?? 0) / total }} /></View>
                  <Text style={s.barN}>{st.people ?? (st.fewerThan ? `<${st.fewerThan}` : 0)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {months.length ? (
            <View style={s.card}>
              <Text style={s.cardTitle} accessibilityRole="header">Walks begun</Text>
              <Text style={s.meta}>New discipleship relationships each month.</Text>
              <View style={s.spark} accessible accessibilityLabel={months.map((m) => `${m.month}: ${m.relationships ?? few(m.fewerThan)}`).join(", ")}>
                {months.map((m) => (
                  <View key={m.month} style={s.sparkCol}>
                    <View style={[s.sparkBar, { height: 8 + ((m.relationships ?? 0) / peak) * 64 }]} />
                    <Text style={s.sparkLabel}>{new Date(m.month + "-01T00:00:00Z").toLocaleDateString(undefined, { month: "short" })}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}

      <View style={s.card}>
        <Text style={s.cardTitle} accessibilityRole="header">Your reach</Text>
        <Text style={s.meta}>{myCountries.length ? `Your lineage spans ${myCountries.length} nation${myCountries.length === 1 ? "" : "s"}.` : "Your first connection across the nations is one conversation away."}</Text>
        <View accessible accessibilityLabel={`Continents in your lineage: ${[...lit].map((k) => CONTINENT_LABELS[k]).join(", ") || "none yet"}`}>
          <Svg width="100%" height={170} viewBox="0 0 280 170">
            {CONTINENTS.map((z) => {
              const isHome = z.key === home, on = lit.has(z.key);
              return <Path key={z.key} d={z.d} fill={isHome ? colors.primaryGreen : on ? colors.accentGreen : colors.borderBeige} opacity={isHome ? 0.95 : on ? 0.55 : 0.45} />;
            })}
            {homePin ? <Circle cx={homePin[0]} cy={homePin[1]} r={5} fill="#fff" stroke={colors.primaryGreen} strokeWidth={2} /> : null}
          </Svg>
        </View>
        <View style={s.legend}>
          <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: colors.primaryGreen }]} /><Text style={s.meta}>You</Text></View>
          <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: colors.accentGreen, opacity: 0.6 }]} /><Text style={s.meta}>Your lineage</Text></View>
        </View>
        {myCountries.length ? (
          <View style={s.flags}>
            {myCountries.map((c) => (
              <View key={c} style={s.flag}><Text style={s.flagEmoji}>{getFlagEmoji(c)}</Text><Text style={s.flagText}>{c}</Text></View>
            ))}
          </View>
        ) : null}
      </View>
      <Text style={s.privacy}>Totals only. Names and relationships are never shown here; places appear only where people chose to share them.</Text>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  headerBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.textDark },
  segment: { flexDirection: "row", marginHorizontal: 16, padding: 4, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, gap: 4 },
  segmentBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, borderRadius: 10 },
  segmentBtnActive: { backgroundColor: colors.primaryGreen },
  segmentText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textMid },
  segmentTextActive: { color: "#fff" },
  content: { padding: 16, gap: 12 },
  empty: { textAlign: "center", color: colors.textMid, fontFamily: "Inter_400Regular", marginTop: 30 },

  hero: { padding: 16, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, gap: 14 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroBadge: { width: 56, height: 56, borderRadius: 18, backgroundColor: "rgba(29,158,117,0.10)", alignItems: "center", justifyContent: "center" },
  heroEmoji: { fontSize: 30 },
  heroKicker: { fontSize: 10, letterSpacing: 1.5, color: colors.amber, fontFamily: "Inter_600SemiBold" },
  heroTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: colors.textDark, lineHeight: 23 },
  heroSub: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.accentGreen, marginTop: 2 },
  heroGlobal: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen, gap: 6 },
  heroKickerLight: { fontSize: 10, letterSpacing: 1.5, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_600SemiBold" },
  heroTitleLight: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  heroSubLight: { fontSize: 13, fontFamily: "Inter_400Regular", fontStyle: "italic", color: "rgba(255,255,255,0.85)" },
  heroBodyLight: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.9)", lineHeight: 20, marginTop: 4 },

  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: "30%", minWidth: 96, padding: 10, borderRadius: 14, backgroundColor: colors.lightCream, gap: 2 },
  tileHalf: { flexBasis: "45%" },
  tileValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
  tileLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.textMid },

  section: { fontSize: 15, fontFamily: "Inter_700Bold", color: colors.textDark, marginTop: 6 },
  note: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  noteText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.textMid, lineHeight: 19 },
  pathRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.card, marginBottom: 6, borderWidth: 1, borderColor: colors.borderBeige },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textDark, flexShrink: 1 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMuted, lineHeight: 18 },
  youCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 2, borderColor: colors.accentGreen, backgroundColor: "rgba(29,158,117,0.05)" },
  youName: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.textDark },

  gen: { gap: 8, padding: 12, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  genHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  genDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primaryGreen, alignItems: "center", justifyContent: "center" },
  genDotText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  genTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  genRow: { gap: 10, paddingRight: 4 },
  chip: { width: 92, alignItems: "center", gap: 3, paddingVertical: 8, borderRadius: 14, backgroundColor: colors.lightCream },
  activeDot: { position: "absolute", right: 0, bottom: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accentGreen, borderWidth: 2, borderColor: "#fff" },
  chipName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.textDark, maxWidth: 84 },
  chipStage: { fontSize: 10, fontFamily: "Inter_500Medium", color: colors.textMid, maxWidth: 84 },
  chipFlag: { fontSize: 14 },
  actions: { gap: 8, marginTop: 8 },

  card: { padding: 14, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, gap: 8 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: colors.textDark },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barEmoji: { width: 20, fontSize: 14 },
  barLabel: { width: 100, fontSize: 12, fontFamily: "Inter_500Medium", color: colors.textMid },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.lightCream, flexDirection: "row", overflow: "hidden" },
  barFill: { backgroundColor: colors.accentGreen, borderRadius: 5 },
  barN: { width: 30, textAlign: "right", fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  spark: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 96, paddingTop: 8 },
  sparkCol: { flex: 1, alignItems: "center", gap: 4 },
  sparkBar: { width: "70%", borderRadius: 6, backgroundColor: colors.accentGreen },
  sparkLabel: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  legend: { flexDirection: "row", gap: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  flags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  flag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.lightCream },
  flagEmoji: { fontSize: 14 },
  flagText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.textDark },
  privacy: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.textMuted, textAlign: "center", lineHeight: 16, paddingHorizontal: 12 },
});
