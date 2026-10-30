import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform, Alert, KeyboardAvoidingView, Animated, Modal } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { useData } from "@/contexts/DataContext";
import type { AppColors } from "@/constants/themes";
import { getKingdomStory, finishKingdomStoryChapter, markStoryOpened, type KingdomStory, type KingdomStoryChapter } from "@/lib/kingdomStoriesApi";
import { SCRIPTURE_FONT } from "@/lib/bibleReaderApi";
import { paragraphs, paragraphKind, illustrationSlots, lockedMessage, STATE_LABEL } from "@/lib/storybook";
import { checkTitle, COMPREHENSIVE_CHECK } from "@/lib/terminology";
import StoryImage from "@/components/kingdom-stories/StoryImage";
import { ScriptureChips, ScriptureText } from "@/components/kingdom-stories/ScriptureLinks";
import { useReadingScale } from "@/components/kingdom-stories/useReadingScale";
import { useReadingPosition } from "@/components/kingdom-stories/useReadingPosition";
import { usePageTurn } from "@/components/kingdom-stories/usePageTurn";
// The Core Curriculum answer card: persisted drafts, text/audio/video,
// submission and peer-review status — reused, not re-implemented.
import { QuestionResponseCard } from "@/app/lesson/[id]";
import { AppButton, IconButton } from "@/components/ui";

// One chapter of a Kingdom Story, read like a page of an illustrated book.
// Order: opening illustration, title, Scripture, the narrative (further
// illustrations placed through it), "Lessons on This Chapter", Reflection
// (private), the Comprehensive Check (reviewed by a fellow peer), what is
// still needed, then previous / contents / next. Locked chapters never arrive
// here with their text — the server withholds it.
//
// Page turns: Previous / Next / the chapter list change the chapter IN PLACE
// (no remount, no story refetch): the story stays loaded, each chapter keeps
// its own reading position (useReadingPosition), private drafts stay in the
// answer cards, and a light page-turn plays unless Reduce Motion is on
// (usePageTurn). Navigation is buttons only, so vertical scrolling and text
// selection are never captured by a swipe. The Bible reader is separate.

// What each part of the account rests on, kept apart (never blended into one claim).
const EVIDENCE: { key: keyof KingdomStoryChapter["evidence"]; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "documented", label: "Documented history", icon: "document-text-outline" },
  { key: "testimony", label: "Testimony", icon: "chatbubble-ellipses-outline" },
  { key: "tradition", label: "Tradition", icon: "library-outline" },
  { key: "disputed", label: "Disputed or uncertain", icon: "help-circle-outline" },
];

type Sub = Awaited<ReturnType<ReturnType<typeof useData>["getQuestionSubmissionsForLesson"]>>[number];

function notify(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function KingdomStoryChapterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { getQuestionSubmissionsForLesson, getAssignmentQuestionSubmissionsForLesson } = useData();
  // Opened by chapter id (from the book) or by its lesson id (from generic learning screens).
  const { id, chapter: chapterParam, lesson: lessonParam } = useLocalSearchParams<{ id: string; chapter?: string; lesson?: string }>();
  const [chapterId, setChapterId] = useState<string | undefined>(chapterParam);
  useEffect(() => { setChapterId(chapterParam); }, [chapterParam]);
  const reading = useReadingScale();
  const s = useMemo(() => makeStyles(c, reading.scale), [c, reading.scale]);

  const [story, setStory] = useState<KingdomStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reflSubs, setReflSubs] = useState<Map<string, Sub>>(new Map());
  const [checkSubs, setCheckSubs] = useState<Map<string, Sub>>(new Map());
  const [finishing, setFinishing] = useState(false);
  const position = useReadingPosition(chapterId, !!story);

  // The story (all chapters and their learning states) — on focus and after
  // finishing a chapter; NOT on every page turn.
  const chapterRef = React.useRef(chapterId);
  chapterRef.current = chapterId;
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const st = await getKingdomStory(id);
      setStory(st);
      setError(null);
      const cur = chapterRef.current;
      const ch = st.chapters?.find((x) => x.id === cur) ?? (lessonParam ? st.chapters?.find((x) => (x.lessonId ?? x.learning?.lessonId) === lessonParam) : undefined);
      if (ch && ch.id !== cur) setChapterId(ch.id);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't open this chapter.");
    } finally {
      setLoading(false);
    }
  }, [id, lessonParam]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Per chapter: the resume point (never progress) and this reader's own answers.
  const loadedCh = story?.chapters?.find((x) => x.id === chapterId);
  const chLesson = loadedCh?.learning?.lessonId ?? null;
  const chState = loadedCh?.learning?.state ?? null;
  const loadAnswers = useCallback(async () => {
    if (!chLesson || chState === "locked" || chState === "preview") { setReflSubs(new Map()); setCheckSubs(new Map()); return; }
    const [r, a] = await Promise.all([getQuestionSubmissionsForLesson(chLesson), getAssignmentQuestionSubmissionsForLesson(chLesson)]);
    setReflSubs(new Map(r.map((x) => [x.questionId, x])));
    setCheckSubs(new Map(a.map((x) => [x.questionId, x])));
  }, [chLesson, chState, getQuestionSubmissionsForLesson, getAssignmentQuestionSubmissionsForLesson]);
  useEffect(() => { void loadAnswers().catch(() => {}); }, [loadAnswers]);
  useEffect(() => {
    if (story && loadedCh && story.status === "published" && loadedCh.learning?.state !== "locked") markStoryOpened(story.id, loadedCh.id);
  }, [story?.id, story?.status, loadedCh?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const reloadAll = useCallback(async () => { await load(); await loadAnswers().catch(() => {}); }, [load, loadAnswers]);
  const pageTurn = usePageTurn();
  const [chaptersOpen, setChaptersOpen] = useState(false);

  const chapters = useMemo(() => [...(story?.chapters ?? [])].sort((a, b) => a.chapterNumber - b.chapterNumber), [story]);
  const index = chapters.findIndex((x) => x.id === chapterId);
  const ch: KingdomStoryChapter | undefined = chapters[index];
  const prev = index > 0 ? chapters[index - 1] : null;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null;

  const go = (target: KingdomStoryChapter) => {
    if (target.learning?.state === "locked") return notify(`Chapter ${target.chapterNumber} is locked`, lockedMessage(chapters, target.id));
    if (target.id === chapterId) return;
    const forward = target.chapterNumber > (ch?.chapterNumber ?? 0);
    pageTurn.turn(forward ? "next" : "prev");
    setChapterId(target.id);
    // Keep the address in step (back/refresh/share) without remounting the reader.
    router.setParams({ chapter: target.id } as any);
  };
  const toContents = () => (router.canGoBack() ? router.back() : router.replace(`/kingdom-stories/${id}` as any));

  if (loading && !story) return <View style={[s.screen, s.center]}><Stack.Screen options={{ headerShown: false }} /><ActivityIndicator color={c.accentGreen} /></View>;
  if (error || !story || !ch) {
    return (
      <View style={[s.screen, s.center, { padding: 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={s.muted}>{error ?? "This chapter isn't available."}</Text>
        <AppButton label="Back to the story" onPress={toContents} variant="tertiary" style={{ marginTop: 8 }} />
      </View>
    );
  }

  const learning = ch.learning;
  const state = learning?.state ?? "available";
  const preview = state === "preview";
  const images = (story.media ?? []).filter((m) => m.chapterId === ch.id && m.mediaType === "image").sort((a, b) => a.displayOrder - b.displayOrder);
  const paras = paragraphs(ch.narrative);
  const slots = illustrationSlots(paras.length, images.length);
  const check = learning?.check ?? null;
  const reflections = learning?.reflectionQuestions ?? [];

  if (state === "locked") {
    return (
      <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[s.center, { flex: 1, padding: 24, gap: 12 }]}>
          <Ionicons name="lock-closed" size={32} color={c.textMuted} />
          <Text style={s.lockedTitle}>Chapter {ch.chapterNumber}: {ch.title}</Text>
          <Text style={s.mutedCenter}>{lockedMessage(chapters, ch.id)}</Text>
          <AppButton label="Back to contents" onPress={toContents} variant="tertiary" style={{ marginTop: 8 }} />
        </View>
      </View>
    );
  }

  async function finish() {
    if (!story || !ch || finishing) return;
    setFinishing(true);
    try { await finishKingdomStoryChapter(story.id, ch.id); await reloadAll(); }
    catch (e: any) { notify("Couldn't finish the chapter", e?.message ?? "Please try again."); }
    finally { setFinishing(false); }
  }

  const doneCount = chapters.filter((x) => x.learning?.state === "completed").length;
  const checkSub = check?.questions[0] ? checkSubs.get(check.questions[0].id) : undefined;
  const statusText = preview ? "Preview: the reflections and Comprehensive Check open for readers once the story is published."
    : state === "completed" ? (next ? `Chapter complete. Chapter ${next.chapterNumber} is open.` : "Chapter complete — you've finished this story.")
    : state === "awaiting_review" ? `Your Comprehensive Check is with a fellow peer for review.${next ? ` Chapter ${next.chapterNumber} is already open.` : ""}`
    : check ? `To open ${next ? `Chapter ${next.chapterNumber}` : "the end of the story"}, submit this chapter's Comprehensive Check.`
    : `When you have read this chapter, mark it finished${next ? ` to open Chapter ${next.chapterNumber}` : ""}.`;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[s.screen, { paddingTop: insets.top + 4 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.header}>
          <IconButton icon="arrow-back" accessibilityLabel="Return to the story" onPress={toContents} color={c.textDark} />
          <TouchableOpacity style={s.headerMid} onPress={() => setChaptersOpen(true)} accessibilityRole="button"
            accessibilityLabel={`Chapter ${ch.chapterNumber} of ${chapters.length}: ${ch.title}. Choose a chapter`}>
            <Text style={s.headerTitle} numberOfLines={1}>{story.title} · {ch.chapterNumber} of {chapters.length}</Text>
            <View style={s.headerChapterRow}>
              <Text style={s.headerChapter} numberOfLines={1}>{ch.title}</Text>
              <Ionicons name="chevron-down" size={14} color={c.textMid} />
            </View>
          </TouchableOpacity>
          <View style={s.sizeRow}>
            <TouchableOpacity onPress={reading.smaller} disabled={!reading.canSmaller} style={[s.iconBtn, !reading.canSmaller && { opacity: 0.35 }]} accessibilityRole="button" accessibilityLabel="Smaller text">
              <Text style={s.sizeSmall}>A</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={reading.larger} disabled={!reading.canLarger} style={[s.iconBtn, !reading.canLarger && { opacity: 0.35 }]} accessibilityRole="button" accessibilityLabel="Larger text">
              <Text style={s.sizeLarge}>A</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={s.progressTrack} accessible accessibilityRole="progressbar"
          accessibilityLabel={`Reading progress: ${doneCount} of ${chapters.length} chapters complete`}
          accessibilityValue={{ min: 0, max: chapters.length, now: doneCount }}>
          <View style={[s.progressFill, { width: `${chapters.length ? Math.round((doneCount / chapters.length) * 100) : 0}%` as any }]} />
        </View>

        <ScrollView ref={position.ref} onScroll={position.onScroll} scrollEventThrottle={100} onContentSizeChange={position.onContentSizeChange}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          <Animated.View style={[s.page, pageTurn.pageStyle as any]}>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.shade, pageTurn.shadeStyle]} />
            {images[0] ? <StoryImage media={images[0]} /> : null}

            <Text style={s.kicker}>Chapter {ch.chapterNumber}</Text>
            <Text style={s.title} accessibilityRole="header">{ch.title}</Text>
            <View style={s.statePill} accessible accessibilityLabel={`Status: ${STATE_LABEL[state]}`}>
              <Text style={s.statePillText}>{STATE_LABEL[state]}</Text>
            </View>
            {!!ch.scriptureRefs && <View style={{ marginTop: 14 }}><ScriptureChips line={ch.scriptureRefs} /></View>}
            {[ch.dates, ch.places, ch.people].filter(Boolean).map((m, i) => <Text key={i} style={s.meta}>{m}</Text>)}

            <View style={s.narrative}>
              {paras.map((p, i) => {
                // Set by kind (sub-heading, numbered item, bold label, plain) — the words are never changed.
                const pk = paragraphKind(p);
                return (
                <React.Fragment key={i}>
                  {pk.kind === "heading" ? <Text style={s.subheading} accessibilityRole="header">{pk.text}</Text>
                    : pk.kind === "numbered" ? (
                      <View style={s.itemRow}>
                        <Text style={s.itemNum}>{pk.number}.</Text>
                        <ScriptureText text={pk.text} style={[s.paragraph, { flex: 1 }]} />
                      </View>
                    ) : pk.kind === "labelled" ? <ScriptureText text={pk.text} label={`${pk.label}:`} labelStyle={s.label} style={s.paragraph} />
                    : <ScriptureText text={p} style={s.paragraph} />}
                  {slots.map((slot, k) => slot === i ? <View key={k} style={{ marginVertical: 8 }}><StoryImage media={images[k + 1]} /></View> : null)}
                </React.Fragment>
                );
              })}
            </View>

            {EVIDENCE.some((e) => ch.evidence?.[e.key]) && (
              <View style={s.evidenceBox}>
                <Text style={s.evidenceLabel}>What this account rests on</Text>
                {EVIDENCE.filter((e) => ch.evidence?.[e.key]).map((e) => (
                  <View key={e.key} style={s.evidenceRow}>
                    <Ionicons name={e.icon} size={14} color={c.textMuted} style={{ marginTop: 3 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.evidenceKind}>{e.label}</Text>
                      <Text style={s.evidenceText}>{ch.evidence[e.key]}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <Text style={s.ornament} accessibilityElementsHidden importantForAccessibility="no">❦</Text>

            {ch.lessons.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle} accessibilityRole="header">Lessons on This Chapter</Text>
                {ch.lessons.map((l, i) => (
                  <View key={i} style={s.lessonRow}>
                    <Text style={s.lessonNum}>{i + 1}</Text>
                    <ScriptureText text={l} style={s.lessonText} />
                  </View>
                ))}
              </View>
            )}

            {reflections.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle} accessibilityRole="header">Reflection</Text>
                <View style={s.noteRow}>
                  <Ionicons name="lock-closed-outline" size={13} color={c.textMuted} />
                  <Text style={s.note}>Private — only you can see your reflections. Unsent writing is kept as a private draft, on this device and your other devices, until you submit it.</Text>
                </View>
                {preview ? reflections.map((r, i) => <Text key={r.id} style={s.previewQ}>{i + 1}. {r.question}</Text>)
                  : reflections.map((r, i) => (
                    <QuestionResponseCard key={r.id} question={r} questionIndex={i} lessonId={learning!.lessonId!} existingSub={reflSubs.get(r.id)} kind="reflection" onSubmitted={reloadAll} />
                  ))}
              </View>
            )}
            {/* A preview before activities are prepared: the chapter's own questions as text. */}
            {preview && !reflections.length && ch.reflections.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Reflection</Text>
                {ch.reflections.map((r, i) => <Text key={i} style={s.previewQ}>{i + 1}. {r}</Text>)}
              </View>
            )}

            {(check || (preview && (ch.assignment?.text || ch.assignment?.title))) && (
              <View style={s.section}>
                <Text style={s.sectionTitle} accessibilityRole="header">{COMPREHENSIVE_CHECK}</Text>
                {check && checkTitle(check.title) !== COMPREHENSIVE_CHECK && <Text style={s.checkTitle}>{checkTitle(check.title)}</Text>}
                {!check && !!ch.assignment?.title && <Text style={s.checkTitle}>{ch.assignment.title}</Text>}
                <View style={s.noteRow}>
                  <Ionicons name="people-outline" size={13} color={c.textMuted} />
                  <Text style={s.note}>A fellow peer who has finished this chapter reads your answer and responds — feedback comes from peers, not from AI. If no one has finished it yet, your answer is accepted so you can keep reading.</Text>
                </View>
                {preview || !check ? <Text style={s.previewQ}>{check?.questions[0]?.question ?? ch.assignment?.text}</Text>
                  : check.questions.map((q, i) => (
                    <QuestionResponseCard key={q.id} question={q} questionIndex={i} lessonId={learning!.lessonId!} existingSub={checkSubs.get(q.id)} kind="assignment" assignmentId={check.assignmentId} onSubmitted={reloadAll} />
                  ))}
                {!!checkSub && checkSub.evaluationStatus === "approved" && <Text style={s.reviewed}>Reviewed and approved by a fellow peer{checkSub.feedback ? `: “${checkSub.feedback}”` : "."}</Text>}
              </View>
            )}

            {ch.sources.length > 0 && (
              <View style={s.section}>
                <Text style={s.evidenceLabel}>Chapter sources</Text>
                {ch.sources.map((src) => (
                  <View key={src.id} style={s.sourceRow}>
                    <Text style={s.evidenceKind}>{src.title}</Text>
                    {!!(src.publisher || src.citation) && <Text style={s.evidenceText}>{[src.publisher, src.citation].filter(Boolean).join(" · ")}</Text>}
                  </View>
                ))}
              </View>
            )}

            <View style={s.statusBox} accessibilityLiveRegion="polite">
              <Ionicons name={state === "completed" ? "checkmark-circle" : state === "awaiting_review" ? "people" : "flag-outline"} size={18} color={state === "completed" ? c.accentGreen : c.textMid} />
              <Text style={s.statusText}>{statusText}</Text>
            </View>
            {!preview && !check && state !== "completed" && learning?.lessonId && (
              <AppButton label="Finish chapter" onPress={finish} size="lg" disabled={finishing} loading={finishing} style={{ marginTop: 12 }} />
            )}

            <View style={s.navRow}>
              <TouchableOpacity style={[s.navBtn, !prev && { opacity: 0.35 }]} disabled={!prev} onPress={() => prev && go(prev)} accessibilityRole="button" accessibilityLabel={prev ? `Previous: Chapter ${prev.chapterNumber}` : "No previous chapter"}>
                <Ionicons name="chevron-back" size={16} color={c.textDark} /><Text style={s.navText}>Previous</Text>
              </TouchableOpacity>
              <AppButton label="Chapters" onPress={() => setChaptersOpen(true)} variant="outline" icon="list" accessibilityLabel="Choose a chapter" />
              <TouchableOpacity style={[s.navBtn, !next && { opacity: 0.35 }]} disabled={!next} onPress={() => next && go(next)} accessibilityRole="button"
                accessibilityLabel={next ? `Next: Chapter ${next.chapterNumber}${next.learning?.state === "locked" ? ", locked" : ""}` : "No next chapter"}>
                <Text style={s.navText}>Next</Text>
                <Ionicons name={next?.learning?.state === "locked" ? "lock-closed" : "chevron-forward"} size={16} color={c.textDark} />
              </TouchableOpacity>
            </View>
            {chapters.length > 1 && chapters.length <= 30 ? (
              <View style={s.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {chapters.map((x) => <View key={x.id} style={[s.dot, x.learning?.state === "completed" && s.dotDone, x.id === ch.id && s.dotHere]} />)}
              </View>
            ) : null}
            <AppButton label="Return to Story" onPress={toContents} variant="tertiary" style={{ alignSelf: "center", marginTop: 8 }} />
          </Animated.View>
        </ScrollView>
      </View>

      <Modal visible={chaptersOpen} transparent animationType="fade" onRequestClose={() => setChaptersOpen(false)}>
        <TouchableOpacity accessibilityRole="button" style={s.overlay} activeOpacity={1} onPress={() => setChaptersOpen(false)} accessibilityLabel="Close chapters">
          <TouchableOpacity activeOpacity={1} style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle} accessibilityRole="header">Chapters</Text>
              <IconButton icon="close" accessibilityLabel="Close" onPress={() => setChaptersOpen(false)} color={c.textDark} />
            </View>
            <ScrollView>
              {chapters.map((x) => {
                const st = x.learning?.state ?? "available";
                const here = x.id === ch.id;
                return (
                  <TouchableOpacity key={x.id} style={[s.chRow, here && s.chRowHere]} onPress={() => { setChaptersOpen(false); go(x); }}
                    accessibilityRole="button" accessibilityState={{ selected: here, disabled: st === "locked" }}
                    accessibilityLabel={`Chapter ${x.chapterNumber}: ${x.title}. ${STATE_LABEL[st]}`}>
                    <Text style={s.chNum}>{x.chapterNumber}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.chTitle} numberOfLines={2}>{x.title}</Text>
                      <Text style={s.chState}>{here ? "Reading now" : STATE_LABEL[st]}</Text>
                    </View>
                    <Ionicons name={st === "locked" ? "lock-closed" : st === "completed" ? "checkmark-circle" : "chevron-forward"} size={18} color={st === "completed" ? c.accentGreen : c.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: AppColors, k: number) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.lightCream },
    center: { alignItems: "center", justifyContent: "center" },
    muted: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular" },
    mutedCenter: { fontSize: 15, color: c.textMid, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
    lockedTitle: { fontSize: 20, color: c.textDark, fontFamily: SCRIPTURE_FONT, fontWeight: "700", textAlign: "center" },
    linkText: { color: c.accentGreen, fontSize: 15, fontFamily: "Inter_600SemiBold" },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, gap: 4 },
    iconBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
    headerMid: { flex: 1, alignItems: "center", minHeight: 44, justifyContent: "center" },
    headerTitle: { textAlign: "center", fontSize: 12, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    headerChapterRow: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" },
    headerChapter: { flexShrink: 1, fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    progressTrack: { height: 3, backgroundColor: c.progressTrack ?? c.borderBeige, marginTop: 2 },
    progressFill: { height: 3, backgroundColor: c.accentGreen },
    shade: { backgroundColor: "#000", zIndex: 1 },
    dots: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 18 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.borderBeige },
    dotDone: { backgroundColor: c.lightGreen ?? c.accentGreen },
    dotHere: { backgroundColor: c.accentGreen, width: 18 },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { maxHeight: "75%", width: "100%", maxWidth: 640, alignSelf: "center", backgroundColor: c.lightCream, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 16 },
    sheetHead: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingTop: 6 },
    sheetTitle: { flex: 1, fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    chRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 56 },
    chRowHere: { backgroundColor: c.card },
    chNum: { width: 26, fontSize: 16, color: c.accentGreen, fontFamily: SCRIPTURE_FONT, fontWeight: "700", textAlign: "center" },
    chTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_500Medium" },
    chState: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    sizeRow: { flexDirection: "row" },
    sizeSmall: { fontSize: 14, color: c.textDark, fontFamily: SCRIPTURE_FONT },
    sizeLarge: { fontSize: 20, color: c.textDark, fontFamily: SCRIPTURE_FONT },
    page: { paddingHorizontal: 16, paddingTop: 8, width: "100%", alignSelf: "center" },
    kicker: { marginTop: 20, fontSize: 12, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 1, textAlign: "left" },
    title: { marginTop: 6, fontSize: 26 * k, lineHeight: 32 * k, color: c.textDark, fontFamily: SCRIPTURE_FONT, fontWeight: "700", textAlign: "left" },
    statePill: { alignSelf: "flex-start", marginTop: 10, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    statePillText: { fontSize: 11, color: c.textMid, fontFamily: "Inter_600SemiBold" },
    meta: { marginTop: 6, fontSize: 13, color: c.textMuted, fontFamily: "Inter_500Medium", textAlign: "left" },
    narrative: { marginTop: 20, gap: 16 },
    paragraph: { fontSize: 18 * k, lineHeight: 30 * k, color: c.textDark, fontFamily: SCRIPTURE_FONT, textAlign: "left" },
    subheading: { marginTop: 10, fontSize: 19 * k, lineHeight: 26 * k, color: c.textDark, fontFamily: SCRIPTURE_FONT, fontWeight: "700", textAlign: "left" },
    label: { fontFamily: SCRIPTURE_FONT, fontWeight: "700", color: c.textDark },
    itemRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    itemNum: { minWidth: 22, fontSize: 18 * k, lineHeight: 30 * k, color: c.accentGreen, fontFamily: SCRIPTURE_FONT, fontWeight: "700" },
    ornament: { textAlign: "center", fontSize: 22, color: c.textMuted, marginVertical: 26 },
    section: { gap: 12, marginBottom: 28 },
    sectionTitle: { fontSize: 20 * k, color: c.textDark, fontFamily: SCRIPTURE_FONT, fontWeight: "700" },
    lessonRow: { flexDirection: "row", gap: 12 },
    lessonNum: { width: 22, fontSize: 17 * k, lineHeight: 26 * k, color: c.accentGreen, fontFamily: SCRIPTURE_FONT, fontWeight: "700" },
    lessonText: { flex: 1, fontSize: 16 * k, lineHeight: 26 * k, color: c.textDark, fontFamily: SCRIPTURE_FONT },
    noteRow: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
    note: { flex: 1, fontSize: 12, lineHeight: 18, color: c.textMuted, fontFamily: "Inter_400Regular" },
    previewQ: { fontSize: 15 * k, lineHeight: 23 * k, color: c.textMid, fontFamily: SCRIPTURE_FONT },
    checkTitle: { fontSize: 16 * k, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    reviewed: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_500Medium" },
    evidenceBox: { marginTop: 24, borderWidth: 1, borderColor: c.borderBeige, borderRadius: 14, padding: 14, gap: 10 },
    evidenceLabel: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.6 },
    evidenceRow: { flexDirection: "row", gap: 8 },
    evidenceKind: { fontSize: 13, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    evidenceText: { fontSize: 14 * k, lineHeight: 21 * k, color: c.textMid, fontFamily: "Inter_400Regular" },
    sourceRow: { paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: c.borderBeige, gap: 2 },
    statusBox: { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 14, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    statusText: { flex: 1, fontSize: 14, lineHeight: 21, color: c.textDark, fontFamily: "Inter_500Medium" },
    navRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 24 },
    navBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderBeige },
    navText: { fontSize: 14, color: c.textDark, fontFamily: "Inter_600SemiBold" },
  });
}
