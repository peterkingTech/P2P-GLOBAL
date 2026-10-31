import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
  Linking,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { useDraft, draftKey } from "@/lib/drafts";
import {
  useData,
  Assignment,
  QuestionSubmission,
  SubmissionType,
  UserHighlight,
} from "@/contexts/DataContext";
import { AttachmentTray, AttachmentList, clearTray } from "@/components/handwriting/AttachmentTray";
import AudioRecorder from "@/components/AudioRecorder";
import VideoRecorder from "@/components/VideoRecorder";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";
import { useTranslation } from "react-i18next";
import { fetchBatchVerseText, VerseResult } from "@/lib/bibleClient";
import { getApiUrl } from "@/lib/apiUrl";
import { getLanguageName } from "@/lib/languageNames";
import { shareLesson } from "@/lib/sharing";
import { useLayout, centeredMaxWidth } from "@/hooks/useLayout";
import { startPeerCall, buildCallRouteParams } from "@/lib/callStart";
import { StudyPartnerPicker } from "@/components/study/StudyPartnerPicker";
import SharedStudySheet from "@/components/study/SharedStudySheet";
import ReadableText from "@/components/ReadableText";
import GatheringReturnBar from "@/components/family/GatheringReturnBar";
import { useActiveGathering } from "@/lib/activeGathering";
import { bibleRoute, readerTarget } from "@/lib/bibleReaderApi";
import ListenPlayer, { ListenButton } from "@/components/listen/ListenPlayer";
import { listen, spokenLabels, useListenOwner, useListenState } from "@/lib/listen";
import { lessonListenSections } from "@/lib/listen/lessonContent";
import { checkTitle } from "@/lib/terminology";
import { useStudyTimeTracker } from "@/lib/studyTime";
import { AppButton } from "@/components/ui";
import { showAlert } from "@/lib/alerts";

interface LessonContent {
  title: string;
  sections: { id: string; title: string; content: string }[];
  scriptures: { id: string; reference: string; verse: string }[];
  questions: { id: string; question: string }[];
  attribution?: string;
  /** Language the shown text is in: "en" until a translation replaces it. */
  language?: string;
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
        <TouchableOpacity accessibilityRole="button"
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
// Exported so Study Together's Questions tab can reuse the exact same
// submission UI/logic (submitContent()) rather than re-implementing it.
export function QuestionResponseCard({
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
  const { profile } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const qStyles = makeQStyles(colors);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<SubmissionType>("text");
  // The written answer is a persisted draft (lib/drafts): it survives leaving
  // the lesson, the focus view, backgrounding and app restarts; cleared on submit.
  const draft = useDraft(profile?.id ? draftKey(profile.id, `lesson:${lessonId}:${kind}:${question.id}`) : null);
  const text = draft.text;
  const setText = draft.setText;
  // Full-screen writing view. The text lives in `draft`, so opening/closing
  // the view never loses a word.
  const [focusWriting, setFocusWriting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<QuestionSubmission | null>(existingSub ?? null);
  const [error, setError] = useState<string | null>(null);
  // Comprehensive Check answers can carry drawings / photos / PDFs (optional; never reflections).
  const trayKey = `lesson:${lessonId}:${question.id}`;
  const [files, setFiles] = useState<{ ids: string[]; busy: boolean; count: number }>({ ids: [], busy: false, count: 0 });
  const [trayReset, setTrayReset] = useState(0);
  const canSend = (!!text.trim() || (kind === "assignment" && files.ids.length > 0)) && !files.busy;

  // existingSub is refetched (with real evaluation status) after every submit
  // and can also change from a live realtime update — keep local state in sync
  // rather than only reading it once at mount.
  useEffect(() => {
    setSubmitted(existingSub ?? null);
  }, [existingSub]);

  // A saved draft re-opens the composer so the writer sees it right away.
  useEffect(() => {
    if (draft.restored && !submitted) { setExpanded(true); setMode("text"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.restored]);

  async function handleTextSubmit() {
    if (!canSend || submitting) return;
    setSubmitting(true);
    setError(null);
    const err = await submitContent({
      lessonId,
      questionId: kind === "reflection" ? question.id : null,
      assignmentQuestionId: kind === "assignment" ? question.id : null,
      assignmentId: kind === "assignment" ? assignmentId : null,
      type: "text",
      text: text.trim(),
      attachmentIds: kind === "assignment" && files.ids.length ? files.ids : undefined,
    });
    setSubmitting(false);
    if (err) { setError(err); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitted({ id: Date.now().toString(), questionId: question.id, submissionType: "text", textContent: text.trim(), mediaUrl: null, durationSeconds: null, createdAt: new Date().toISOString(), evaluationStatus: "pending" });
    setExpanded(false);
    setFocusWriting(false);
    await draft.clear();
    if (kind === "assignment" && files.count && profile?.id) { await clearTray(profile.id, trayKey); setTrayReset((n) => n + 1); }
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

  const focusModal = (
    <Modal visible={focusWriting} animationType="slide" onRequestClose={() => setFocusWriting(false)} presentationStyle="fullScreen">
      <View style={[qStyles.focusScreen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={qStyles.focusBar}>
          <Text style={qStyles.focusTitle} numberOfLines={1}>Question {questionIndex + 1}</Text>
          <AppButton label="Done" onPress={() => setFocusWriting(false)} variant="tertiary" icon="contract-outline" accessibilityLabel="Done, return to the lesson" style={{ minWidth: 44 }} />
        </View>
        <Text style={qStyles.focusQuestion}>{question.question}</Text>
        <TextInput
          style={qStyles.focusInput}
          multiline
          autoFocus
          textAlignVertical="top"
          placeholder={t("lesson.writeReflection")}
          placeholderTextColor={colors.textMuted}
          value={text}
          onChangeText={setText}
          accessibilityLabel={`Your answer to question ${questionIndex + 1}`}
        />
        <Text style={qStyles.draftNote}>{text.trim() ? "Draft saved — it continues on your other devices" : "Your writing is saved as you type"}</Text>
      </View>
    </Modal>
  );

  return (
    <View style={qStyles.wrapper}>
      {focusModal}
      <View style={qStyles.questionRow}>
        <View style={qStyles.questionNum}>
          <Text style={qStyles.questionNumText}>{questionIndex + 1}</Text>
        </View>
        <Text style={qStyles.questionText}>{question.question}</Text>
      </View>

      {submitted ? (
        <>
          {kind === "assignment" && submitted.evaluationStatus === "needs_revision" ? (
            <TouchableOpacity accessibilityRole="button"
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
          {kind === "assignment" ? <View style={{ marginLeft: 36 }}><AttachmentList kind="core_submission" submissionId={submitted.id} compact /></View> : null}
          {kind === "assignment" && submitted.evaluationStatus === "needs_revision" && submitted.feedback ? (
            <View style={qStyles.revisionBanner}>
              <Ionicons name="chatbox-ellipses-outline" size={14} color="#C0392B" />
              <Text style={qStyles.revisionBannerText}>{submitted.feedback}</Text>
            </View>
          ) : null}
        </>
      ) : (
        <TouchableOpacity accessibilityRole="button"
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
              <View style={qStyles.draftRow}>
                <Text style={qStyles.draftNote} accessibilityLiveRegion="polite">{text.trim() ? "Draft saved — it continues on your other devices" : " "}</Text>
                <AppButton label="Expand" onPress={() => setFocusWriting(true)} variant="tertiary" icon="expand-outline" accessibilityLabel="Expand writing to full screen" />
              </View>
              {kind === "assignment" ? <AttachmentTray key={trayReset} trayKey={trayKey} disabled={submitting} onChange={setFiles} /> : null}
              {error && <Text style={qStyles.error}>{error}</Text>}
              <AppButton label={t("lesson.shareResponse")} onPress={handleTextSubmit} icon="send" disabled={!canSend || submitting} loading={submitting} />
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
  draftRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  draftNote: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular" },
  focusScreen: { flex: 1, backgroundColor: c.lightCream, paddingHorizontal: 18 },
  focusBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  focusTitle: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
  focusDone: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, minWidth: 44, paddingHorizontal: 10, justifyContent: "center" },
  focusQuestion: { fontSize: 17, lineHeight: 25, color: c.textDark, fontFamily: "Inter_600SemiBold", marginTop: 6, marginBottom: 12 },
  focusInput: {
    flex: 1, fontSize: 17, lineHeight: 26, color: c.textDark, fontFamily: "Inter_400Regular",
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 8,
  },
  textInput: {
    borderWidth: 1, borderColor: c.borderBeige, borderRadius: 12,
    padding: 10, minHeight: 80, textAlignVertical: "top",
    fontSize: 14, color: c.textDark, fontFamily: "Inter_400Regular",
    marginBottom: 10, backgroundColor: c.lightCream,
  },
  error: { fontSize: 12, color: "#C0392B", marginBottom: 8, fontFamily: "Inter_400Regular" },
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
  // Opened from a live Family Gathering: its call keeps running underneath.
  // A second (1:1 "Study Together") call must not start on top of it.
  const activeGathering = useActiveGathering();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { readingMaxWidth } = useLayout();
  const { user, profile: authProfile } = useAuth();
  // A Kingdom Stories chapter is a lesson of the hidden "kingdom_story"
  // curriculum (migration 212): opened from anywhere generic (e.g. My
  // Submissions), it is read in the storybook, not on this screen.
  useEffect(() => {
    if (!id) return;
    let live = true;
    (async () => {
      const { data: l } = await supabase.from("p2p_lessons").select("module_id").eq("id", id).maybeSingle();
      if (!l?.module_id || !live) return;
      const { data: m } = await supabase.from("p2p_modules").select("curriculum_id").eq("id", l.module_id).maybeSingle();
      if (!m?.curriculum_id || !live) return;
      const { data: cur } = await supabase.from("p2p_curriculums").select("type").eq("id", m.curriculum_id).maybeSingle();
      if (cur?.type !== "kingdom_story" || !live) return;
      const { data: st } = await supabase.from("p2p_kingdom_stories").select("id").eq("module_id", l.module_id).maybeSingle();
      if (st?.id && live) router.replace({ pathname: "/kingdom-stories/chapter", params: { id: st.id, lesson: id } } as any);
    })().catch(() => {});
    return () => { live = false; };
  }, [id, router]);
  // Daily study goal: count time while this lesson is focused and on screen.
  const [lessonFocused, setLessonFocused] = useState(false);
  useFocusEffect(useCallback(() => { setLessonFocused(true); return () => setLessonFocused(false); }, []));
  useStudyTimeTracker(user?.id, lessonFocused);
  const {
    lessons, markLessonComplete,
    getAssignmentForLesson, getQuestionSubmissionsForLesson,
    getAssignmentQuestionsForLesson, getAssignmentQuestionSubmissionsForLesson,
    getHighlightsForLesson, addSectionHighlight, deleteHighlight,
    getKingdomSchoolLockState,
  } = useData();
  const contentLanguage = authProfile?.contentLanguage ?? "en";

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
  // Shown only while an on-demand translation is actively being generated
  // (not for a cache hit, which swaps in before this would ever appear —
  // see the delay in the translation-fetch effect below).
  const [translationBanner, setTranslationBanner] = useState<string | null>(null);
  const translationFetchedFor = useRef<string | null>(null);

  const [pendingHighlight, setPendingHighlight] = useState<
    { sectionId: string; lessonId: string; text: string; start: number; end: number } | null
  >(null);
  const [editingHighlight, setEditingHighlight] = useState<UserHighlight | null>(null);

  // Study Together — Kingdom School entry point (discoverability slice).
  // Picker only resolves WHO; the current lesson (lessonMeta below) is
  // preserved and passed through unchanged, never re-chosen.
  const [studyPickerOpen, setStudyPickerOpen] = useState(false);
  const [sharedStudyOpen, setSharedStudyOpen] = useState(false);
  const [startingStudyWith, setStartingStudyWith] = useState<string | null>(null);

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

  // Kingdom School's sequential progression must hold even when this screen
  // is reached directly (typed URL, deep link, stale bookmark, or simply
  // because this lesson doesn't happen to be in the global "active
  // curriculum" state lessonMeta above reads from) — not just when reached
  // by tapping through an already-locked module list. This is the same
  // cross-curriculum lock computation every Kingdom School screen uses (see
  // getKingdomSchoolLockState), checked independently here so there is no
  // path into a locked lesson's content or submission UI.
  const [lockChecked, setLockChecked] = useState(false);
  const [isLessonLocked, setIsLessonLocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      const state = await getKingdomSchoolLockState(user?.id);
      if (!cancelled) {
        setIsLessonLocked(state.lessonLocked.get(id) ?? false);
        setLockChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [id, user?.id, getKingdomSchoolLockState]);

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
          const mod = lesson?.p2p_modules as unknown as Record<string, unknown> | null;
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

  // On-demand lesson translation, permanently cached server-side. English is
  // already showing (loaded above) by the time this runs, so failure or a
  // slow AI call never blocks reading the lesson — this only ever upgrades
  // the display in place.
  useEffect(() => {
    if (!id || !contentLanguage || contentLanguage === "en") {
      setTranslationBanner(null);
      return;
    }
    const fetchKey = `${id}:${contentLanguage}`;
    if (translationFetchedFor.current === fetchKey) return;
    translationFetchedFor.current = fetchKey;

    let cancelled = false;
    // A cache hit typically resolves fast enough that this never fires —
    // the banner is only for the slower "generating for the first time" path.
    const bannerTimer = setTimeout(() => {
      if (!cancelled) setTranslationBanner(`Preparing this lesson in ${getLanguageName(contentLanguage)}...`);
    }, 500);

    (async () => {
      try {
        const apiUrl = getApiUrl();
        const res = await fetch(`${apiUrl}/lessons/${id}?language=${contentLanguage}`);
        const data = await res.json();
        if (cancelled || !data?.translation_available) return;
        setContent((prev) => prev ? {
          ...prev,
          title: (data.title as string) ?? prev.title,
          sections: ((data.sections ?? []) as Record<string, unknown>[]).map((s) => ({
            id: s.id as string, title: (s.title as string) ?? "", content: (s.content as string) ?? "",
          })),
          questions: ((data.questions ?? []) as Record<string, unknown>[]).map((q) => ({
            id: q.id as string, question: q.question as string,
          })),
          language: contentLanguage,
        } : prev);
      } catch {
        // Network-level failure — silently keep showing English, no error surfaced.
      } finally {
        clearTimeout(bannerTimer);
        if (!cancelled) setTranslationBanner(null);
      }
    })();

    return () => { cancelled = true; clearTimeout(bannerTimer); };
  }, [id, contentLanguage]);

  // Listen: the shared player reads the lesson as shown (lib/listen/lessonContent),
  // in the language the text is actually showing in — including the discussion
  // and Comprehensive Check QUESTIONS, never anyone's answers. Listening never
  // completes the lesson: that still takes the normal answers and submissions.
  useListenOwner("lesson");
  const listenState = useListenState();
  const textLanguage = content?.language ?? "en";
  const listenSections = useMemo(() => content ? lessonListenSections({
    title: content.title,
    // A verse is read in full only when its shown wording is in the lesson's language.
    scriptures: content.scriptures.map((s) => {
      const fetched = verseTexts.get(s.id)?.text;
      const text = textLanguage === "en" ? s.verse : fetched ?? null;
      return { id: s.id, reference: s.reference, text };
    }),
    sections: content.sections,
    // Announced as on screen ("Personal Reflections", "Comprehensive Check",
    // "Question 1") in the text's language; a check's own English title only for English text.
    questionGroups: [
      { id: "discussion", kind: "reflections", title: t("lesson.discussionQuestions"), questions: content.questions },
      ...(assignment ? [{ id: "check", kind: "check" as const, title: checkTitle(assignment.title), name: textLanguage === "en" ? checkTitle(assignment.title) : null, questions: assignmentQuestions }] : []),
    ],
  }, spokenLabels(textLanguage)) : [], [content, verseTexts, textLanguage, assignment, assignmentQuestions, t]);
  const listenKey = `lesson:${id}:${textLanguage}`;
  const listeningHere = listenState.content?.key === listenKey && listenState.status !== "idle";
  const onListen = () => {
    if (!content || !listenSections.length) return;
    if (listeningHere) return listen.present();
    const hasReflections = content.questions.some((q) => q.question?.trim());
    const hasCheck = !!assignment && assignmentQuestions.length > 0;
    void listen.play({
      key: listenKey, owner: "lesson", kind: "lesson", highlight: "sentence", title: content.title, subtitle: "Lesson", language: textLanguage, sections: listenSections,
      // The lesson's next step on this screen, chosen by the learner — never skipped, never automatic.
      completionActions: [
        ...(hasReflections ? [{ label: "Continue to Personal Reflections", icon: "create-outline", open: () => scrollToLessonPart("reflections") }] : []),
        ...(hasCheck ? [{ label: "Continue to Comprehensive Check", icon: "clipboard-outline", open: () => scrollToLessonPart("check") }] : []),
        ...(!hasReflections && !hasCheck ? [{ label: "Return to the lesson", icon: "book-outline", open: () => {} }] : []),
      ],
    }, "saved");
  };
  // Where Personal Reflections / the Comprehensive Check sit, for "Continue to …" after listening.
  const lessonScrollRef = useRef<ScrollView>(null);
  const lessonPartY = useRef<{ reflections?: number; check?: number }>({});
  const scrollToLessonPart = (key: "reflections" | "check") => {
    const y = lessonPartY.current[key];
    if (y != null) setTimeout(() => lessonScrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }), 350);
  };

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

  async function handleSelectStudyPartner(person: { id: string; name: string }) {
    if (!user?.id || !lessonMeta) return;
    setStudyPickerOpen(false);
    setStartingStudyWith(person.id);
    try {
      const result = await startPeerCall({
        supabase, currentUserId: user.id, otherUserId: person.id,
        onAlert: showAlert,
      });
      if (!result) return;
      router.push({
        pathname: "/call/audio",
        params: buildCallRouteParams({
          channelName: result.channelName, otherUserId: person.id, otherUserName: person.name,
          callId: result.incomingCallId, conversationId: result.conversationId, callLogId: result.callLogId,
          autoStudy: { lessonId: lessonMeta.id, moduleId: lessonMeta.moduleId, lessonTitle: lessonMeta.title },
        }),
      } as any);
    } finally {
      setStartingStudyWith(null);
    }
  }

  if (lockChecked && isLessonLocked) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <GatheringReturnBar />
        <View style={styles.header}>
          <TouchableOpacity accessibilityLabel="Back" accessibilityRole="button" hitSlop={10} onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textDark} />
          </TouchableOpacity>
          <Text style={styles.headerLabel}>{t("lesson.title")}</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Ionicons name="lock-closed" size={40} color={colors.textMuted} />
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" }}>
            This lesson is locked
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" }}>
            {t("module.finishPrevious")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <GatheringReturnBar />
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Back" accessibilityRole="button" hitSlop={10} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerLabel}>{t("lesson.title")}</Text>
        {completed && (
          <View style={styles.completedTag}>
            <Ionicons name="checkmark" size={12} color={colors.cream} />
            <Text style={styles.completedTagText}>{t("lesson.done")}</Text>
          </View>
        )}
        {content && (
          <TouchableOpacity accessibilityLabel="Share" accessibilityRole="button"
            onPress={() => id && shareLesson({ id, title: content.title }, authProfile?.username)}
            style={styles.shareBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="share-outline" size={20} color={colors.textDark} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading || !content ? (
        <View style={styles.loadingContainer}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <ScrollView ref={lessonScrollRef}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 40 },
            centeredMaxWidth(readingMaxWidth),
          ]}
          showsVerticalScrollIndicator={false}
        >
          {translationBanner ? (
            <View style={styles.translationBanner}>
              <ActivityIndicator size="small" color={colors.accentGreen} />
              <Text style={styles.translationBannerText}>{translationBanner}</Text>
            </View>
          ) : null}

          <Text style={styles.lessonTitle}>{content.title}</Text>
          {listenSections.length > 0 && (
            <View style={{ alignItems: "flex-start", marginBottom: 12 }}>
              <ListenButton onPress={onListen} label={listeningHere ? "Open Read & Listen" : "Listen to this lesson"} />
            </View>
          )}

          {content.scriptures.map((s) => {
            const fetched = verseTexts.get(s.id);
            const displayText = fetched?.text ?? s.verse;
            const translationCode = fetched?.translationCode;
            return (
              <TouchableOpacity
                key={s.id}
                style={styles.verseCard}
                activeOpacity={0.8}
                onPress={() => {
                  if (user) {
                    void supabase.from("p2p_user_activity_events").insert({
                      user_id: user.id,
                      event_type: "scripture_opened",
                      metadata: { reference: s.reference, lesson_id: id },
                    });
                  }
                  // Open the passage in the P2P Bible (in context, with the
                  // reader's own notes/highlights); bible.com only when the
                  // reference can't be read as Book Chapter[:Verse].
                  const target = readerTarget(s.reference);
                  if (target) router.push(bibleRoute({ ...target, translation: translationCode }) as any);
                  else Linking.openURL(`https://www.bible.com/search/bible?query=${encodeURIComponent(s.reference)}`).catch(() => {});
                }}
                accessibilityRole="button"
                accessibilityLabel={`${s.reference}. Read in the Bible`}
              >
                <Text style={styles.verseText}>"{displayText}"</Text>
                <ReadableText style={styles.verseRef}>
                  — {s.reference}
                  {translationCode ? ` (${translationCode})` : ""}
                </ReadableText>
                {readerTarget(s.reference) ? <Text style={styles.verseOpen}>Read in Bible ›</Text> : null}
              </TouchableOpacity>
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
            <View style={styles.questionsCard} onLayout={(e) => { lessonPartY.current.reflections = e.nativeEvent.layout.y; }}>
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
            <View style={styles.questionsCard} onLayout={(e) => { lessonPartY.current.check = e.nativeEvent.layout.y; }}>
              <View style={styles.questionsHeader}>
                <Ionicons name="create" size={16} color={colors.accentGreen} />
                <Text style={styles.questionsTitle}>{checkTitle(assignment.title)}</Text>
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
              <AppButton label={t("lesson.markComplete")} onPress={handleComplete} size="lg" icon="checkmark-circle" disabled={completing} loading={completing} />
            ) : (
              <View style={styles.completedBanner}>
                <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />
                <Text style={styles.completedBannerText}>{t("lesson.lessonCompleted")}</Text>
              </View>
            )
          )}

          {lessonMeta && !activeGathering && (
            <TouchableOpacity accessibilityRole="button"
              style={styles.studyTogetherCard}
              onPress={() => setStudyPickerOpen(true)}
              disabled={!!startingStudyWith}
              activeOpacity={0.85}
            >
              {startingStudyWith ? <ActivityIndicator color={colors.cream} /> : (
                <>
                  <Text style={styles.studyTogetherEmoji}>📖</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.studyTogetherTitle}>Study Together</Text>
                    <Text style={styles.studyTogetherSub}>Learn this lesson with someone.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.cream} />
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Shared study at your own pace (no call needed) — same Study
              Together, asynchronous: a peer or a group you lead. */}
          {lessonMeta && !activeGathering && content?.title ? (
            <TouchableOpacity style={styles.sharedStudyLink} onPress={() => setSharedStudyOpen(true)} accessibilityRole="button"
              accessibilityLabel="Study together at your own pace" accessibilityHint="Invite a peer or start a study with a group you lead">
              <Ionicons name="people-outline" size={16} color={colors.accentGreen} />
              <Text style={styles.sharedStudyLinkText}>Or study it together at your own pace</Text>
            </TouchableOpacity>
          ) : null}

          {content.attribution ? (
            <View style={styles.attributionBlock}>
              <View style={styles.attributionRule} />
              <Text style={styles.attributionText}>{content.attribution}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
      <ListenPlayer owner="lesson" bottomInset={insets.bottom} />

      <StudyPartnerPicker
        visible={studyPickerOpen}
        onClose={() => setStudyPickerOpen(false)}
        onSelectPerson={handleSelectStudyPartner}
      />
      {id && content?.title ? (
        <SharedStudySheet visible={sharedStudyOpen} onClose={() => setSharedStudyOpen(false)} content={{ type: "lesson", id, title: content.title }}
          onStarted={(sid) => { setSharedStudyOpen(false); router.push(`/study-together/${sid}` as any); }} />
      ) : null}

      <Modal
        visible={!!pendingHighlight || !!editingHighlight}
        transparent
        animationType="fade"
        onRequestClose={() => { setPendingHighlight(null); setEditingHighlight(null); }}
      >
        <TouchableOpacity accessibilityRole="button"
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
              <AppButton label="Remove highlight" onPress={handleRemoveHighlight} variant="destructive" icon="trash-outline" style={{ marginTop: 18 }} />
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
  shareBtn: { padding: 4 },
  headerLabel: { flex: 1, fontSize: 16, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
  completedTag: {
    flexDirection: "row", gap: 4, alignItems: "center",
    backgroundColor: c.accentGreen, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  completedTagText: { color: c.cream, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  translationBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: c.cardBeige, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16,
  },
  translationBannerText: { fontSize: 12, color: c.textMid, fontFamily: "Inter_400Regular", flex: 1 },
  lessonTitle: { fontSize: 24, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 20 },
  verseCard: {
    backgroundColor: c.cardBeige, borderRadius: 16, borderWidth: 1, borderColor: c.warmBeige,
    padding: 16, marginBottom: 24, borderLeftWidth: 4, borderLeftColor: c.amber,
  },
  verseText: { fontSize: 16, fontStyle: "italic", color: c.textDark, lineHeight: 26, fontFamily: "Inter_400Regular", marginBottom: 8 },
  verseRef: { fontSize: 13, color: c.textMid, fontFamily: "Inter_500Medium" },
  verseOpen: { fontSize: 13, color: c.accentGreen, fontFamily: "Inter_600SemiBold", marginTop: 6 },
  sectionHeading: { fontSize: 16, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 8, marginTop: 4 },
  bodyPara: { fontSize: 15, color: c.textDark, lineHeight: 26, fontFamily: "Inter_400Regular", marginBottom: 16 },
  sentenceHighlighted: { backgroundColor: "rgba(250,204,21,0.45)" },
  colorPickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  colorPickerCard: {
    backgroundColor: c.lightCream, borderRadius: 20, padding: 20,
    width: "82%", alignItems: "center",
    maxWidth: 560,
  },
  colorPickerTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 16 },
  colorSwatchRow: { flexDirection: "row", gap: 14, marginBottom: 6 },
  colorSwatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: "transparent" },
  colorSwatchSelected: { borderColor: c.textDark },
  questionsCard: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
    padding: 16, marginBottom: 28, marginTop: 8,
  },
  questionsHeader: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 16 },
  questionsTitle: { fontSize: 15, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
  completedBanner: {
    backgroundColor: "rgba(29,158,117,0.1)", borderRadius: 14, borderWidth: 1,
    borderColor: "rgba(29,158,117,0.3)", height: 54,
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
  },
  completedBannerText: { color: c.accentGreen, fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  studyTogetherCard: {
    backgroundColor: c.primaryGreen, borderRadius: 14, padding: 16, marginTop: 16,
    flexDirection: "row", gap: 12, alignItems: "center",
  },
  studyTogetherEmoji: { fontSize: 22 },
  studyTogetherTitle: { color: c.cream, fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sharedStudyLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, marginTop: -4 },
  sharedStudyLinkText: { color: c.accentGreen, fontSize: 13, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
  studyTogetherSub: { color: c.cream, opacity: 0.85, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
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