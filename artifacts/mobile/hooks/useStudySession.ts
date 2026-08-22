import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Kingdom School "Study Together" — shared session state for an already-
// active 1:1 call. Follows call/group.tsx's proven pattern exactly: a
// Supabase Realtime *Broadcast* channel (not postgres_changes — this is
// ephemeral, never touches the DB, no publication changes needed) scoped to
// the call's own Agora channelName, carrying typed signals every connected
// client reacts to locally. The actual session record is a direct client
// insert into p2p_sessions (RLS already permits either participant to create
// it: auth.uid() = mentor_id OR participant_id) — no new endpoint needed for
// that part. Lesson content itself is never duplicated: same
// p2p_lesson_sections/p2p_scriptures/p2p_reflection_questions queries
// lesson/[id].tsx already runs.

export interface StudyLessonMeta {
  id: string;
  moduleId: string;
  title: string;
}

export interface StudySection { id: string; title: string; content: string }
export interface StudyScripture { id: string; reference: string; verse: string }
export interface StudyQuestion { id: string; question: string }
export interface StudyLessonData {
  title: string;
  sections: StudySection[];
  scriptures: StudyScripture[];
  questions: StudyQuestion[];
}

export interface SharedScripture { reference: string; verse: string }

export interface StudyProgressSide { status: string; completed: boolean }
export interface StudyProgress { mine: StudyProgressSide; theirs: StudyProgressSide }

export interface StudySessionSummary {
  durationSeconds: number;
  lessonTitle: string;
  questionsDiscussedCount: number;
  scripturesDiscussed: SharedScripture[];
}

type StudySignalType =
  | "study_start"
  | "section_change"
  | "discuss_question"
  | "scripture_share"
  | "pass_lead"
  | "study_end";

interface StudySignal {
  type: StudySignalType;
  from: string;
  data?: any;
}

export function useStudySession(channelName: string, otherUserId: string) {
  const { profile } = useAuth();
  const myId = profile?.id ?? "";

  const [isActive, setIsActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lesson, setLesson] = useState<StudyLessonMeta | null>(null);
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [groupSectionIndex, setGroupSectionIndex] = useState(0);
  const [localSectionIndex, setLocalSectionIndex] = useState(0);
  const [isFollowing, setIsFollowing] = useState(true);
  const [discussingQuestionId, setDiscussingQuestionId] = useState<string | null>(null);
  const [sharedScripture, setSharedScripture] = useState<SharedScripture | null>(null);
  const [scripturesDiscussed, setScripturesDiscussed] = useState<SharedScripture[]>([]);
  const startedAtRef = useRef<number | null>(null);

  const isLeader = !!myId && leaderId === myId;
  const currentSectionIndex = isFollowing ? groupSectionIndex : localSectionIndex;

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const sendSignal = useCallback((type: StudySignalType, data?: any) => {
    channelRef.current?.send({ type: "broadcast", event: "signal", payload: { type, from: myId, data } as StudySignal });
  }, [myId]);

  useEffect(() => {
    if (!channelName || !myId) return;
    const channel = supabase.channel(`study_${channelName}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "signal" }, ({ payload }: { payload: StudySignal }) => {
      switch (payload.type) {
        case "study_start":
          setSessionId(payload.data?.sessionId ?? null);
          setLesson(payload.data?.lesson ?? null);
          setLeaderId(payload.data?.leaderId ?? payload.from);
          setGroupSectionIndex(0);
          setIsFollowing(true);
          setScripturesDiscussed([]);
          setSharedScripture(null);
          setDiscussingQuestionId(null);
          startedAtRef.current = Date.now();
          setIsActive(true);
          break;
        case "section_change":
          setGroupSectionIndex(payload.data?.index ?? 0);
          break;
        case "discuss_question":
          setDiscussingQuestionId(payload.data?.questionId ?? null);
          break;
        case "scripture_share": {
          const s: SharedScripture = { reference: payload.data?.reference, verse: payload.data?.verse };
          setSharedScripture(s);
          setScripturesDiscussed((prev) => (prev.some((p) => p.reference === s.reference) ? prev : [...prev, s]));
          break;
        }
        case "pass_lead":
          setLeaderId(payload.data?.newLeaderId ?? null);
          break;
        case "study_end":
          setIsActive(false);
          break;
      }
    }).subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [channelName, myId]);

  const startStudy = useCallback(async (lessonMeta: StudyLessonMeta) => {
    if (!myId || !otherUserId) return;
    const { data, error } = await supabase
      .from("p2p_sessions")
      .insert({
        mentor_id: myId, participant_id: otherUserId,
        lesson_id: lessonMeta.id, module_id: lessonMeta.moduleId, title: lessonMeta.title,
        session_type: "study_together", status: "in_progress", started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) return;
    setSessionId(data.id as string);
    setLesson(lessonMeta);
    setLeaderId(myId);
    setGroupSectionIndex(0);
    setIsFollowing(true);
    setScripturesDiscussed([]);
    startedAtRef.current = Date.now();
    setIsActive(true);
    sendSignal("study_start", { sessionId: data.id, lesson: lessonMeta, leaderId: myId });
  }, [myId, otherUserId, sendSignal]);

  const changeSection = useCallback((index: number) => {
    setGroupSectionIndex(index);
    sendSignal("section_change", { index });
  }, [sendSignal]);

  const exploreIndependently = useCallback(() => {
    setLocalSectionIndex(groupSectionIndex);
    setIsFollowing(false);
  }, [groupSectionIndex]);

  const returnToGroup = useCallback(() => {
    setIsFollowing(true);
  }, []);

  const discussQuestion = useCallback((questionId: string) => {
    setDiscussingQuestionId(questionId);
    sendSignal("discuss_question", { questionId });
  }, [sendSignal]);

  const shareScripture = useCallback((reference: string, verse: string) => {
    const s: SharedScripture = { reference, verse };
    setSharedScripture(s);
    setScripturesDiscussed((prev) => (prev.some((p) => p.reference === reference) ? prev : [...prev, s]));
    sendSignal("scripture_share", { reference, verse });
  }, [sendSignal]);

  const passLead = useCallback((newLeaderId: string) => {
    setLeaderId(newLeaderId);
    sendSignal("pass_lead", { newLeaderId });
  }, [sendSignal]);

  const endStudy = useCallback(async (): Promise<StudySessionSummary | null> => {
    const durationSeconds = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0;
    const summary: StudySessionSummary = {
      durationSeconds,
      lessonTitle: lesson?.title ?? "",
      questionsDiscussedCount: discussingQuestionId ? 1 : 0,
      scripturesDiscussed,
    };
    if (sessionId) {
      await supabase.from("p2p_sessions").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", sessionId);
      void supabase.from("p2p_user_activity_events").insert({
        user_id: myId, event_type: "session_held", metadata: { session_id: sessionId, peer_id: otherUserId },
      });
    }
    sendSignal("study_end");
    setIsActive(false);
    setSessionId(null);
    setLesson(null);
    setLeaderId(null);
    return summary;
  }, [sessionId, lesson, discussingQuestionId, scripturesDiscussed, myId, otherUserId, sendSignal]);

  const getSharedLessonData = useCallback(async (lessonId: string): Promise<StudyLessonData> => {
    const [{ data: lessonRow }, { data: sections }, { data: scriptures }, { data: questions }] = await Promise.all([
      supabase.from("p2p_lessons").select("id,title").eq("id", lessonId).maybeSingle(),
      supabase.from("p2p_lesson_sections").select("id,title,content,section_order").eq("lesson_id", lessonId).order("section_order", { ascending: true }),
      supabase.from("p2p_scriptures").select("id,reference,verse,display_order").eq("lesson_id", lessonId).order("display_order", { ascending: true }),
      supabase.from("p2p_reflection_questions").select("id,question,display_order").eq("lesson_id", lessonId).order("display_order", { ascending: true }),
    ]);
    return {
      title: (lessonRow?.title as string) ?? "Lesson",
      sections: ((sections ?? []) as Record<string, unknown>[]).map((s) => ({ id: s.id as string, title: (s.title as string) ?? "", content: (s.content as string) ?? "" })),
      scriptures: ((scriptures ?? []) as Record<string, unknown>[]).map((s) => ({ id: s.id as string, reference: s.reference as string, verse: s.verse as string })),
      questions: ((questions ?? []) as Record<string, unknown>[]).map((q) => ({ id: q.id as string, question: q.question as string })),
    };
  }, []);

  const getStudyProgress = useCallback(async (lessonId: string): Promise<StudyProgress> => {
    const empty: StudyProgress = { mine: { status: "not_started", completed: false }, theirs: { status: "not_started", completed: false } };
    if (!myId || !otherUserId) return empty;
    try {
      const params = new URLSearchParams({ requesterId: myId, otherUserId, lessonId });
      const res = await fetch(`${getApiUrl()}/calls/study-progress?${params.toString()}`);
      if (!res.ok) return empty;
      return await res.json();
    } catch {
      return empty;
    }
  }, [myId, otherUserId]);

  return {
    isActive, sessionId, lesson, leaderId, isLeader,
    currentSectionIndex, isFollowing, discussingQuestionId, sharedScripture, scripturesDiscussed,
    startStudy, changeSection, exploreIndependently, returnToGroup,
    discussQuestion, shareScripture, passLead, endStudy,
    getSharedLessonData, getStudyProgress,
  };
}