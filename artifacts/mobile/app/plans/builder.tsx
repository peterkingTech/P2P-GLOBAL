import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton, SegmentedControl } from "@/components/ui";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import SubjectPicker, { type ChosenSubject } from "@/components/plans/SubjectPicker";
import Recommendations from "@/components/plans/Recommendations";
import GroupChooser, { type GroupChoice } from "@/components/plans/GroupChooser";
import { discover, getJourney, SUBJECT_TYPES, type Discovery, type Recommendation, type SubjectType } from "@/lib/planDiscoveryApi";
import {
  attachGroupPlan, createGroupFromPlan, createPlan, getPlan, groupsILead, startPlan, updatePlan,
  type DurationKey, type GroupSchedule, type Pace, type PlanInput, type Resource,
} from "@/lib/studyPlansApi";
import { DURATIONS, PACES, estimate, focusFor, journeySessions, move, newClientKey, parseReference, passageText, todayIso } from "@/lib/studyPlansUi";
import { onPick, pickRoute, takePick } from "@/lib/passagePick";
import JourneyReview from "@/components/plans/JourneyReview";
import { organise, toPlanSession, type Organised, type ProposedSession } from "@/lib/planOrganiserApi";

// P2P PLANS — THE PLAN BUILDER (brief §8): five calm steps, one thing at a time.
//   1 Focus      — what to study (searchable, from the real records) and how: "Let P2P organise my study" or
//                  "I'll choose my own resources".
//   2 Content    — the sessions: P2P's suggested journey (reviewed, never silently added) or the person's own
//                  picks; Scripture is added through the EXISTING Bible reader; reorder, edit, remove.
//   3 Supporting — resources beside a session (one main focus; supporting items help with that session).
//   4 Schedule   — duration, pace, start date; Individual or Study Together (an existing group, or a new
//                  private group made from this plan).
//   5 Review     — everything in one place; save as draft, create, or cancel.
// Every create is retry-safe (a client key); questions stay optional; nothing here awards Growth credit.
type Session = PlanInput["sessions"][number];
type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: Step[] = [1, 2, 3, 4, 5];
const SUBJECT_FOR_FOCUS: Record<string, SubjectType> = { bible_book: "bible_book", bible_topic: "bible_topic", biblical_person: "biblical_person", biblical_event: "biblical_event", theme: "theme", core_foundations: "core_foundations", kingdom_school: "kingdom_school" };

function BuilderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const params = useLocalSearchParams<{ id?: string; type?: string; key?: string; label?: string; approach?: string; group?: string; q?: string; deeperOf?: string }>();
  const editId = params.id ? String(params.id) : null;
  const preset = params.type && params.key && (SUBJECT_TYPES as string[]).includes(params.type) && params.type !== "bible_topic" ? { type: params.type as SubjectType, key: String(params.key), label: String(params.label ?? "") } : null;
  // Study Deeper (only reachable from a COMPLETED plan): the same question, a new journey that goes further.
  const deeperOf = params.deeperOf ? String(params.deeperOf) : null;
  const [step, setStep] = useState<Step>(preset || deeperOf ? 2 : 1);
  const [subject, setSubject] = useState<ChosenSubject | null>(preset);
  const [approach, setApproach] = useState<"p2p" | "own">(params.approach === "own" ? "own" : "p2p");
  // The subject or question, in the participant's own words (owner brief 2026-11-19 §1) — also the "own" focus.
  const [customFocus, setCustomFocus] = useState(params.q ? String(params.q).slice(0, 200) : "");
  // Optional starting point: widens the search, never restricts it.
  const [startKind, setStartKind] = useState<"any" | "bible_book" | "core_foundations" | "kingdom_school">(preset?.type === "bible_book" || preset?.type === "kingdom_school" || preset?.type === "core_foundations" ? preset.type : "any");
  const [organised, setOrganised] = useState<Organised | null>(null);
  const [proposal, setProposal] = useState<ProposedSession[]>([]);
  const [organisedFor, setOrganisedFor] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [derivedFrom, setDerivedFrom] = useState<PlanInput["derivedFrom"]>(null);
  const [journeyFor, setJourneyFor] = useState<string | null>(null);
  const [journeyNote, setJourneyNote] = useState<string | null>(null);
  const [loadingJourney, setLoadingJourney] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(0);
  const [ref, setRef] = useState(""), [refError, setRefError] = useState(false);
  const [strongs, setStrongs] = useState("");
  const [duration, setDuration] = useState<DurationKey>("monthly");
  const [pace, setPace] = useState<Pace>("daily");
  const [customDays, setCustomDays] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [mode, setMode] = useState<"individual" | "together">(params.group ? "together" : "individual");
  const [group, setGroup] = useState<GroupChoice | null>(null);
  const [title, setTitle] = useState(""), [description, setDescription] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(!editId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; suggestion: { durationKey: DurationKey; days: number } | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef({ draft: newClientKey(), create: newClientKey(), group: newClientKey(), attach: newClientKey() });
  const pickAt = useRef<number | null>(null);

  // Editing a saved plan or a draft.
  useEffect(() => {
    if (!editId) return;
    getPlan(editId).then((d) => {
      const p = d.plan;
      const st = SUBJECT_FOR_FOCUS[p.focusType];
      const fr = (p as unknown as { focusRef?: Record<string, unknown> }).focusRef ?? {};
      const key = String(fr.book ?? fr.topicSlug ?? fr.subjectId ?? fr.curriculumId ?? (p.focusType === "core_foundations" ? "foundations" : ""));
      if (st && key) setSubject({ type: st, key, label: p.focusLabel }); else setCustomFocus(p.focusLabel);
      setTitle(p.title); setDescription(p.description ?? ""); setPace(p.suggestedPace); setIsDraft(!!p.draft); setApproach("own");
      if (p.draft) setDraftId(p.id);
      setJourneyFor("edit");
      setSessions(d.sessions.filter((x) => !x.derived && !x.retired).map((x) => ({ id: x.id, title: x.title, intro: x.intro, passages: x.passages.map(({ book: b, chapter, startVerse, endVerse }) => ({ book: b, chapter, ...(startVerse ? { startVerse, endVerse } : {}) })),
        primaryResource: x.primaryResource ? strip(x.primaryResource) : null, supporting: x.supporting.map(strip), questions: x.questions, reflection: x.reflection, prayer: x.prayer })));
      setStep(2);
    }, (e) => setError(e?.message ?? t("p2pPlans.notAvailable")));
  }, [editId, t]);
  // Opened from a group's Plans: Study Together with that group.
  useEffect(() => {
    if (!params.group) return;
    const [gt, gid] = String(params.group).split(":");
    groupsILead().then((r) => { const g = r.groups.find((x) => x.type === gt && x.id === gid); if (g) setGroup({ kind: "existing", type: g.type, id: g.id, name: g.name }); }, () => {});
  }, [params.group]);
  // What P2P has for the subject (for adding resources and supporting items).
  useEffect(() => {
    setDiscovery(null);
    if (subject) discover(subject.type, subject.key).then(setDiscovery, () => setDiscovery(null));
  }, [subject?.type, subject?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Let P2P organise my study" (owner brief 2026-11-19): the subject or question is searched across ALL authorised
  // P2P resources and organised into a PROPOSED journey — prepared once per question + starting point, then
  // reviewed and edited here. Nothing is saved until the participant confirms in the last step.
  const question = customFocus.trim() || subject?.label || "";
  const startPoint = startKind === "core_foundations" ? { type: "core_foundations" as const, key: "foundations", label: "Core Foundations" }
    : subject && (startKind === "bible_book" || startKind === "kingdom_school") && subject.type === startKind ? { type: startKind, key: subject.key, label: subject.label } : null;
  useEffect(() => {
    if (step !== 2 || approach !== "p2p" || journeyFor === "edit") return;
    if (!deeperOf && question.length < 2) return;
    const id = `${question}|${startPoint?.type ?? ""}:${startPoint?.key ?? ""}|${deeperOf ?? ""}`;
    if (organisedFor === id) return;
    setLoadingJourney(true); setError(null);
    organise({ q: question, start: startPoint, deeperOf }).then((r) => {
      setOrganisedFor(id); setOrganised(r); setProposal(r.sessions); setDerivedFrom(null);
      if (!customFocus.trim() && r.journey.question) setCustomFocus(r.journey.question);
    }, (e) => setError(e?.message ?? t("p2pPlans.discover.loadError"))).finally(() => setLoadingJourney(false));
  }, [step, approach, question, startPoint?.type, startPoint?.key, deeperOf, organisedFor, journeyFor, t]); // eslint-disable-line react-hooks/exhaustive-deps
  // Scripture chosen in the Bible reader comes back here.
  const applyPick = useCallback((p: NonNullable<ReturnType<typeof takePick>>) => {
    const at = pickAt.current; pickAt.current = null;
    setSessions((xs) => (at !== null && xs[at] ? xs.map((x, i) => (i === at ? { ...x, title: x.title === passageText(x.passages[0] ?? p) ? passageText(p) : x.title, passages: [p] } : x)) : [...xs, { title: passageText(p), passages: [p] }]));
  }, []);
  useFocusEffect(useCallback(() => { const p = takePick(); if (p) applyPick(p); return onPick(() => { const q = takePick(); if (q) applyPick(q); }); }, [applyPick]));

  const focusLabel = subject?.label || customFocus.trim();
  const organisedFlow = approach === "p2p" && journeyFor !== "edit";
  // While reviewing an organised journey, the plan is the proposal (it becomes the sessions on Next).
  const sessionCount = derivedFrom ? lessonsInCurriculum(discovery) : organisedFlow && step === 2 ? proposal.length : sessions.length;
  const est = estimate(sessionCount || 1, duration, pace, Number(customDays) || null);
  const suggestion = est.tooMuch ? (["monthly", "quarterly", "half_year", "yearly"] as DurationKey[]).find((d) => !estimate(sessionCount, d, pace).tooMuch) ?? null : null;
  const supportingCount = sessions.reduce((n, x) => n + (x.supporting?.length ?? 0), 0);
  const withQuestions = sessions.filter((x) => (x.questions ?? []).length).length;
  const canNext: Record<Step, boolean> = {
    1: organisedFlow ? question.length >= 2 || !!startPoint : !!subject || !!customFocus.trim(),
    2: organisedFlow ? proposal.length > 0 : !!derivedFrom || sessions.length > 0, 3: true, 4: mode === "individual" || (!!group && (group.kind === "existing" || !!group.name.trim())), 5: true,
  };
  /** Leaving the review: the reviewed journey becomes the plan's sessions (still nothing saved). */
  const goNext = () => {
    setNotice(null);
    if (step === 2 && organisedFlow) setSessions(proposal.map(toPlanSession));
    setStep((step + 1) as Step);
  };

  const addRec = (r: Recommendation, toSession: boolean) => {
    const res = r.resource as Resource;
    if (added.has(r.key)) {
      // Remove again.
      setSessions((xs) => xs.filter((x) => !(x.primaryResource && JSON.stringify(strip(x.primaryResource)) === JSON.stringify(strip(res)))
        && !(res.kind === "bible_passage" && x.passages.length === 1 && passageText(x.passages[0]) === passageText(res as never)))
        .map((x) => ({ ...x, supporting: (x.supporting ?? []).filter((y) => JSON.stringify(strip(y)) !== JSON.stringify(strip(res))) })));
      setAdded((a) => { const n = new Set(a); n.delete(r.key); return n; });
      return;
    }
    const supportingKind = ["commentary", "deep_study", "word_study", "reference_article", "dictionary_term"].includes(res.kind);
    if (toSession && !supportingKind) {
      const session: Session = res.kind === "bible_passage" ? { title: r.title, passages: [{ book: res.book!, chapter: res.chapter!, ...(res.startVerse ? { startVerse: res.startVerse, endVerse: res.endVerse } : {}) }] }
        : { title: r.title.slice(0, 200), passages: [], primaryResource: strip(res) };
      setSessions((xs) => [...xs, session]);
    } else {
      const i = Math.min(target, Math.max(0, sessions.length - 1));
      if (!sessions.length) { setNotice(t("p2pPlans.builder.addSessionFirst")); return; }
      setSessions((xs) => xs.map((x, k) => (k === i ? { ...x, supporting: [...(x.supporting ?? []), strip(res)].slice(0, 12) } : x)));
    }
    setAdded((a) => new Set(a).add(r.key));
  };
  const addTyped = () => {
    const p = parseReference(ref);
    if (!p) { setRefError(true); return; }
    setRefError(false); setRef("");
    setSessions((xs) => [...xs, { title: passageText(p), passages: [p] }]);
  };
  const addSupport = (r: Resource) => setSessions((xs) => xs.map((x, i) => (i === target ? { ...x, supporting: [...(x.supporting ?? []).filter((y) => JSON.stringify(y) !== JSON.stringify(r)), r].slice(0, 12) } : x)));

  function input(draft: boolean): PlanInput {
    // An organised journey's focus is the participant's own question (the starting point only widened the search).
    const f = organisedFlow ? { focusType: "theme" as const, focusRef: {} } : subject ? focusFor(subject.type, subject.key) : { focusType: "theme" as const, focusRef: {} };
    const label = organisedFlow ? question : focusLabel;
    const live = organisedFlow && step === 2 ? proposal.map(toPlanSession) : sessions;
    return { title: (title.trim() || label || t("p2pPlans.builder.untitled")).slice(0, 200), description: description.trim() || null, focusType: f.focusType, focusLabel: label || title.trim() || t("p2pPlans.builder.untitled"),
      focusRef: f.focusRef, suggestedPace: pace, suggestedDays: est.days, sessions: derivedFrom ? [] : live, derivedFrom, draft,
      ...(organisedFlow && organised ? { organiser: { token: organised.token, question: question || organised.journey.question, deeperOf } } : {}) };
  }
  const schedule = (): GroupSchedule => ({ durationKey: duration, pace, startDate, ...(duration === "custom" ? { customDays: Number(customDays) || 1 } : {}) });

  async function saveDraft() {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (draftId) await updatePlan(draftId, input(true));
      else { const r = await createPlan({ ...input(true), clientKey: keys.current.draft }); setDraftId(r.id); }
      setNotice(t("p2pPlans.builder.draftSaved"));
    } catch (e: any) { setError(e?.message ?? t("p2pPlans.notAvailable")); } finally { setBusy(false); }
  }
  async function finish(acceptSchedule = false) {
    setBusy(true); setError(null); setProblem(null);
    try {
      if (editId && !isDraft) { await updatePlan(editId, input(false)); router.replace({ pathname: "/study-plan/[id]", params: { id: editId } } as any); return; }
      let id = draftId;
      if (id) await updatePlan(id, input(false));
      else id = (await createPlan({ ...input(false), clientKey: keys.current.create })).id;
      setDraftId(id); setIsDraft(false);
      const startBody = { durationKey: duration, pace, startDate, ...(duration === "custom" ? { customDays: Number(customDays) || 0 } : {}), ...(acceptSchedule ? { acceptSchedule: true } : {}) };
      if (mode === "individual") {
        await startPlan(id, { mode: "individual", ...startBody });
        router.replace({ pathname: "/study-plan/[id]", params: { id } } as any);
        return;
      }
      // Study Together: attach the ACTUAL plan to an existing group, or create a private group from it.
      let gType: string, gId: string, studyId: string, fresh = false;
      if (group?.kind === "existing") {
        const r = await attachGroupPlan(group.type, group.id, { planId: id, schedule: schedule(), clientKey: keys.current.attach });
        gType = group.type; gId = group.id; studyId = r.studyId;
      } else {
        const r = await createGroupFromPlan(id, { name: (group as { name: string }).name.trim(), description: (group as { description: string }).description.trim() || null, schedule: schedule(), clientKey: keys.current.group });
        gType = r.groupType; gId = r.groupId; studyId = r.studyId; fresh = !r.existing;
      }
      await startPlan(id, { mode: "together", sharedStudyId: studyId, ...startBody }).catch((e) => { if ((e as { status?: number }).status !== 409) throw e; });
      router.replace({ pathname: "/plans/group", params: { type: gType, id: gId, ...(fresh ? { invite: "1" } : {}) } } as any);
    } catch (e: any) {
      if (e?.status === 422) setProblem({ message: e.message, suggestion: e.suggestion ?? null });
      else setError(e?.message ?? t("p2pPlans.notAvailable"));
    } finally { setBusy(false); }
  }

  const Summary = () => (
    <View style={s.summary} accessibilityLabel={t("p2pPlans.builder.summaryLabel")}>
      <Ionicons name="reader-outline" size={16} color={c.accentGreen} />
      <Text style={s.summaryText} numberOfLines={2}>
        {[focusLabel || t("p2pPlans.builder.noFocus"), derivedFrom ? t("p2pPlans.builder.followsCurriculum") : t("p2pPlans.sessions", { count: sessionCount }),
          supportingCount ? t("p2pPlans.builder.supportingCount", { count: supportingCount }) : null, t(`p2pPlans.duration.${duration}`), t(`p2pPlans.mode.${mode}`)].filter(Boolean).join(" · ")}
      </Text>
    </View>
  );
  const sessionKind = (x: Session) => (x.passages.length ? t("p2pPlans.kind.bible_passage") : x.primaryResource ? t(`p2pPlans.kind.${x.primaryResource.kind}`) : "");

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="close" accessibilityLabel={t("p2pPlans.builder.cancel")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{editId && !isDraft ? t("p2pPlans.builder.editTitle") : t("p2pPlans.builder.title")}</Text>
        {!editId || isDraft ? <AppButton size="sm" variant="tertiary" label={t("p2pPlans.builder.saveDraft")} onPress={saveDraft} disabled={busy || !canNext[1]} /> : null}
      </View>
      <View style={s.progress} accessibilityRole="progressbar" accessibilityLabel={t("p2pPlans.builder.stepOf5", { n: step })} accessibilityValue={{ min: 1, max: 5, now: step }}>
        {STEPS.map((n) => (
          <TouchableOpacity key={n} style={s.stepHit} onPress={() => n < step && setStep(n)} disabled={n >= step} accessibilityRole="button" accessibilityLabel={t(`p2pPlans.builder.s${n}`)}>
            <View style={[s.stepBar, n <= step && s.stepBarOn]} />
            <Text style={[s.stepLabel, n === step && s.stepLabelOn]} numberOfLines={1}>{t(`p2pPlans.builder.s${n}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.kicker}>{t("p2pPlans.builder.stepOf5", { n: step })}</Text>
        <Text style={s.h1}>{t(`p2pPlans.builder.h${step}`)}</Text>
        {step > 1 ? <Summary /> : null}
        {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
        {notice ? <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}

        {step === 1 ? (
          <>
            {/* Owner brief 2026-11-19: any legitimate subject or question, in the participant's own words. */}
            <Text style={s.label}>{t("plansOrganiser.focusLabel", { defaultValue: "What would you like to learn?" })}</Text>
            <TextInput value={customFocus} onChangeText={(v) => { setCustomFocus(v.slice(0, 200)); setOrganisedFor(null); }} placeholder={t("plansOrganiser.focusPlaceholder", { defaultValue: "A subject, a question, a person, a passage… e.g. “Who is the Holy Spirit?”" })}
              placeholderTextColor={c.textMuted} style={[s.input, s.bigInput]} multiline accessibilityLabel={t("plansOrganiser.focusLabel", { defaultValue: "What would you like to learn?" })} />
            <Text style={s.label}>{t("plansOrganiser.startFrom", { defaultValue: "Starting point (optional)" })}</Text>
            <ChipRow accessibilityLabel={t("plansOrganiser.startFrom", { defaultValue: "Starting point (optional)" })} single>
              {(["any", "bible_book", "core_foundations", "kingdom_school"] as const).map((k) => (
                <FilterChip key={k} selection="single" selected={startKind === k} onPress={() => { setStartKind(k); setOrganisedFor(null); if (k === "any" || k === "core_foundations" || (subject && subject.type !== k)) setSubject(null); }}
                  label={k === "any" ? t("plansOrganiser.startAny", { defaultValue: "Any subject" }) : k === "bible_book" ? t("plansOrganiser.startBook", { defaultValue: "A Bible book" }) : k === "core_foundations" ? t("plansOrganiser.startFoundations", { defaultValue: "Core Foundations" }) : t("plansOrganiser.startSchool", { defaultValue: "Kingdom School" })} />
              ))}
            </ChipRow>
            {startKind === "bible_book" || startKind === "kingdom_school" ? (
              <SubjectPicker key={startKind} types={[startKind]} initialType={startKind} value={subject && subject.type === startKind ? subject : null} onChange={(x) => { setSubject(x); setOrganisedFor(null); setJourneyFor(null); setSessions([]); setDerivedFrom(null); setAdded(new Set()); }} />
            ) : null}
            {startKind !== "any" ? <Text style={s.small}>{t("plansOrganiser.startNote", { defaultValue: "P2P still searches everything; this is just where your journey begins." })}</Text> : null}
            <Text style={s.label}>{t("p2pPlans.builder.how")}</Text>
            {(["p2p", "own"] as const).map((a) => (
              <TouchableOpacity key={a} style={[s.choice, approach === a && s.choiceOn]} onPress={() => setApproach(a)} accessibilityRole="radio" accessibilityState={{ selected: approach === a }}
                accessibilityLabel={`${t(a === "p2p" ? "p2pPlans.builder.approachP2P" : "p2pPlans.builder.approachOwn")}. ${t(a === "p2p" ? "p2pPlans.builder.approachP2PHint" : "p2pPlans.builder.approachOwnHint")}`}>
                <Ionicons name={a === "p2p" ? "sparkles-outline" : "list-outline"} size={22} color={approach === a ? c.primaryGreen : c.textMid} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.choiceTitle}>{t(a === "p2p" ? "p2pPlans.builder.approachP2P" : "p2pPlans.builder.approachOwn")}</Text>
                  <Text style={s.small}>{t(a === "p2p" ? "p2pPlans.builder.approachP2PHint" : "p2pPlans.builder.approachOwnHint")}</Text>
                </View>
                {approach === a ? <Ionicons name="checkmark-circle" size={20} color={c.primaryGreen} /> : null}
              </TouchableOpacity>
            ))}
          </>
        ) : null}

        {step === 2 && organisedFlow ? (
          <>
            {loadingJourney ? <View style={s.card}><ActivityIndicator color={c.primaryGreen} /><Text style={s.meta}>{t("plansOrganiser.preparing", { defaultValue: "Searching all of P2P for “{{focus}}” and preparing your journey…", focus: question })}</Text></View> : null}
            {organised && !loadingJourney ? (
              organised.journey.note === "empty" || organised.journey.note === "nothing_new" ? (
                <View style={s.card}>
                  <Text style={s.body}>{organised.journey.note === "nothing_new" ? t("plansOrganiser.nothingNew", { defaultValue: "You've already studied everything P2P has found on this subject. Try a related question to keep going." }) : t("plansOrganiser.empty", { defaultValue: "P2P didn't find resources for this yet. Try other words, a key word, or a Bible passage." })}</Text>
                  <AppButton size="sm" variant="secondary" icon="create-outline" label={t("plansOrganiser.changeQuestion", { defaultValue: "Change the question" })} onPress={() => setStep(1)} />
                </View>
              ) : (
                <>
                  <Text style={s.small}>{deeperOf ? t("plansOrganiser.deeperReview", { defaultValue: "This journey goes beyond what you've already studied. Review it, change anything, then continue — nothing is saved until you confirm." }) : t("plansOrganiser.review", { defaultValue: "Here's a journey from P2P's resources. Review it, change anything, then continue — nothing is saved until you confirm." })}</Text>
                  <JourneyReview data={organised} proposal={proposal} onChange={setProposal} />
                </>
              )
            ) : null}
          </>
        ) : null}

        {step === 2 && !organisedFlow ? (
          <>
            {loadingJourney ? <View style={s.card}><ActivityIndicator color={c.primaryGreen} /><Text style={s.meta}>{t("p2pPlans.builder.preparing", { focus: focusLabel })}</Text></View> : null}
            {derivedFrom ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>{t(derivedFrom.type === "foundations" ? "p2pPlans.builder.foundationsTitle" : "p2pPlans.builder.courseTitle", { focus: focusLabel })}</Text>
                <Text style={s.body}>{t("p2pPlans.builder.curriculumBody", { count: sessionCount })}</Text>
                <Text style={s.small}>{t("p2pPlans.builder.curriculumRules")}</Text>
              </View>
            ) : (
              <>
                {approach === "p2p" && journeyNote === "small" ? <Text style={s.small}>{t("p2pPlans.builder.journeySmall")}</Text> : null}
                {approach === "p2p" && journeyNote === "empty" ? <Text style={s.small}>{t("p2pPlans.builder.journeyEmpty")}</Text> : null}
                {approach === "p2p" && sessions.length ? <Text style={s.small}>{t("p2pPlans.builder.journeyReview")}</Text> : null}
                {sessions.length ? sessions.map((x, i) => (
                  <View key={`${i}-${x.title}`} style={s.sessionCard}>
                    <View style={s.sessionTop}>
                      <Text style={s.n}>{i + 1}</Text>
                      <TextInput value={x.title} onChangeText={(v) => setSessions((xs) => xs.map((y, j) => (j === i ? { ...y, title: v.slice(0, 200) } : y)))} style={[s.input, { flex: 1 }]} accessibilityLabel={t("p2pPlans.builder.sessionTitle", { n: i + 1 })} />
                    </View>
                    <Text style={s.small}>{sessionKind(x)}{x.passages.length ? `: ${x.passages.map(passageText).join("; ")}` : ""}{(x.supporting ?? []).length ? ` · ${t("p2pPlans.builder.supportingCount", { count: x.supporting!.length })}` : ""}{(x.questions ?? []).length ? ` · ${t("p2pPlans.builder.questionsCount", { count: x.questions!.length })}` : ""}</Text>
                    <View style={s.buttons}>
                      <IconButton icon="arrow-up" accessibilityLabel={t("p2pPlans.builder.moveUp", { title: x.title })} onPress={() => setSessions((xs) => move(xs, i, i - 1))} disabled={i === 0} color={c.textMid} />
                      <IconButton icon="arrow-down" accessibilityLabel={t("p2pPlans.builder.moveDown", { title: x.title })} onPress={() => setSessions((xs) => move(xs, i, i + 1))} disabled={i === sessions.length - 1} color={c.textMid} />
                      {x.passages.length ? <IconButton icon="create-outline" accessibilityLabel={t("p2pPlans.builder.editPassage", { title: x.title })} onPress={() => { pickAt.current = i; router.push(pickRoute(x.passages[0]) as any); }} color={c.textMid} /> : null}
                      <IconButton icon="trash-outline" accessibilityLabel={`${t("p2pPlans.builder.remove")} ${x.title}`} onPress={() => setSessions((xs) => xs.filter((_, j) => j !== i))} color={c.textMid} />
                    </View>
                  </View>
                )) : !loadingJourney ? <Text style={s.meta}>{t("p2pPlans.builder.noSessions")}</Text> : null}
                <View style={s.card}>
                  <AppButton icon="book-outline" label={t("p2pPlans.builder.addScripture")} onPress={() => { pickAt.current = null; router.push(pickRoute(null) as any); }} />
                  <Text style={s.small}>{t("p2pPlans.builder.addScriptureHint")}</Text>
                  <View style={s.row}>
                    <TextInput value={ref} onChangeText={(v) => { setRef(v); setRefError(false); }} onSubmitEditing={addTyped} style={[s.input, { flex: 1 }]} placeholder={t("p2pPlans.builder.passagePlaceholder")} placeholderTextColor={c.textMuted} accessibilityLabel={t("p2pPlans.builder.typeReference")} />
                    <AppButton size="sm" variant="secondary" icon="add" label={t("p2pPlans.builder.add")} onPress={addTyped} />
                  </View>
                  {refError ? <Text style={s.error}>{t("p2pPlans.builder.badReference")}</Text> : null}
                </View>
                {discovery ? (
                  <View style={{ gap: 8 }}>
                    <Text style={s.label}>{approach === "own" ? t("p2pPlans.builder.chooseFromP2P", { focus: focusLabel }) : t("p2pPlans.builder.addMoreFromP2P")}</Text>
                    <Recommendations data={{ ...discovery, sections: discovery.sections.filter((x) => ["scripture", "kingdom_stories", "core_foundations", "kingdom_school", "topics"].includes(x.section)) }} added={added} onAdd={(r) => addRec(r, true)} />
                  </View>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {step === 3 ? (
          derivedFrom ? <Text style={s.meta}>{t("p2pPlans.builder.curriculumSupporting")}</Text> : (
            <>
              <Text style={s.small}>{t("p2pPlans.builder.oneFocus")}</Text>
              <Text style={s.label}>{t("p2pPlans.builder.supportFor")}</Text>
              <ChipRow accessibilityLabel={t("p2pPlans.builder.supportFor")} single>
                {sessions.map((x, i) => <FilterChip key={i} label={`${i + 1}. ${x.title}`.slice(0, 40)} selected={target === i} selection="single" onPress={() => setTarget(i)} />)}
              </ChipRow>
              {sessions[target] ? (
                <View style={s.card}>
                  <Text style={s.cardTitle}>{sessions[target].title}</Text>
                  {(sessions[target].supporting ?? []).length ? (sessions[target].supporting ?? []).map((r, n) => (
                    <View key={n} style={s.rowBetween}>
                      <Text style={[s.body, { flex: 1 }]}>{t(`p2pPlans.kind.${r.kind}`)}{r.note ? `: ${r.note}` : r.slug ? `: ${r.slug}` : r.strongs ? `: ${r.strongs}` : r.book ? `: ${passageText(r as never)}` : r.id && r.kind === "reference_article" ? `: ${r.id}` : ""}</Text>
                      <AppButton size="sm" variant="tertiary" label={t("p2pPlans.builder.remove")} onPress={() => setSessions((xs) => xs.map((x, i) => (i === target ? { ...x, supporting: (x.supporting ?? []).filter((_, k) => k !== n) } : x)))} />
                    </View>
                  )) : <Text style={s.small}>{t("p2pPlans.builder.noSupporting")}</Text>}
                  {sessions[target].passages[0] ? (
                    <View style={s.buttons}>
                      <AppButton size="sm" variant="secondary" label={t("p2pPlans.builder.addDeep")} onPress={() => addSupport({ kind: "deep_study", ...sessions[target].passages[0] })} />
                      <AppButton size="sm" variant="secondary" label={t("p2pPlans.builder.addCommentary")} onPress={() => addSupport({ kind: "commentary", book: sessions[target].passages[0].book, chapter: sessions[target].passages[0].chapter })} />
                    </View>
                  ) : null}
                  <Text style={s.label}>{t("p2pPlans.builder.addWord")}</Text>
                  <View style={s.row}>
                    <TextInput value={strongs} onChangeText={(v) => setStrongs(v.toUpperCase().replace(/\s/g, ""))} style={[s.input, { flex: 1 }]} placeholder="G26" placeholderTextColor={c.textMuted} accessibilityLabel={t("p2pPlans.builder.addWord")} />
                    <AppButton size="sm" icon="add" label={t("p2pPlans.builder.add")} accessibilityLabel={t("p2pPlans.builder.addWord")} disabled={!/^[HG]\d{1,5}$/.test(strongs)} onPress={() => { addSupport({ kind: "word_study", strongs }); setStrongs(""); }} />
                  </View>
                </View>
              ) : null}
              {discovery ? (
                <View style={{ gap: 8 }}>
                  <Text style={s.label}>{t("p2pPlans.builder.suggestedSupporting")}</Text>
                  <Recommendations data={{ ...discovery, sections: discovery.sections.filter((x) => ["kingdom_stories", "kingdom_school", "core_foundations", "commentaries", "deep_study", "dictionary"].includes(x.section)) }} added={added} onAdd={(r) => addRec(r, false)} />
                </View>
              ) : null}
            </>
          )
        ) : null}

        {step === 4 ? (
          <>
            <Text style={s.label}>{t("p2pPlans.builder.duration")}</Text>
            <ChipRow accessibilityLabel={t("p2pPlans.builder.duration")} single>
              {DURATIONS.map((k) => <FilterChip key={k} label={t(`p2pPlans.duration.${k}`)} selected={duration === k} selection="single" onPress={() => setDuration(k)} />)}
            </ChipRow>
            {duration === "custom" ? <TextInput value={customDays} onChangeText={(v) => setCustomDays(v.replace(/\D/g, ""))} keyboardType="number-pad" style={s.input} placeholder={t("p2pPlans.start.customDays")} placeholderTextColor={c.textMuted} accessibilityLabel={t("p2pPlans.start.customDays")} /> : null}
            <Text style={s.label}>{t("p2pPlans.builder.pace")}</Text>
            <ChipRow accessibilityLabel={t("p2pPlans.builder.pace")} single>
              {PACES.map((k) => <FilterChip key={k} label={t(`p2pPlans.pace.${k}`)} selected={pace === k} selection="single" onPress={() => setPace(k)} />)}
            </ChipRow>
            <Text style={s.label}>{t("p2pPlans.builder.startDate")}</Text>
            <ChipRow accessibilityLabel={t("p2pPlans.builder.startDate")} single>
              {startChoices().map((d) => <FilterChip key={d.key} label={t(`p2pPlans.builder.start_${d.key}`, { date: fmt(d.date) })} selected={startDate === d.date} selection="single" onPress={() => setStartDate(d.date)} />)}
            </ChipRow>
            <View style={[s.card, est.tooMuch && s.warn]}>
              <Text style={s.body} accessibilityLiveRegion="polite">{pace === "flexible" ? t("p2pPlans.start.previewFlexible") : est.days && est.perDay ? t("p2pPlans.start.preview", { perDay: est.perDay, days: est.days }) : t("p2pPlans.builder.chooseDays")}</Text>
              {est.tooMuch ? <Text style={s.error}>{t("p2pPlans.start.tooMuch")}</Text> : null}
              {suggestion ? <AppButton size="sm" variant="secondary" label={t("p2pPlans.builder.useSuggestion", { duration: t(`p2pPlans.duration.${suggestion}`) })} onPress={() => setDuration(suggestion)} /> : null}
              {derivedFrom ? <Text style={s.small}>{t("p2pPlans.builder.scheduleOnly")}</Text> : null}
            </View>
            <Text style={s.label}>{t("p2pPlans.builder.studyMode")}</Text>
            <SegmentedControl accessibilityLabel={t("p2pPlans.builder.studyMode")} value={mode} onChange={setMode}
              options={[{ value: "individual", label: t("p2pPlans.mode.individual"), icon: "person-outline" }, { value: "together", label: t("p2pPlans.mode.together"), icon: "people-outline" }]} />
            {mode === "together" ? <GroupChooser value={group} onChange={setGroup} defaultName={(title.trim() || focusLabel).slice(0, 80)} defaultDescription={description.trim() || t("p2pPlans.together.defaultDescription", { focus: focusLabel })} />
              : <Text style={s.small}>{t("p2pPlans.builder.individualNote")}</Text>}
          </>
        ) : null}

        {step === 5 ? (
          <>
            <Text style={s.label}>{t("p2pPlans.builder.planTitle")}</Text>
            <TextInput value={title} onChangeText={setTitle} style={s.input} placeholder={focusLabel} placeholderTextColor={c.textMuted} accessibilityLabel={t("p2pPlans.builder.planTitle")} />
            <Text style={s.label}>{t("p2pPlans.builder.description")}</Text>
            <TextInput value={description} onChangeText={setDescription} style={[s.input, { minHeight: 70 }]} multiline accessibilityLabel={t("p2pPlans.builder.description")} />
            <View style={s.card}>
              <Row k={t("p2pPlans.builder.r_focus")} v={`${subject ? t(`p2pPlans.subjectType.${subject.type}`) : t("p2pPlans.focus.theme")} · ${focusLabel}`} s={s} onEdit={() => setStep(1)} t={t} />
              <Row k={t("p2pPlans.builder.r_content")} v={derivedFrom ? t("p2pPlans.builder.curriculumBody", { count: sessionCount }) : t("p2pPlans.builder.r_contentValue", { sessions: sessions.length, supporting: supportingCount })} s={s} onEdit={() => setStep(2)} t={t} />
              {!derivedFrom ? sessions.slice(0, 8).map((x, i) => <Text key={i} style={s.small}>{i + 1}. {x.title} — {sessionKind(x)}{(x.supporting ?? []).length ? ` (+${x.supporting!.length})` : ""}</Text>) : null}
              {!derivedFrom && sessions.length > 8 ? <Text style={s.small}>{t("p2pPlans.builder.andMore", { count: sessions.length - 8 })}</Text> : null}
              <Row k={t("p2pPlans.builder.r_required")} v={derivedFrom ? t("p2pPlans.builder.r_requiredCurriculum") : t("p2pPlans.builder.r_requiredValue")} s={s} t={t} />
              <Row k={t("p2pPlans.builder.r_schedule")} v={`${t(`p2pPlans.duration.${duration}`)}${duration === "custom" && customDays ? ` (${customDays})` : ""} · ${t(`p2pPlans.pace.${pace}`)} · ${t("p2pPlans.builder.r_from", { date: fmt(startDate) })}`} s={s} onEdit={() => setStep(4)} t={t} />
              {est.perDay && pace !== "flexible" ? <Row k={t("p2pPlans.builder.r_workload")} v={t("p2pPlans.start.preview", { perDay: est.perDay, days: est.days })} s={s} t={t} /> : null}
              <Row k={t("p2pPlans.builder.r_questions")} v={derivedFrom ? t("p2pPlans.builder.r_questionsCurriculum") : t("p2pPlans.builder.r_questionsValue", { count: withQuestions, total: sessions.length })} s={s} t={t} />
              <Row k={t("p2pPlans.builder.r_mode")} v={mode === "individual" ? t("p2pPlans.mode.individual") : group?.kind === "existing" ? t("p2pPlans.builder.r_withGroup", { name: group.name ?? "" }) : t("p2pPlans.builder.r_newGroup", { name: group?.kind === "new" ? group.name : "" })} s={s} onEdit={() => setStep(4)} t={t} />
            </View>
            <Text style={s.small}>{t("p2pPlans.builder.privateNote")}</Text>
            {problem ? (
              <View style={[s.card, s.warn]} accessibilityRole="alert">
                <Text style={s.body}>{problem.message}</Text>
                <View style={s.buttons}>
                  {problem.suggestion ? <AppButton size="sm" label={t("p2pPlans.builder.useSuggestion", { duration: t(`p2pPlans.duration.${problem.suggestion.durationKey}`) })} onPress={() => { setDuration(problem.suggestion!.durationKey); if (problem.suggestion!.durationKey === "custom") setCustomDays(String(problem.suggestion!.days)); setProblem(null); }} /> : null}
                  <AppButton size="sm" variant="secondary" label={t("p2pPlans.start.keepAnyway")} onPress={() => finish(true)} />
                </View>
              </View>
            ) : null}
            <View style={s.buttons}>
              <AppButton icon="checkmark" label={editId && !isDraft ? t("p2pPlans.builder.save") : mode === "individual" ? t("p2pPlans.builder.createAndStart") : t("p2pPlans.builder.createTogether")} onPress={() => finish(false)} disabled={busy || !canNext[2] || !canNext[4]} loading={busy} />
              {!editId || isDraft ? <AppButton variant="secondary" label={t("p2pPlans.builder.saveDraft")} onPress={saveDraft} disabled={busy} /> : null}
              <AppButton variant="tertiary" label={t("p2pPlans.builder.cancel")} onPress={() => router.back()} disabled={busy} />
            </View>
          </>
        ) : null}

        <View style={s.rowBetween}>
          {step > 1 ? <AppButton variant="secondary" icon="arrow-back" label={t("p2pPlans.builder.back")} onPress={() => setStep((step - 1) as Step)} /> : <View />}
          {step < 5 ? <AppButton icon="arrow-forward" iconPosition="trailing" label={t("p2pPlans.builder.next")} disabled={!canNext[step] || loadingJourney} onPress={goNext} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}
function Row({ k, v, s, onEdit, t }: { k: string; v: string; s: ReturnType<typeof makeStyles>; onEdit?: () => void; t: (x: string) => string }) {
  return (
    <View style={s.reviewRow}>
      <View style={{ flex: 1 }}><Text style={s.reviewKey}>{k}</Text><Text style={s.body}>{v}</Text></View>
      {onEdit ? <AppButton size="sm" variant="tertiary" label={t("p2pPlans.builder.edit")} accessibilityLabel={`${t("p2pPlans.builder.edit")} ${k}`} onPress={onEdit} /> : null}
    </View>
  );
}
/** How many lessons a curriculum plan follows (from what discovery found for it). */
function lessonsInCurriculum(d: Discovery | null): number {
  if (!d) return 0;
  return d.sections.flatMap((x) => x.items).filter((i) => i.resource.kind === "curriculum").reduce((n, i) => n + Number(i.reason.params?.lessons ?? 0), 0)
    || d.sections.flatMap((x) => x.items).filter((i) => i.resource.kind === "lesson" && i.relevance === "direct").length;
}
function startChoices(): { key: "today" | "tomorrow" | "monday"; date: string }[] {
  const now = new Date();
  const add = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return todayIso(d); };
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  return [{ key: "today", date: add(0) }, { key: "tomorrow", date: add(1) }, { key: "monday", date: add(toMonday) }];
}
const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
/** The same key the discovery service gives a recommendation (lib/planDiscovery.ts resourceKey). */
function recKey(r: Resource): string {
  if (r.id) return `${r.kind}:${r.id}`;
  if (r.slug) return `${r.kind}:${r.slug}`;
  if (r.strongs) return `${r.kind}:${r.strongs}`;
  if (r.key) return `${r.kind}:${r.key}`;
  return `${r.kind}:${r.book && r.chapter ? passageText({ book: r.book, chapter: r.chapter, ...(r.startVerse ? { startVerse: r.startVerse, endVerse: r.endVerse } : {}) }) : ""}`;
}
/** A resource as the server wants it back (no display-only fields). */
function strip(r: Resource): Resource { const { label, display, ...rest } = r as Resource & { label?: unknown; display?: unknown }; void label; void display; return rest as Resource; }

export default withScreenBoundary(BuilderScreen, "Create a plan");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 4 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    progress: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 6, width: "100%", maxWidth: 820, alignSelf: "center" },
    stepHit: { flex: 1, gap: 4, minHeight: 32 },
    stepBar: { height: 4, borderRadius: 2, backgroundColor: c.borderBeige },
    stepBarOn: { backgroundColor: c.primaryGreen },
    stepLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    stepLabelOn: { color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, gap: 12, width: "100%", maxWidth: 820, alignSelf: "center" },
    h1: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    error: { fontSize: 13, color: c.amber, fontFamily: "Inter_600SemiBold" },
    notice: { fontSize: 13, color: c.primaryGreen, fontFamily: "Inter_600SemiBold" },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6 },
    summary: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, backgroundColor: c.cardBeige },
    summaryText: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    card: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    warn: { borderColor: c.amber },
    cardTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    choice: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige, minHeight: 64 },
    choiceOn: { borderColor: c.primaryGreen, borderWidth: 1.5 },
    choiceTitle: { fontSize: 15.5, color: c.textDark, fontFamily: "Inter_700Bold" },
    input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 12, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 14 },
    bigInput: { minHeight: 72, paddingTop: 12, fontSize: 16, textAlignVertical: "top" },
    row: { flexDirection: "row", gap: 8, alignItems: "center" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
    sessionCard: { padding: 10, gap: 4, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    sessionTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    n: { width: 24, textAlign: "center", fontSize: 13, color: c.textMuted, fontFamily: "Inter_700Bold" },
    reviewRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderBeige },
    reviewKey: { fontSize: 11.5, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.3 },
  });
}
