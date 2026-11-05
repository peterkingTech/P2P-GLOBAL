import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { STAGES, STAGE_IMAGES, PERSONAL_STAGE_COUNT, COLLECTIVE_STAGE_INDEX, getStageFromPoints } from "@/constants/stages";
import ReadableText from "@/components/ReadableText";
import { AppButton } from "@/components/ui";
import { confirmAction } from "@/lib/alerts";
import {
  MILESTONE_DISCLAIMER, MILESTONE_EXPLANATION, endGrowthPause, getGrowthJourney, localDate, percentOf, progressText, setShareCountryInCollective,
  startGrowthPause, timeInStage, type GrowthJourney,
} from "@/lib/growthApi";

// YOUR GROWTH MILESTONES. One personal milestone, calculated on the server from
// verified evidence in four independent dimensions — Consistency, Learning,
// Application, Service & Contribution (migrations 235–239). This screen shows
// what has been verified and what the next milestone still needs, as counts
// (never percentages, points or rankings), with the reason for anything not yet
// met. Milestones record participation on P2P Global; they never measure a
// person's relationship with God. Forest Builder is the highest personal stage;
// Forest of Nations is what participants build TOGETHER.

/** A thin bar for ONE requirement's verified progress (server data; never an overall average). */
function ProgressBar({ percent, done }: { percent: number; done?: boolean }) {
  return (
    <View style={styles.barTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, percent))}%` as any }, done && { backgroundColor: colors.accentGreen }]} />
    </View>
  );
}

const PAUSE_LENGTHS = [{ label: "2 weeks", days: 14 }, { label: "1 month", days: 30 }, { label: "3 months", days: 90 }];

export default function StagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const [journey, setJourney] = useState<GrowthJourney | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  const load = useCallback(() => getGrowthJourney().then((j) => { setJourney(j); setError(null); }).catch((e: Error) => setError(e.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setNotice(null);
    try { await fn(); setNotice(done); await load(); } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };
  const pause = (days: number, label: string) => confirmAction(`Pause for ${label}?`,
    "Nothing you have done is removed, and a paused period never counts against you. You can resume at any time.",
    () => act(() => startGrowthPause(localDate(0), localDate(days - 1), "prefer_not_to_say"), `Paused until ${localDate(days - 1)}.`), { confirmLabel: "Pause" });
  const currentPause = journey?.pauses?.find((p) => p.current || p.upcoming);
  const [showFocus, setShowFocus] = useState(false);
  const [openDim, setOpenDim] = useState<string | null>(null);
  const v = journey?.verified;

  // Until the journey loads (or offline): the stage from the profile, never Forest of Nations.
  const stageIndex = journey ? journey.stage.stage - 1 : getStageFromPoints(profile?.growthLevel ?? 0);
  const collective = STAGES[COLLECTIVE_STAGE_INDEX];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12, paddingBottom: insets.bottom + 120 }]}
      showsVerticalScrollIndicator={false}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to the Living Tree" style={styles.back} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={20} color={colors.primaryGreen} />
        <Text style={styles.backLabel}>Living Tree</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>YOUR GROWTH MILESTONES</Text>
      <Text style={styles.pageTitle} accessibilityRole="header">From a Seed to a Forest Builder</Text>
      <Text style={styles.pageDesc}>{journey?.explanation ?? t("growthMilestones.explanation", MILESTONE_EXPLANATION)}</Text>
      <View style={styles.disclaimer} accessible accessibilityRole="text">
        <Ionicons name="heart-outline" size={16} color={colors.primaryGreen} />
        <Text style={styles.disclaimerText}>{journey?.disclaimer ?? t("growthMilestones.disclaimer", MILESTONE_DISCLAIMER)}</Text>
      </View>

      {/* Where you are */}
      <View style={[styles.stageRow, styles.stageRowCurrent]}>
        <Image source={STAGE_IMAGES[stageIndex]} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
        <View style={styles.stageInfo}>
          <View style={styles.stageNameRow}>
            <Text style={styles.stageEmoji}>{STAGES[stageIndex].emoji}</Text>
            <Text style={styles.stageName}>{STAGES[stageIndex].name}</Text>
            <View style={[styles.badge, styles.badgeCurrent]}><Text style={[styles.badgeText, styles.badgeCurrentText]}>You are here</Text></View>
          </View>
          <Text style={styles.desc}>{STAGES[stageIndex].description}</Text>
          <ReadableText style={styles.verse}>{STAGES[stageIndex].verse} — {STAGES[stageIndex].verseRef}</ReadableText>
          {journey ? <Text style={styles.meta}>In this stage for {timeInStage(journey.stage.since)}</Text> : null}
          {journey?.stage.verification === "legacy_unverified" ? (
            <Text style={styles.meta}>Recognised from your growth before this journey began. It stays yours; the milestones confirm it as you continue.</Text>
          ) : null}
        </View>
      </View>

      {/* What this stage is for — an objective, not an extra requirement */}
      {journey?.stage.objective ? (
        <View style={styles.nextCard}>
          <Text style={styles.collectiveLabel}>YOUR STAGE OBJECTIVE</Text>
          <Text style={styles.nextTitle} accessibilityRole="header">{journey.stage.objective.title}</Text>
          <Text style={styles.desc}>{journey.stage.objective.objective}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showFocus }} onPress={() => setShowFocus((v) => !v)} style={styles.disclosure}>
            <Text style={styles.disclosureText}>{showFocus ? "Hide" : "What this stage develops"}</Text>
            <Ionicons name={showFocus ? "chevron-up" : "chevron-down"} size={15} color={colors.primaryGreen} />
          </TouchableOpacity>
          {showFocus ? journey.stage.objective.focus.map((f) => (
            <View key={f} style={styles.item}><Ionicons name="leaf-outline" size={14} color={colors.accentGreen} /><Text style={[styles.itemText, { flex: 1 }]}>{f}</Text></View>
          )) : null}
        </View>
      ) : null}

      {!journey && !error ? <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 18 }} accessibilityLabel="Loading your growth journey" /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {notice ? <Text style={styles.noticeText} accessibilityLiveRegion="polite">{notice}</Text> : null}

      {/* What has been verified so far — counts, never content */}
      {v ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextTitle} accessibilityRole="header">Verified so far</Text>
          <View style={styles.tiles}>
            {[
              { n: v.activeWeeks, label: v.activeWeeks === 1 ? "active week" : "active weeks" },
              { n: v.learningUnits, label: v.learningUnits === 1 ? "learning unit passed" : "learning units passed" },
              { n: v.practicalActions, label: v.practicalActions === 1 ? "practical action" : "practical actions" },
              { n: v.contributions, label: v.contributions === 1 ? "contribution to others" : "contributions to others" },
            ].map((x) => (
              <View key={x.label} style={styles.tile} accessible accessibilityLabel={`${x.n} ${x.label}`}>
                <Text style={styles.tileN}>{x.n}</Text>
                <Text style={styles.tileLabel}>{x.label}</Text>
              </View>
            ))}
          </View>
          {v.pendingReview ? <Text style={styles.meta}>{v.pendingReview} record{v.pendingReview === 1 ? " is" : "s are"} waiting for review.</Text> : null}
          <Text style={styles.meta}>Only verified evidence counts: a lesson counts when its assessment is passed and reviewed by a peer; opening or reading content, and attending alone, do not.</Text>
        </View>
      ) : null}

      {/* Kingdom School Foundations (Core Foundations Curriculum: every Kingdom School curriculum) — visible from Seed, needed in full for Forest Builder */}
      {v ? (
        <TouchableOpacity style={styles.nextCard} onPress={() => router.push("/core-foundations" as any)} accessibilityRole="button"
          accessibilityLabel={`Kingdom School Foundations: ${v.coreLessons.passed} of ${v.coreLessons.total} lessons passed, ${v.coreLessons.percent ?? percentOf(v.coreLessons.passed, v.coreLessons.total)} percent. Open the lessons.`}>
          <View style={styles.dimensionHead}>
            <Ionicons name="library-outline" size={18} color={colors.primaryGreen} />
            <Text style={[styles.nextTitle, { flex: 1 }]}>Kingdom School Foundations</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
          <Text style={styles.bigCount}>{v.coreLessons.passed} / {v.coreLessons.total} lessons — {v.coreLessons.percent ?? percentOf(v.coreLessons.passed, v.coreLessons.total)}%</Text>
          <ProgressBar percent={v.coreLessons.percent ?? percentOf(v.coreLessons.passed, v.coreLessons.total)} />
          <Text style={styles.meta}>Every Kingdom School Foundations lesson — Peer-to-Peer Orientation, The Gospel &amp; Salvation, The Christian Foundation and any added later. Take them at any stage; each counts once its assessment is passed through an independent evaluation. All of them are needed for Forest Builder.</Text>
        </TouchableOpacity>
      ) : null}

      {/* What the next stage asks for */}
      {journey?.next ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextTitle} accessibilityRole="header">Growing toward {journey.next.emoji} {journey.next.name}</Text>
          {journey.milestones === "draft" ? (
            <Text style={styles.meta}>These milestones are being finalised by P2P Global. Verified evidence is already being recorded.</Text>
          ) : null}
          <Text style={styles.meta}>Every part of all four dimensions is needed; a lot in one never makes up for another.</Text>
          {journey.next.objective ? <Text style={styles.meta}>Objective of {journey.next.name}: {journey.next.objective.objective}</Text> : null}
          {journey.next.eligible ? <Text style={[styles.meta, { color: colors.accentGreen }]}>Every requirement for {journey.next.name} is met.</Text> : null}
          {journey.next.dimensions.map((d) => {
            const open = openDim === d.dimension;
            const lead = d.items[0];
            return (
              <View key={d.dimension} style={styles.dimension}>
                {/* Each dimension on its own (never averaged): tap to see every requirement and what is missing */}
                <TouchableOpacity style={styles.dimensionHead} onPress={() => setOpenDim(open ? null : d.dimension)} accessibilityRole="button" accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${d.label}: ${!d.required ? "not needed yet" : d.met ? "met" : "not yet met"}${lead ? `, ${progressText(lead)}` : ""}. ${open ? "Hide" : "Show"} details`}>
                  <Ionicons name={!d.required ? "remove-circle-outline" : d.met ? "checkmark-circle" : "ellipse-outline"} size={18} color={d.required && d.met ? colors.accentGreen : colors.textMuted} />
                  <Text style={[styles.dimensionName, { flex: 1 }]}>{d.label}</Text>
                  {lead ? <Text style={[styles.itemCount, d.met && { color: colors.accentGreen }]}>{d.met ? "Met" : progressText(lead)}</Text> : null}
                  {d.required ? <Ionicons name={open ? "chevron-up" : "chevron-down"} size={15} color={colors.textMuted} /> : null}
                </TouchableOpacity>
                {!d.required ? (
                  <Text style={styles.itemText}>Not needed yet for this stage</Text>
                ) : (open ? d.items : d.items.slice(0, 1)).map((i) => (
                  <View key={i.label} accessible accessibilityLabel={`${i.label}: ${i.met ? "met" : progressText(i)}${i.missing ? `. ${i.missing}` : ""}`}>
                    <View style={styles.item}>
                      <Ionicons name={i.met ? "checkmark" : "time-outline"} size={15} color={i.met ? colors.accentGreen : colors.amber} />
                      <Text style={[styles.itemText, { flex: 1 }]}>{i.label}</Text>
                      <Text style={[styles.itemCount, i.met && { color: colors.accentGreen }]}>{progressText(i)}</Text>
                    </View>
                    <View style={styles.itemBar}><ProgressBar percent={i.percent ?? percentOf(i.have, i.need)} done={i.met} /></View>
                    {!i.met && (i.explanation || i.missing) ? (
                      <Text style={styles.itemWhy}>{[i.missing, open ? i.explanation : null].filter(Boolean).join(" · ")}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      ) : journey ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextTitle}>You are a Forest Builder</Text>
          <Text style={styles.desc}>The highest personal milestone. Your record of helping others learn stays yours.</Text>
        </View>
      ) : null}

      {/* The people in my development, across generations */}
      {journey ? (
        <TouchableOpacity style={styles.nextCard} onPress={() => router.push("/development-history" as any)} accessibilityRole="button" accessibilityLabel="My development history: Peer Guides, contributors and generations">
          <View style={styles.dimensionHead}>
            <Ionicons name="git-network-outline" size={18} color={colors.primaryGreen} />
            <Text style={[styles.nextTitle, { flex: 1 }]}>My development history</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
          <Text style={styles.meta}>Your Peer Guides — current and previous — with both your stages at each step, everyone who verifiably helped you, and the people you have helped.</Text>
        </TouchableOpacity>
      ) : null}

      {/* Taking a break: pauses never erase evidence and never count against anyone */}
      {journey ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextTitle} accessibilityRole="header">Need a break?</Text>
          {currentPause ? (
            <>
              <Text style={styles.desc}>{currentPause.current ? `Paused until ${currentPause.endsOn}.` : `A pause starts on ${currentPause.startsOn}, until ${currentPause.endsOn}.`} Paused time doesn&apos;t count against you, and nothing you have done is removed.</Text>
              <AppButton label="Resume now" size="sm" variant="secondary" loading={busy} onPress={() => act(() => endGrowthPause(currentPause.id), "Welcome back — your milestones are running again.")} palette="fixedLight" />
            </>
          ) : (
            <>
              <Text style={styles.desc}>Life has seasons. Pausing keeps everything you have done and skips the paused weeks when counting consistency. Up to 90 days a year.</Text>
              <View style={styles.row}>
                {PAUSE_LENGTHS.map((p) => <AppButton key={p.days} label={p.label} size="sm" variant="secondary" disabled={busy} onPress={() => pause(p.days, p.label)} palette="fixedLight" />)}
              </View>
            </>
          )}
        </View>
      ) : null}

      {/* The whole journey */}
      <Text style={styles.listHeader} accessibilityRole="header">The five stages of personal growth</Text>
      <View style={styles.list}>
        {STAGES.slice(0, PERSONAL_STAGE_COUNT).map((stage, i) => {
          const reached = i < stageIndex, current = i === stageIndex, ahead = i > stageIndex;
          const when = journey?.history.find((h) => h.stage === i + 1);
          return (
            <View key={stage.name} style={[styles.stageRow, current && styles.stageRowCurrent, ahead && styles.stageRowLocked]}>
              <Image source={STAGE_IMAGES[i]} style={[styles.thumbSmall, ahead && styles.thumbLocked]} resizeMode="cover" accessibilityIgnoresInvertColors />
              <View style={styles.stageInfo}>
                <View style={styles.stageNameRow}>
                  <Text style={styles.stageEmoji}>{stage.emoji}</Text>
                  <Text style={[styles.stageName, ahead && styles.stageNameLocked]}>{stage.name}</Text>
                  {reached ? <View style={styles.badge}><Text style={styles.badgeText}>Reached</Text></View> : null}
                  {current ? <View style={[styles.badge, styles.badgeCurrent]}><Text style={[styles.badgeText, styles.badgeCurrentText]}>You are here</Text></View> : null}
                </View>
                <Text style={[styles.desc, ahead && styles.descLocked]} numberOfLines={3}>{stage.description}</Text>
                <ReadableText style={styles.verse}>{stage.verse} — {stage.verseRef}</ReadableText>
                {when ? <Text style={styles.meta}>Reached {new Date(when.achievedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}{when.kind === "legacy_import" ? " (recognised from your earlier growth)" : ""}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>

      {/* Together: Forest of Nations */}
      <View style={styles.collectiveCard}>
        <Image source={STAGE_IMAGES[COLLECTIVE_STAGE_INDEX]} style={styles.collectiveImage} resizeMode="cover" accessibilityIgnoresInvertColors />
        <Text style={styles.collectiveLabel}>TOGETHER</Text>
        <Text style={styles.collectiveTitle} accessibilityRole="header">{collective.emoji} {collective.name}</Text>
        <Text style={styles.desc}>{collective.description}</Text>
        <ReadableText style={styles.verse}>{collective.verse} — {collective.verseRef}</ReadableText>
        <Text style={styles.meta}>Not a personal stage: it is what P2P Global&apos;s participants build together, shown only as totals — never names or rankings.</Text>
        {journey ? (
          <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: !!journey.shareCountryInCollective }} style={styles.toggleRow}
            onPress={() => act(() => setShareCountryInCollective(!journey.shareCountryInCollective), journey.shareCountryInCollective ? "Your country is no longer counted." : "Your country is now counted in the totals.")}>
            <Ionicons name={journey.shareCountryInCollective ? "checkbox" : "square-outline"} size={20} color={colors.primaryGreen} />
            <Text style={[styles.itemText, { flex: 1 }]}>Count my country in the Forest of Nations totals (only shown for countries with at least 5 people)</Text>
          </TouchableOpacity>
        ) : null}
        <AppButton label="My discipleship lineage" onPress={() => router.push("/lineage" as any)} variant="secondary" icon="git-network-outline" style={{ marginTop: 10 }} palette="fixedLight" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.lightCream },
  content: { paddingHorizontal: 20 },

  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 20,
    alignSelf: "flex-start",
  },
  backLabel: {
    fontSize: 15,
    color: colors.primaryGreen,
    fontFamily: "Inter_500Medium",
  },

  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.amber,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    marginBottom: 8,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.primaryGreen,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 32,
    marginBottom: 10,
  },
  pageDesc: {
    fontSize: 14,
    color: colors.textMid,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },

  list: { gap: 12 },
  listHeader: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.textDark, marginTop: 24, marginBottom: 10 },

  stageRow: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderBeige,
    flexDirection: "row",
    gap: 12,
    padding: 12,
    alignItems: "flex-start",
  },
  stageRowCurrent: {
    borderColor: colors.accentGreen,
    backgroundColor: "rgba(29,158,117,0.05)",
  },
  stageRowLocked: {
    opacity: 0.65,
  },

  thumb: { width: 88, height: 88, borderRadius: 14 },
  thumbSmall: { width: 64, height: 64, borderRadius: 12 },
  thumbLocked: { opacity: 0.6 },

  stageInfo: { flex: 1, gap: 6 },
  stageNameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  stageEmoji: { fontSize: 16 },
  stageName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textDark,
    fontFamily: "Inter_700Bold",
  },
  stageNameLocked: { color: colors.textMid },

  badge: {
    backgroundColor: colors.borderBeige,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    color: colors.textMid,
    fontFamily: "Inter_500Medium",
  },
  badgeCurrent: { backgroundColor: colors.accentGreen },
  badgeCurrentText: { color: "#fff" },

  desc: {
    fontSize: 13,
    color: colors.textMid,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  descLocked: { color: colors.textMuted },
  verse: {
    fontSize: 12,
    color: colors.accentGreen,
    fontStyle: "italic",
    fontFamily: "Inter_400Regular",
  },
  meta: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 18 },
  errorText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", marginTop: 14 },

  nextCard: { marginTop: 16, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, gap: 10 },
  nextTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
  dimension: { gap: 6, paddingTop: 4 },
  dimensionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dimensionName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textDark },
  item: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 26 },
  itemText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 19, paddingLeft: 0 },
  itemCount: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_600SemiBold" },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.borderBeige, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.amber },
  itemBar: { paddingLeft: 23, paddingTop: 4 },
  bigCount: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
  disclosure: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, alignSelf: "flex-start" },
  disclosureText: { fontSize: 13, color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
  itemWhy: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17, paddingLeft: 49, paddingTop: 2 },
  noticeText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 12 },
  disclaimer: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 12, marginBottom: 16 },
  disclaimerText: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexBasis: "47%", flexGrow: 1, backgroundColor: colors.lightCream, borderRadius: 12, padding: 10 },
  tileN: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
  tileLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.textMid },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },

  collectiveCard: { marginTop: 24, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, gap: 6 },
  collectiveImage: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginBottom: 6 },
  collectiveLabel: { fontSize: 10, letterSpacing: 1.5, color: colors.amber, fontFamily: "Inter_600SemiBold" },
  collectiveTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.primaryGreen },
});
