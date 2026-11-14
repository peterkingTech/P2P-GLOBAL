import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { AppButton, ChipRow, FilterChip, IconButton } from "@/components/ui";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";
import { bookByName } from "@/lib/bibleReaderApi";
import { getCoreFoundations } from "@/lib/growthApi";
import { getTopics, type PrayerTopic } from "@/lib/prayerTopicsApi";
import { createPlan, getPlan, startPlan, updatePlan, type DurationKey, type FocusType, type Pace, type PlanInput, type Resource } from "@/lib/studyPlansApi";
import { DURATIONS, FOCUS_TYPES, PACES, chapterSessions, estimate, parseReference, passageText, todayIso } from "@/lib/studyPlansUi";

// P2P PLANS — PLAN BUILDER (owner brief §12). Seven short steps: main focus → what to study (Bible chapters
// or passages, or existing Foundations lessons — referenced, never copied) → optional supporting resources
// attached to a session (they must help with that session's passage or lesson) → duration → schedule →
// individual or together → review. The plan is the participant's own, private, never official curriculum.
// Advanced options are never required: a book + "one session per chapter" is a complete plan.
type Session = PlanInput["sessions"][number];

function BuilderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const [step, setStep] = useState(1);
  const [focusType, setFocusType] = useState<FocusType>("bible_book");
  const [focusLabel, setFocusLabel] = useState("");
  const [book, setBook] = useState(""), [from, setFrom] = useState("1"), [to, setTo] = useState("");
  const [ref, setRef] = useState(""), [refError, setRefError] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [lessons, setLessons] = useState<{ id: string; title: string }[] | null>(null);
  const [lessonQuery, setLessonQuery] = useState("");
  const [topics, setTopics] = useState<PrayerTopic[] | null>(null);
  const [target, setTarget] = useState(0);
  const [strongs, setStrongs] = useState("");
  const [duration, setDuration] = useState<DurationKey>("monthly");
  const [pace, setPace] = useState<Pace>("daily");
  const [customDays, setCustomDays] = useState("");
  const [mode, setMode] = useState<"individual" | "together">("individual");
  const [title, setTitle] = useState(""), [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editId) return;
    getPlan(String(editId)).then((d) => {
      setFocusType(d.plan.focusType); setFocusLabel(d.plan.focusLabel); setTitle(d.plan.title); setDescription(d.plan.description ?? ""); setPace(d.plan.suggestedPace);
      setSessions(d.sessions.filter((x) => !x.derived).map((x) => ({ id: x.id, title: x.title, intro: x.intro, passages: x.passages.map(({ book: b, chapter, startVerse, endVerse }) => ({ book: b, chapter, ...(startVerse ? { startVerse, endVerse } : {}) })),
        primaryResource: x.primaryResource ? strip(x.primaryResource) : null, supporting: x.supporting.map(strip), questions: x.questions, reflection: x.reflection, prayer: x.prayer })));
    }, (e) => setError(e?.message ?? t("p2pPlans.notAvailable")));
  }, [editId, t]);
  useEffect(() => { if (step === 2 && focusType === "core_foundations" && !lessons) getCoreFoundations().then((cf) => setLessons(cf.modules.flatMap((m) => m.lessons.map((l) => ({ id: l.id, title: l.title })))), () => setLessons([])); }, [step, focusType, lessons]);
  useEffect(() => { if (step === 3 && !topics) getTopics().then(setTopics, () => setTopics([])); }, [step, topics]);

  const bookObj = bookByName(book);
  const addPassage = () => {
    const p = parseReference(ref);
    if (!p) { setRefError(true); return; }
    setRefError(false); setRef("");
    setSessions((xs) => [...xs, { title: passageText(p), passages: [p] }]);
  };
  const addSupport = (r: Resource) => setSessions((xs) => xs.map((x, i) => (i === target ? { ...x, supporting: [...(x.supporting ?? []).filter((y) => JSON.stringify(y) !== JSON.stringify(r)), r].slice(0, 12) } : x)));
  const cur = sessions[target];
  const firstPassage = cur?.passages[0];
  const est = estimate(sessions.length, duration, pace, Number(customDays) || null);
  const canNext = step === 1 ? !!focusLabel.trim() || (focusType === "bible_book" && !!bookObj) : step === 2 ? sessions.length > 0 : step === 7 ? !!(title.trim() || focusLabel.trim()) : true;

  async function finish() {
    setBusy(true); setError(null);
    const input: PlanInput = { title: (title.trim() || focusLabel.trim()).slice(0, 200), description: description.trim() || null, focusType, focusLabel: focusLabel.trim() || bookObj?.name || title.trim(),
      focusRef: focusType === "bible_book" && bookObj ? { book: bookObj.code } : {}, suggestedPace: pace, suggestedDays: est.days, sessions };
    try {
      if (editId) { await updatePlan(String(editId), input); router.replace({ pathname: "/study-plan/[id]", params: { id: String(editId) } } as any); return; }
      const { id } = await createPlan(input);
      if (mode === "individual") await startPlan(id, { mode: "individual", durationKey: duration, pace, startDate: todayIso(), ...(duration === "custom" ? { customDays: Number(customDays) || 0 } : {}) }).catch(() => null);
      router.replace({ pathname: "/study-plan/[id]", params: { id } } as any);
    } catch (e: any) { setError(e?.message ?? t("p2pPlans.notAvailable")); } finally { setBusy(false); }
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <IconButton icon="close" accessibilityLabel={t("p2pPlans.back")} onPress={() => router.back()} color={c.textDark} />
        <Text style={s.title} accessibilityRole="header">{editId ? t("p2pPlans.builder.editTitle") : t("p2pPlans.builder.title")}</Text>
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.kicker}>{t("p2pPlans.builder.stepOf", { n: step })}</Text>
        <Text style={s.h1}>{t(`p2pPlans.builder.step${step}`)}</Text>
        {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}

        {step === 1 ? (
          <>
            <ChipRow accessibilityLabel={t("p2pPlans.builder.step1")} single>
              {FOCUS_TYPES.filter((f) => f !== "kingdom_school" && f !== "kingdom_stories" && f !== "deep_study").map((f) => <FilterChip key={f} label={t(`p2pPlans.focus.${f}`)} selected={focusType === f} selection="single" onPress={() => setFocusType(f)} />)}
            </ChipRow>
            {focusType === "bible_book" ? (
              <TextInput value={book} onChangeText={(v) => { setBook(v); const b = bookByName(v); if (b) setFocusLabel(b.name); }} placeholder={t("p2pPlans.builder.book")} placeholderTextColor={c.textMuted} style={s.input} accessibilityLabel={t("p2pPlans.builder.book")} />
            ) : null}
            <Text style={s.label}>{t("p2pPlans.builder.focusLabel")}</Text>
            <TextInput value={focusLabel} onChangeText={setFocusLabel} placeholder={t("p2pPlans.builder.focusLabelPlaceholder")} placeholderTextColor={c.textMuted} style={s.input} accessibilityLabel={t("p2pPlans.builder.focusLabel")} />
          </>
        ) : null}

        {step === 2 ? (
          <>
            {focusType === "bible_book" && bookObj ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>{bookObj.name}</Text>
                <View style={s.row}>
                  <TextInput value={from} onChangeText={(v) => setFrom(v.replace(/\D/g, ""))} keyboardType="number-pad" style={[s.input, { flex: 1 }]} accessibilityLabel={t("p2pPlans.builder.fromChapter")} placeholder={t("p2pPlans.builder.fromChapter")} placeholderTextColor={c.textMuted} />
                  <TextInput value={to} onChangeText={(v) => setTo(v.replace(/\D/g, ""))} keyboardType="number-pad" style={[s.input, { flex: 1 }]} accessibilityLabel={t("p2pPlans.builder.toChapter")} placeholder={`${t("p2pPlans.builder.toChapter")} (${bookObj.chapters})`} placeholderTextColor={c.textMuted} />
                </View>
                <AppButton size="sm" label={t("p2pPlans.builder.useChapters")} onPress={() => setSessions(chapterSessions(bookObj.code, Number(from) || 1, Number(to) || undefined))} />
              </View>
            ) : null}
            {focusType === "core_foundations" ? (
              <View style={s.card}>
                <Text style={s.label}>{t("p2pPlans.builder.addLesson")}</Text>
                <Text style={s.small}>{t("p2pPlans.builder.lessonsHint")}</Text>
                <TextInput value={lessonQuery} onChangeText={setLessonQuery} style={s.input} placeholder={t("p2pPlans.search")} placeholderTextColor={c.textMuted} accessibilityLabel={t("p2pPlans.search")} />
                {(lessons ?? []).filter((l) => l.title.toLowerCase().includes(lessonQuery.toLowerCase())).slice(0, 12).map((l) => (
                  <TouchableOpacity key={l.id} style={s.pick} onPress={() => setSessions((xs) => xs.some((x) => x.primaryResource?.id === l.id) ? xs : [...xs, { title: l.title, passages: [], primaryResource: { kind: "lesson", id: l.id } }])} accessibilityRole="button" accessibilityLabel={l.title}>
                    <Text style={s.body}>+ {l.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <View style={s.card}>
              <Text style={s.label}>{t("p2pPlans.builder.addPassage")}</Text>
              <View style={s.row}>
                <TextInput value={ref} onChangeText={(v) => { setRef(v); setRefError(false); }} onSubmitEditing={addPassage} style={[s.input, { flex: 1 }]} placeholder={t("p2pPlans.builder.passagePlaceholder")} placeholderTextColor={c.textMuted} accessibilityLabel={t("p2pPlans.builder.addPassage")} />
                <AppButton size="sm" icon="add" label={t("p2pPlans.builder.addPassage")} onPress={addPassage} />
              </View>
              {refError ? <Text style={s.error}>{t("p2pPlans.builder.badReference")}</Text> : null}
            </View>
            {sessions.length ? sessions.map((x, i) => (
              <View key={`${i}-${x.title}`} style={s.sessionRow}>
                <Text style={s.n}>{i + 1}</Text>
                <TextInput value={x.title} onChangeText={(v) => setSessions((xs) => xs.map((y, j) => (j === i ? { ...y, title: v } : y)))} style={[s.input, { flex: 1 }]} accessibilityLabel={t("p2pPlans.builder.sessionTitle")} />
                <IconButton icon="trash-outline" accessibilityLabel={`${t("p2pPlans.builder.remove")} ${x.title}`} onPress={() => setSessions((xs) => xs.filter((_, j) => j !== i))} color={c.textMid} />
              </View>
            )) : <Text style={s.meta}>{t("p2pPlans.builder.noSessions")}</Text>}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Text style={s.small}>{t("p2pPlans.builder.related")}</Text>
            <Text style={s.label}>{t("p2pPlans.builder.supportFor")}</Text>
            <ChipRow accessibilityLabel={t("p2pPlans.builder.supportFor")} single>
              {sessions.map((x, i) => <FilterChip key={i} label={`${i + 1}. ${x.title}`} selected={target === i} selection="single" onPress={() => setTarget(i)} />)}
            </ChipRow>
            {cur ? (
              <View style={s.card}>
                {firstPassage ? (
                  <View style={s.buttons}>
                    <AppButton size="sm" variant="secondary" label={t("p2pPlans.builder.addDeep")} onPress={() => addSupport({ kind: "deep_study", ...firstPassage })} />
                    <AppButton size="sm" variant="secondary" label={t("p2pPlans.builder.addCommentary")} onPress={() => addSupport({ kind: "commentary", book: firstPassage.book, chapter: firstPassage.chapter })} />
                  </View>
                ) : null}
                <Text style={s.label}>{t("p2pPlans.builder.addWord")}</Text>
                <View style={s.row}>
                  <TextInput value={strongs} onChangeText={(v) => setStrongs(v.toUpperCase().replace(/\s/g, ""))} style={[s.input, { flex: 1 }]} placeholder="G26" placeholderTextColor={c.textMuted} accessibilityLabel={t("p2pPlans.builder.addWord")} />
                  <AppButton size="sm" icon="add" label="+" accessibilityLabel={t("p2pPlans.builder.addWord")} disabled={!/^[HG]\d{1,5}$/.test(strongs)} onPress={() => { addSupport({ kind: "word_study", strongs }); setStrongs(""); }} />
                </View>
                <Text style={s.label}>{t("p2pPlans.builder.addTopic")}</Text>
                <ChipRow accessibilityLabel={t("p2pPlans.builder.addTopic")}>
                  {(topics ?? []).slice(0, 60).map((tp) => <FilterChip key={tp.slug} label={tp.title} selected={(cur.supporting ?? []).some((r) => r.kind === "scripture_topic" && r.slug === tp.slug)} onPress={() => addSupport({ kind: "scripture_topic", slug: tp.slug })} />)}
                </ChipRow>
                {(cur.supporting ?? []).map((r, n) => (
                  <View key={n} style={s.rowBetween}>
                    <Text style={s.body}>{t(`p2pPlans.kind.${r.kind}`)}{r.slug ? `: ${r.slug}` : r.strongs ? `: ${r.strongs}` : r.book ? `: ${passageText(r as any)}` : ""}</Text>
                    <AppButton size="sm" variant="tertiary" label={t("p2pPlans.builder.remove")} onPress={() => setSessions((xs) => xs.map((x, i) => (i === target ? { ...x, supporting: (x.supporting ?? []).filter((_, k) => k !== n) } : x)))} />
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {step === 4 ? (
          <>
            <ChipRow accessibilityLabel={t("p2pPlans.builder.step4")} single>
              {DURATIONS.map((k) => <FilterChip key={k} label={t(`p2pPlans.duration.${k}`)} selected={duration === k} selection="single" onPress={() => setDuration(k)} />)}
            </ChipRow>
            {duration === "custom" ? <TextInput value={customDays} onChangeText={(v) => setCustomDays(v.replace(/\D/g, ""))} keyboardType="number-pad" style={s.input} placeholder={t("p2pPlans.start.customDays")} placeholderTextColor={c.textMuted} accessibilityLabel={t("p2pPlans.start.customDays")} /> : null}
          </>
        ) : null}
        {step === 5 ? (
          <ChipRow accessibilityLabel={t("p2pPlans.builder.step5")} single>
            {PACES.map((k) => <FilterChip key={k} label={t(`p2pPlans.pace.${k}`)} selected={pace === k} selection="single" onPress={() => setPace(k)} />)}
          </ChipRow>
        ) : null}
        {step === 4 || step === 5 ? <Text style={[s.meta, est.tooMuch && s.error]}>{pace === "flexible" ? t("p2pPlans.start.previewFlexible") : est.days && est.perDay ? t("p2pPlans.start.preview", { perDay: est.perDay, days: est.days }) : ""}{est.tooMuch ? ` ${t("p2pPlans.start.tooMuch")}` : ""}</Text> : null}
        {step === 6 ? (
          <>
            <ChipRow accessibilityLabel={t("p2pPlans.builder.step6")} single>
              {(["individual", "together"] as const).map((k) => <FilterChip key={k} label={t(`p2pPlans.mode.${k}`)} selected={mode === k} selection="single" onPress={() => setMode(k)} />)}
            </ChipRow>
            {mode === "together" ? <Text style={s.small}>{t("p2pPlans.builder.together")}</Text> : null}
          </>
        ) : null}
        {step === 7 ? (
          <>
            <Text style={s.label}>{t("p2pPlans.builder.planTitle")}</Text>
            <TextInput value={title} onChangeText={setTitle} style={s.input} placeholder={focusLabel} placeholderTextColor={c.textMuted} accessibilityLabel={t("p2pPlans.builder.planTitle")} />
            <Text style={s.label}>{t("p2pPlans.builder.description")}</Text>
            <TextInput value={description} onChangeText={setDescription} style={[s.input, { minHeight: 70 }]} multiline accessibilityLabel={t("p2pPlans.builder.description")} />
            <View style={s.card}>
              <Text style={s.cardTitle}>{title.trim() || focusLabel}</Text>
              <Text style={s.meta}>{t(`p2pPlans.focus.${focusType}`)} · {focusLabel}</Text>
              <Text style={s.body}>{t("p2pPlans.builder.review", { sessions: sessions.length, pace: t(`p2pPlans.pace.${pace}`), duration: t(`p2pPlans.duration.${duration}`) })} · {t(`p2pPlans.mode.${mode}`)}</Text>
              {sessions.slice(0, 8).map((x, i) => <Text key={i} style={s.small}>{i + 1}. {x.title}</Text>)}
              {sessions.length > 8 ? <Text style={s.small}>…</Text> : null}
            </View>
            <Text style={s.small}>{t("p2pPlans.builder.privateNote")}</Text>
          </>
        ) : null}

        <View style={s.rowBetween}>
          {step > 1 ? <AppButton variant="secondary" icon="arrow-back" label={t("p2pPlans.builder.back")} onPress={() => setStep(step - 1)} /> : <View />}
          {step < 7 ? <AppButton icon="arrow-forward" label={t("p2pPlans.builder.next")} disabled={!canNext} onPress={() => setStep(step + 1)} />
            : <AppButton icon="checkmark" label={editId ? t("p2pPlans.builder.save") : mode === "individual" ? t("p2pPlans.builder.createAndStart") : t("p2pPlans.builder.createOnly")} disabled={!canNext || busy || !sessions.length} onPress={finish} />}
        </View>
      </ScrollView>
    </View>
  );
}
/** A resource as the server wants it back (no display-only fields). */
function strip(r: Resource): Resource { const { label, display, ...rest } = r as Resource & { label?: unknown; display?: unknown }; void label; void display; return rest as Resource; }

export default withScreenBoundary(BuilderScreen, "Create a plan");

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
    title: { flex: 1, fontSize: 18, color: c.textDark, fontFamily: "Inter_700Bold" },
    scroll: { padding: 16, gap: 12, width: "100%", maxWidth: 760, alignSelf: "center" },
    h1: { fontSize: 22, color: c.textDark, fontFamily: "Inter_700Bold" },
    body: { fontSize: 14, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 20 },
    meta: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
    small: { fontSize: 12.5, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    error: { fontSize: 13, color: c.amber, fontFamily: "Inter_600SemiBold" },
    kicker: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    label: { fontSize: 11.5, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
    card: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    cardTitle: { fontSize: 16, color: c.textDark, fontFamily: "Inter_700Bold" },
    input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.card, paddingHorizontal: 12, color: c.textDark, fontFamily: "Inter_400Regular", fontSize: 14 },
    row: { flexDirection: "row", gap: 8, alignItems: "center" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    pick: { minHeight: 40, justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderBeige },
    sessionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    n: { width: 24, textAlign: "center", fontSize: 13, color: c.textMuted, fontFamily: "Inter_700Bold" },
  });
}
