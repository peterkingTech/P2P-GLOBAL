import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  TextInput,
  Modal,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { supabase, useAuth } from "@/contexts/AuthContext";
import {
  useData,
  Assignment,
  QuestionSubmission,
  SubmissionType,
  UserHighlight,
} from "@/contexts/DataContext";
import AudioRecorder from "@/components/AudioRecorder";
import VideoRecorder from "@/components/VideoRecorder";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { useTranslation } from "react-i18next";
import { fetchBatchVerseText, VerseResult } from "@/lib/bibleClient";

interface LessonContent {
  title: string;
  sections: { id: string; title: string; content: string }[];
  scriptures: { id: string; reference: string; verse: string }[];
  questions: { id: string; question: string }[];
  attribution?: string;
}

// ── Submission type tab selector ──────────────────────────────────────────────
function TypeTabs({
  value,
  onChange,
  disabled,
}: {
  value: SubmissionType;
  onChange: (t: SubmissionType) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const tabStyles = makeTabStyles(colors);
  const tabs: { type: SubmissionType; icon: string; label: string }[] = [
    { type: "text", icon: "create-outline", label: t("lesson.text") },
    { type: "audio", icon: "mic-outline", label: t("lesson.audio") },
    { type: "video", icon: "videocam-outline", label: t("lesson.video") },
  ];
  return (
    <View style={tabStyles.row}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.type}
          style={[tabStyles.tab, value === tab.type && tabStyles.tabActive]}
          onPress={() => !disabled && onChange(tab.type)}
          disabled={disabled}
          activeOpacity={0.75}
        >
          <Ionicons
            name={tab.icon as any}
            size={14}
            color={value === tab.type ? colors.cream : colors.textMid}
          />
          <Text style={[tabStyles.label, value === tab.type && tabStyles.labelActive]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function makeTabStyles(c: AppColors) {
  return StyleSheet.create({
  row: {
    flexDirection: "row", gap: 6, marginBottom: 12,
  },
  tab: {
    flex: 1, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center",
    paddingVertical: 7, borderRadius: 10,
    backgroundColor: c.cardBeige, borderWidth: 1, borderColor: c.borderBeige,
  },
  tabActive: { backgroundColor: c.accentGreen, borderColor: c.accentGreen },
  label: { fontSize: 12, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold" },
  labelActive: { color: c.cream },
  });
}

// ── Question response card ────────────────────────────────────────────────────
function QuestionResponseCard({
  question,
  questionIndex,
  lessonId,
  existingSub,
  kind = "reflection",
  assignmentId,
  onSubmitted,
}: {
  question: { id: string; question: string };
  questionIndex: number;
  lessonId: string;
  existingSub: QuestionSubmission | undefined;
  kind?: "reflection" | "assignment";
  assignmentId?: string;
  onSubmitted?: () => void;
}) {
  const { submitContent } = useData();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const qStyles = makeQStyles(colors);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<SubmissionType>("text");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<QuestionSubmission | null>(existingSub ?? null);
  const [error, setError] = useState<string | null>(null);

  // existingSub is refetched (with real evaluation status) after every submit
  // and can also change from a live realtime update — keep local state in sync
  // rather than only reading it once at mount.
  useEffect(() => {
    setSubmitted(existingSub ?? null);
  }, [existingSub]);

  async function handleTextSubmit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const err = await submitContent({
      lessonId,
      questionId: kind === "reflection" ? question.id : null,
      assignmentQuestionId: kind === "assignment" ? question.id : null,
      assignmentId: kind === "assignment" ? assignmentId : null,
      type: "text",
      text: text.trim(),
    });
    setSubmitting(false);
    if (err) { setError(err); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitted({ id: Date.now().toString(), questionId: question.id, submissionType: "text", textContent: text.trim(), mediaUrl: null, durationSeconds: null, createdAt: new Date().toISOString(), evaluationStatus: "pending" });
    setExpanded(false);
    onSubmitted?.();
  }

  async function handleMediaSubmit(localUri: string, durationSeconds: number) {
    const err = await submitContent({
      lessonId,
      questionId: kind === "reflection" ? question.id : null,
      assignmentQuestionId: kind === "assignment" ? question.id : null,
      assignmentId: kind === "assignment" ? assignmentId : null,
      type: mode as "audio" | "video",
      mediaUri: localUri,
      durationSeconds,
    });
    if (err) { setError(err); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitted({ id: Date.now().toString(), questionId: question.id, submissionType: mode, textContent: null, mediaUrl: "uploaded", durationSeconds, createdAt: new Date().toISOString(), evaluationStatus: "pending" });
    setExpanded(false);
    onSubmitted?.();
  }

  const typeIcon = (t: SubmissionType) => t === "audio" ? "mic" : t === "video" ? "videocam" : "chatbubble";

  const badgeInfo = (() => {
    if (kind !== "assignment") {
      return { icon: submitted ? typeIcon(submitted.submissionType) : "chatbubble", color: colors.accentGreen, bg: "rgba(29,158,117,0.08)", label: t("lesson.respondedTapToUpdate") };
    }
    switch (submitted?.evaluationStatus) {
      case "approved":
        return { icon: "checkmark-circle", color: colors.accentGreen, bg: "rgba(29,158,117,0.08)", label: t("lesson.approved") };
      case "needs_revision":
        return { icon: "alert-circle", color: "#C0392B", bg: "rgba(192,57,43,0.08)", label: t("lesson.needsRevisionTap") };
      default:
        return { icon: "time-outline", color: colors.amber, bg: "rgba(217,164,65,0.1)", label: t("lesson.submittedWaiting") };
    }
  })();

  return (
    <View style={qStyles.wrapper}>
      <View style={qStyles.questionRow}>
        <View style={qStyles.questionNum}>
          <Text style={qStyles.questionNumText}>{questionIndex + 1}</Text>
        </View>
        <Text style={qStyles.questionText}>{question.question}</Text>
      </View>

      {submitted ? (
        <>
          {kind === "assignment" && submitted.evaluationStatus === "needs_revision" ? (
            <TouchableOpacity
              style={[qStyles.submittedBadge, { backgroundColor: badgeInfo.bg }]}
              onPress={() => { setSubmitted(null); setExpanded(true); }}
              activeOpacity={0.7}
            >
              <Ionicons name={badgeInfo.icon as any} size={12} color={badgeInfo.color} />
              <Text style={[qStyles.submittedText, { color: badgeInfo.color }]}>{badgeInfo.label}</Text>
            </TouchableOpacity>
          ) : (
            <View style={[qStyles.submittedBadge, { backgroundColor: badgeInfo.bg }]}>
              <Ionicons name={badgeInfo.icon as any} size={12} color={badgeInfo.color} />
              <Text style={[qStyles.submittedText, { color: badgeInfo.color }]}>{badgeInfo.label}</Text>
            </View>
          )}
          {kind === "assignment" && submitted.evaluationStatus === "needs_revision" && submitted.feedback ? (
            <View style={qStyles.revisionBanner}>
              <Ionicons name="chatbox-ellipses-outline" size={14} color="#C0392B" />
              <Text style={qStyles.revisionBannerText}>{submitted.feedback}</Text>
            </View>
          ) : null}
        </>
      ) : (
        <TouchableOpacity
          style={qStyles.shareToggle}
          onPress={() => setExpanded((v) => !v)}
          activeOpacity={0.75}
        >
          <Ionicons name={expanded ? "chevron-up" : "chatbubble-outline"} size={13} color={colors.textMid} />
          <Text style={qStyles.shareToggleText}>{expanded ? t("lesson.hide") : t("lesson.shareYourResponse")}</Text>
        </TouchableOpacity>
      )}

      {expanded && !submitted && (
        <View style={qStyles.inputArea}>
          <TypeTabs value={mode} onChange={setMode} disabled={submitting} />
          {mode === "text" ? (
            <>
              <TextInput
                style={qStyles.textInput}
                multiline
                placeholder={t("lesson.writeReflection")}
                placeholderTextColor={colors.textMuted}
                value={text}
                onChangeText={setText}
              />
              {error && <Text style={qStyles.error}>{error}</Text>}
              <TouchableOpacity
                style={[qStyles.submitBtn, (!text.trim() || submitting) && qStyles.submitBtnDisabled]}
                onPress={handleTextSubmit}
                disabled={!text.trim() || submitting}
                activeOpacity={0.85}
              >
                {submitting ? <ActivityIndicator color={colors.cream} size="small" /> : (
                  <>
                    <Ionicons name="send" size={14} color={colors.cream} />
                    <Text style={qStyles.submitBtnText}>{t("lesson.shareResponse")}</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : mode === "audio" ? (
            <>
              {error && <Text style={qStyles.error}>{error}</Text>}
              <AudioRecorder onSubmit={handleMediaSubmit} disabled={submitting} />
            </>
          ) : (
            <>
              {error && <Text style={qStyles.error}>{error}</Text>}
              <VideoRecorder onSubmit={handleMediaSubmit} disabled={submitting} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

function makeQStyles(c: AppColors) {
  return StyleSheet.create({
  wrapper: { marginBottom: 14 },
  questionRow: { flexDirection: "row", gap: 12, marginBottom: 6, alignItems: "flex-start" },
  questionNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(29,158,117,0.12)",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  questionNumText: { fontSize: 11, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
  questionText: { flex: 1, fontSize: 14, color: c.textDark, lineHeight: 22, fontFamily: "Inter_400Regular" },
  submittedBadge: {
    flexDirection: "row", gap: 5, alignItems: "center",
    marginLeft: 36, marginTop: 2, marginBottom: 2,
    backgroundColor: "rgba(29,158,117,0.08)",
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: "flex-start",
  },
  submittedText: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_500Medium" },
  revisionBanner: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    marginLeft: 36, marginTop: 6, marginBottom: 2,
    backgroundColor: "rgba(192,57,43,0.06)", borderRadius: 10, borderWidth: 1,
    borderColor: "rgba(192,57,43,0.25)", padding: 10,
  },
  revisionBannerText: { flex: 1, fontSize: 12, color: c.textDark, lineHeight: 18, fontFamily: "Inter_400Regular" },
  shareToggle: {
    flexDirection: "row", gap: 5, alignItems: "center",
    marginLeft: 36, marginTop: 2,
    alignSelf: "flex-start",
  },
  shareToggleText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular" },
  inputArea: { marginLeft: 36, marginTop: 8 },
  textInput: {
    borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
    padding: 10, minHeight: 80, textAlignVertical: "top",
    fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular",
    marginBottom: 10, backgroundColor: c.lightCream,
  },
  error: { fontSize: 12, color: "#C0392B", marginBottom: 8, fontFamily: "Inter_400Regular" },
  submitBtn: {
    flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    backgroundColor: c.primaryGreen, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: c.cream, fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  });
}

// ── Tappable highlightable paragraph ──────────────────────────────────────────
export const HIGHLIGHT_COLORS: { key: string; label: string; swatch: string; bg: string }[] = [
  { key: "yellow", label: "Yellow", swatch: "#FACC15", bg: "rgba(250,204,21,0.45)" },
  { key: "green", label: "Green", swatch: "#4ADE80", bg: "rgba(74,222,128,0.4)" },
  { key: "blue", label: "Blue", swatch: "#60A5FA", bg: "rgba(96,165,250,0.4)" },
  { key: "pink", label: "Pink", swatch: "#F472B6", bg: "rgba(244,114,182,0.4)" },
  { key: "orange", label: "Orange", swatch: "#FB923C", bg: "rgba(251,146,60,0.4)" },
];

export function highlightColorBg(key?: string): string {
  return HIGHLIGHT_COLORS.find((c) => c.key === key)?.bg ?? HIGHLIGHT_COLORS[0].bg;
}

function splitSentences(text: string): { text: string; start: number; end: number }[] {
  const parts: { text: string; start: number; end: number }[] = [];
  const regex = /[^.!?]+[.!?]*\s*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].trim().length === 0) continue;
    parts.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return parts.length > 0 ? parts : [{ text, start: 0, end: text.length }];
}

function HighlightableParagraph({
  sectionId,
  lessonId,
  content,
  highlights,
  onToggle,
  onLongPressExisting,
}: {
  sectionId: string;
  lessonId: string;
  content: string;
  highlights: UserHighlight[];
  onToggle: (params: { sectionId: string; lessonId: string; text: string; start: number; end: number }) => void;
  onLongPressExisting: (highlight: UserHighlight) => void;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const sentences = splitSentences(content);
  return (
    <Text style={styles.bodyPara}>
      {sentences.map((s, idx) => {
        const existing = highlights.find(
          (h) => h.sectionId === sectionId && h.startOffset === s.start && h.endOffset === s.end
        );
        return (
          <Text
            key={idx}
            onPress={() => onToggle({ sectionId, lessonId, text: s.text.trim(), start: s.start, end: s.end })}
            onLongPress={() => existing && onLongPressExisting(existing)}
            style={existing ? { backgroundColor: highlightColorBg(existing.color) } : undefined}
          >
            {s.text}
          </Text>
        );
      })}
    </Text>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function LessonScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    lessons, markLessonComplete,
    getAssignmentForLesson, getQuestionSubmissionsForLesson,
    getAssignmentQuestionsForLesson, getAssignmentQuestionSubmissionsForLesson,
    getHighlightsForLesson, addSectionHighlight, deleteHighlight,
    contentLanguage,
  } = useData();

  const [content, setContent] = useState<LessonContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [assignmentQuestions, setAssignmentQuestions] = useState<{ id: string; question: string }[]>([]);
  const [questionSubs, setQuestionSubs] = useState<Map<string, QuestionSubmission>>(new Map());
  const [assignmentQuestionSubs, setAssignmentQuestionSubs] = useState<Map<string, QuestionSubmission>>(new Map());
  const [highlights, setHighlights] = useState<UserHighlight[]>([]);
  // Translated verse texts keyed by scripture row id (loaded after content)
  const [verseTexts, setVerseTexts] = useState<Map<string, VerseResult>>(new Map());
  const versesFetchedForLang = useRef<string | null>(null);

  const [pendingHighlight, setPendingHighlight] = useState<
    { sectionId: string; lessonId: string; text: string; start: number; end: number } | null
  >(null);
  const [editingHighlight, setEditingHighlight] = useState<UserHighlight | null>(null);

  const loadHighlights = useCallback(async () => {
    if (!id) return;
    setHighlights(await getHighlightsForLesson(id));
  }, [id, getHighlightsForLesson]);

  useEffect(() => { loadHighlights(); }, [loadHighlights]);

  // Fetch translated verse text when scriptures load or language changes.
  // English is served directly from p2p_scriptures (no API call needed).
  useEffect(() => {
    const scriptures = content?.scriptures;
    if (!scriptures?.length || !contentLanguage || contentLanguage === "en") {
      setVerseTexts(new Map());
      versesFetchedForLang.current = null;
      return;
    }
    // Skip if already fetched for this language + lesson
    const fetchKey = `${id}:${contentLanguage}`;
    if (versesFetchedForLang.current === fetchKey) return;
    versesFetchedForLang.current = fetchKey;

    fetchBatchVerseText(
      scriptures.map((s) => ({ id: s.id, ref: s.reference })),
      contentLanguage
    ).then((map) => setVerseTexts(map)).catch(() => {/* keep stored text */});
  }, [content?.scriptures, contentLanguage, id]);

  function handleToggleHighlight(params: { sectionId: string; lessonId: string; text: string; start: number; end: number }) {
    const existing = highlights.find(
      (h) => h.sectionId === params.sectionId && h.startOffset === params.start && h.endOffset === params.end
    );
    Haptics.selectionAsync();
    if (existing) {
      setHighlights((prev) => prev.filter((h) => h.id !== existing.id));
      deleteHighlight(existing.id);
    } else {
      setPendingHighlight(params);
    }
  }

  async function handleChooseColor(colorKey: string) {
    if (pendingHighlight) {
      const params = pendingHighlight;
      setPendingHighlight(null);
      const err = await addSectionHighlight({
        lessonId: params.lessonId,
        sectionId: params.sectionId,
        reference: content?.title ?? "Lesson",
        quote: params.text,
        startOffset: params.start,
        endOffset: params.end,
        color: colorKey,
      });
      if (!err) loadHighlights();
    } else if (editingHighlight) {
      const h = editingHighlight;
      setEditingHighlight(null);
      await deleteHighlight(h.id);
      const err = await addSectionHighlight({
        lessonId: h.lessonId ?? (id as string),
        sectionId: h.sectionId ?? "",
        reference: h.reference,
        quote: h.quote ?? "",
        startOffset: h.startOffset ?? 0,
        endOffset: h.endOffset ?? 0,
        color: colorKey,
      });
      if (!err) loadHighlights();
    }
  }

  function handleRemoveHighlight() {
    if (editingHighlight) {
      const h = editingHighlight;
      setEditingHighlight(null);
      setHighlights((prev) => prev.filter((x) => x.id !== h.id));
      deleteHighlight(h.id);
    }
  }

  const lessonMeta = lessons.find((l) => l.id === id);
  const completed = lessonMeta?.isCompleted ?? false;

  // Load lesson content
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      setIsLoading(true);
      try {
        const [{ data: lesson }, { data: sections }, { data: scriptures }, { data: questions }] =
          await Promise.all([
            supabase.from("p2p_lessons").select("id,title,module_id,p2p_modules(attribution_text)").eq("id", id).maybeSingle(),
            supabase.from("p2p_lesson_sections").select("id,title,content,section_order").eq("lesson_id", id).order("section_order", { ascending: true }),
            supabase.from("p2p_scriptures").select("id,reference,verse,display_order").eq("lesson_id", id).order("display_order", { ascending: true }),
            supabase.from("p2p_reflection_questions").select("id,question,display_order").eq("lesson_id", id).order("display_order", { ascending: true }),
          ]);
        if (!cancelled) {
          const mod = lesson?.p2p_modules as Record<string, unknown> | null;
          const attribution = (mod?.attribution_text as string) ?? undefined;
          setContent({
            title: (lesson?.title as string) ?? lessonMeta?.title ?? "Lesson",
            sections: ((sections ?? []) as Record<string, unknown>[]).map((s) => ({ id: s.id as string, title: (s.title as string) ?? "", content: (s.content as string) ?? "" })),
            scriptures: ((scriptures ?? []) as Record<string, unknown>[]).map((s) => ({ id: s.id as string, reference: s.reference as string, verse: s.verse as string })),
            questions: ((questions ?? []) as Record<string, unknown>[]).map((q) => ({ id: q.id as string, question: q.question as string })),
            attribution,
          });
        }
      } catch {
        if (!cancelled) setContent({ title: lessonMeta?.title ?? "Lesson", sections: [], scriptures: [], questions: [] });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  // Load assignment + question submissions. Exposed via useCallback so it can
  // also be re-run after a fresh submit (to pick up the real evaluation status
  // the DB trigger just created) and from the realtime subscription below.
  const loadSubmissions = useCallback(async () => {
    if (!id) return;
    const [a, qSubs, aQuestions, aQSubs] = await Promise.all([
      getAssignmentForLesson(id),
      getQuestionSubmissionsForLesson(id),
      getAssignmentQuestionsForLesson(id),
      getAssignmentQuestionSubmissionsForLesson(id),
    ]);
    setAssignment(a);
    setAssignmentQuestions(aQuestions);
    const map = new Map<string, QuestionSubmission>();
    for (const s of qSubs) map.set(s.questionId, s);
    setQuestionSubs(map);
    const aMap = new Map<string, QuestionSubmission>();
    for (const s of aQSubs) aMap.set(s.questionId, s);
    setAssignmentQuestionSubs(aMap);
  }, [id, getAssignmentForLesson, getQuestionSubmissionsForLesson, getAssignmentQuestionsForLesson, getAssignmentQuestionSubmissionsForLesson]);

  useEffect(() => { loadSubmissions(); }, [loadSubmissions]);

  // Live-update the badge if an evaluator resolves this lesson's evaluation
  // while the learner still has the lesson open — same realtime pattern used
  // for chat messages, so they see "Approved"/"Needs revision" without having
  // to back out and reopen the lesson.
  useEffect(() => {
    if (!id || !user) return;
    const channel = supabase
      .channel(`p2p_lesson_evaluations_${id}_${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "p2p_lesson_evaluations", filter: `lesson_id=eq.${id}` },
        (payload) => {
          const row = payload.new as { submitter_id?: string };
          if (row.submitter_id === user.id) loadSubmissions();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, user, loadSubmissions]);

  async function handleComplete() {
    if (!id || completing) return;
    setCompleting(true);
    try { await markLessonComplete(id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    finally { setCompleting(false); }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerLabel}>{t("lesson.title")}</Text>
        {completed && (
          <View style={styles.completedTag}>
            <Ionicons name="checkmark" size={12} color={colors.cream} />
            <Text style={styles.completedTagText}>{t("lesson.done")}</Text>
          </View>
        )}
      </View>

      {isLoading || !content ? (
        <View style={styles.loadingContainer}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          <Text style={styles.lessonTitle}>{content.title}</Text>

          {content.scriptures.map((s) => {
            const fetched = verseTexts.get(s.id);
            const displayText = fetched?.text ?? s.verse;
            const translationCode = fetched?.translationCode;
            return (
              <View key={s.id} style={styles.verseCard}>
                <Text style={styles.verseText}>"{displayText}"</Text>
                <Text style={styles.verseRef}>
                  — {s.reference}
                  {translationCode ? ` (${translationCode})` : ""}
                </Text>
              </View>
            );
          })}

          {content.sections.map((section) => (
            <View key={section.id}>
              {section.title ? <Text style={styles.sectionHeading}>{section.title}</Text> : null}
              {section.content.split("\n\n").map((para, idx) => (
                <HighlightableParagraph
                  key={idx}
                  sectionId={section.id}
                  lessonId={id ?? ""}
                  content={para}
                  highlights={highlights}
                  onToggle={handleToggleHighlight}
                  onLongPressExisting={(h) => setEditingHighlight(h)}
                />
              ))}
            </View>
          ))}

          {content.questions.length > 0 && (
            <View style={styles.questionsCard}>
              <View style={styles.questionsHeader}>
                <Ionicons name="people" size={16} color={colors.accentGreen} />
                <Text style={styles.questionsTitle}>{t("lesson.discussionQuestions")}</Text>
              </View>
              {content.questions.map((q, idx) => (
                <QuestionResponseCard
                  key={q.id}
                  question={q}
                  questionIndex={idx}
                  lessonId={id ?? ""}
                  existingSub={questionSubs.get(q.id)}
                />
              ))}
            </View>
          )}

          {assignment && assignmentQuestions.length > 0 && (
            <View style={styles.questionsCard}>
              <View style={styles.questionsHeader}>
                <Ionicons name="create" size={16} color={colors.accentGreen} />
                <Text style={styles.questionsTitle}>{assignment.title}</Text>
              </View>
              {assignmentQuestions.map((q, idx) => (
                <QuestionResponseCard
                  key={q.id}
                  question={q}
                  questionIndex={idx}
                  lessonId={id ?? ""}
                  existingSub={assignmentQuestionSubs.get(q.id)}
                  kind="assignment"
                  assignmentId={assignment.id}
                  onSubmitted={loadSubmissions}
                />
              ))}
            </View>
          )}

          {(!assignment || assignmentQuestions.length === 0) && (
            !completed ? (
              <TouchableOpacity
                style={[styles.completeBtn, completing && styles.completeBtnDisabled]}
                onPress={handleComplete}
                activeOpacity={0.85}
                disabled={completing}
              >
                {completing ? <ActivityIndicator color={colors.cream} /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color={colors.cream} />
                    <Text style={styles.completeBtnText}>{t("lesson.markComplete")}</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.completedBanner}>
                <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />
                <Text style={styles.completedBannerText}>{t("lesson.lessonCompleted")}</Text>
              </View>
            )
          )}

          {content.attribution ? (
            <View style={styles.attributionBlock}>
              <View style={styles.attributionRule} />
              <Text style={styles.attributionText}>{content.attribution}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      <Modal
        visible={!!pendingHighlight || !!editingHighlight}
        transparent
        animationType="fade"
        onRequestClose={() => { setPendingHighlight(null); setEditingHighlight(null); }}
      >
        <TouchableOpacity
          style={styles.colorPickerOverlay}
          activeOpacity={1}
          onPress={() => { setPendingHighlight(null); setEditingHighlight(null); }}
        >
          <View style={styles.colorPickerCard}>
            <Text style={styles.colorPickerTitle}>
              {editingHighlight ? "Change highlight color" : "Choose highlight color"}
            </Text>
            <View style={styles.colorSwatchRow}>
              {HIGHLIGHT_COLORS.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: c.swatch },
                    (editingHighlight?.color ?? "yellow") === c.key && styles.colorSwatchSelected,
                  ]}
                  onPress={() => handleChooseColor(c.key)}
                />
              ))}
            </View>
            {editingHighlight && (
              <TouchableOpacity style={styles.removeHighlightBtn} onPress={handleRemoveHighlight}>
                <Ionicons name="trash-outline" size={16} color="#B91C1C" />
                <Text style={styles.removeHighlightBtnText}>Remove highlight</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.borderBeige,
  },
  backBtn: { padding: 4 },
  headerLabel: { flex: 1, fontSize: 16, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
  completedTag: {
    flexDirection: "row", gap: 4, alignItems: "center",
    backgroundColor: c.accentGreen, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  completedTagText: { color: c.cream, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  lessonTitle: { fontSize: 24, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 20 },
  verseCard: {
    backgroundColor: c.cardBeige, borderRadius: 16, borderWidth: 1, borderColor: c.warmBeige,
    padding: 16, marginBottom: 24, borderLeftWidth: 4, borderLeftColor: c.amber,
  },
  verseText: { fontSize: 16, fontStyle: "italic", color: c.textDark, lineHeight: 26, fontFamily: "Inter_400Regular", marginBottom: 8 },
  verseRef: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium" },
  sectionHeading: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 8, marginTop: 4 },
  bodyPara: { fontSize: 15, color: c.textDark, lineHeight: 26, fontFamily: "Inter_400Regular", marginBottom: 16 },
  sentenceHighlighted: { backgroundColor: "rgba(250,204,21,0.45)" },
  colorPickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  colorPickerCard: {
    backgroundColor: c.lightCream, borderRadius: 20, padding: 20,
    width: "82%", alignItems: "center",
  },
  colorPickerTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 16 },
  colorSwatchRow: { flexDirection: "row", gap: 14, marginBottom: 6 },
  colorSwatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: "transparent" },
  colorSwatchSelected: { borderColor: c.textDark },
  removeHighlightBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18 },
  removeHighlightBtnText: { fontSize: 13, color: "#B91C1C", fontFamily: "Inter_500Medium" },
  questionsCard: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
    padding: 16, marginBottom: 28, marginTop: 8,
  },
  questionsHeader: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 16 },
  questionsTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
  completeBtn: {
    backgroundColor: c.primaryGreen, borderRadius: 14, height: 54,
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
  },
  completeBtnDisabled: { opacity: 0.7 },
  completeBtnText: { color: c.cream, fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  completedBanner: {
    backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 14, borderWidth: 1,
    borderColor: "rgba(29,158,117,0.3)", height: 54,
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
  },
  completedBannerText: { color: c.accentGreen, fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  assignmentCard: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
    padding: 16, marginBottom: 20,
  },
  assignmentInstructions: { fontSize: 14, color: c.textMid, lineHeight: 22, fontFamily: "Inter_400Regular", marginBottom: 14 },
  assignmentInput: {
    borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
    padding: 12, minHeight: 100, textAlignVertical: "top",
    fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular",
    marginBottom: 12, backgroundColor: c.lightCream,
  },
  submitError: { fontSize: 12, color: "#C0392B", marginBottom: 10, fontFamily: "Inter_400Regular" },
  attributionBlock: { marginTop: 36, marginBottom: 8 },
  attributionRule: { height: 1, backgroundColor: c.borderBeige, marginBottom: 20 },
  attributionText: {
    fontSize: 12, color: c.textMuted, lineHeight: 20, fontFamily: "Inter_400Regular",
    fontStyle: "italic", textAlign: "center", paddingHorizontal: 8,
  },
  });
}