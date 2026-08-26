import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import {
  startGroupStudy, joinGroupStudy, updateGroupStudySection, reportStudyParticipantDeparted, endGroupStudy,
  getCurrentGroupStudy, getGroupStudyProgress, removeStudyParticipant, CurrentGroupStudy, GroupStudyProgress,
} from "@/lib/groupStudy";

// Kingdom School "Study Together" — shared session state for an already-
// active call. Follows call/group.tsx's proven pattern exactly: a Supabase
// Realtime *Broadcast* channel (not postgres_changes — this is ephemeral,
// never touches the DB, no publication changes needed) scoped to the call's
// own Agora channelName, carrying typed signals every connected client
// reacts to locally. Lesson content itself is never duplicated: same
// p2p_lesson_sections/p2p_scriptures/p2p_reflection_questions queries
// lesson/[id].tsx already runs.
//
// Study Together C3 — Group Study Together. `otherParticipants` replaces
// the old singular `otherUserId` so this hook can drive 2-6 person study.
// Two structurally different persistence paths coexist deliberately:
//
//   isGroup === false (otherParticipants.length <= 1): the EXACT original
//   1:1 code path — a direct client insert/update into p2p_sessions, no
//   server round-trip, no new endpoint. This is untouched from before C3.
//
//   isGroup === true: the session record and its leader/shared-position
//   state live in p2p_study_sessions / p2p_study_session_participants
//   (migration 084) behind the C3 endpoints in calls.ts, because p2p_sessions
//   is a strict two-party table (mentor_id/participant_id) that cannot
//   represent a 3-6 person session, and because a mid-call joiner or a
//   reconnecting participant needs server-authoritative current state that
//   the broadcast channel alone (no history) cannot provide.
//
// Every write in the group path is authorized server-side by the caller's
// real Supabase identity (see verifyCaller in calls.ts) — this hook never
// asks the server to trust a client-supplied leaderId/userId.

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

export interface DiscussionMessage { from: string; name: string; text: string; at: number }

export interface OtherParticipant { userId: string; name: string }

type StudySignalType =
  | "study_start"
  | "section_change"
  | "discuss_question"
  | "scripture_share"
  | "pass_lead"
  | "discussion_message"
  | "study_end"
  | "participant_removed";

interface StudySignal {
  type: StudySignalType;
  from: string;
  data?: any;
}

export function useStudySession(channelName: string, callId: string, otherParticipants: OtherParticipant[]) {
  const { profile } = useAuth();
  const myId = profile?.id ?? "";
  const myName = profile?.displayName || "Me";

  // Backward-compatible single-party accessor — every 1:1 code path below
  // (unchanged from before C3) reads this exactly as it used to read the
  // old `otherUserId` parameter.
  const otherUserId = otherParticipants[0]?.userId ?? "";
  const isGroup = otherParticipants.length > 1;

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
  const [discussionMessages, setDiscussionMessages] = useState<DiscussionMessage[]>([]);
  const [pendingGroupStudy, setPendingGroupStudy] = useState<CurrentGroupStudy | null>(null);
  const [wasRemoved, setWasRemoved] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  const isLeader = !!myId && leaderId === myId;
  const currentSectionIndex = isFollowing ? groupSectionIndex : localSectionIndex;

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const sendSignal = useCallback((type: StudySignalType, data?: any) => {
    channelRef.current?.send({ type: "broadcast", event: "signal", payload: { type, from: myId, data } as StudySignal });
  }, [myId]);

  useEffect(() => {
    if (!channelName || !myId) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Security hardening — this channel is now a Supabase Realtime private
    // channel (see migration 086: RLS on realtime.messages, scoped to real
    // p2p_call_logs participants). Private channels are authorized off the
    // JWT attached to the realtime connection, so the token must be set
    // BEFORE subscribing (awaited here, not raced against it). The
    // onAuthStateChange listener is the documented mitigation for a real
    // gotcha: Realtime disconnects a private channel if it never receives a
    // fresh token, so a long-running study call needs the token kept
    // current, not just set once at mount.
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    function handleSignal({ payload }: { payload: StudySignal }) {
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
          setDiscussionMessages([]);
          setPendingGroupStudy(null);
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
        case "discussion_message": {
          const m: DiscussionMessage = { from: payload.from, name: payload.data?.name ?? "Someone", text: payload.data?.text ?? "", at: Date.now() };
          setDiscussionMessages((prev) => [...prev, m]);
          break;
        }
        case "study_end":
          setIsActive(false);
          break;
        case "participant_removed":
          // Cooperative removal (spec: Agora gives no participant authority
          // over another client's stream) — this client only acts when IT
          // is the one named as removed; every other participant just sees
          // a smaller roster next time they check.
          if (payload.data?.userId === myId) {
            setWasRemoved(true);
            setIsActive(false);
          }
          break;
      }
    }

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase.channel(`study_${channelName}`, { config: { broadcast: { self: false }, private: true } });
      channel.on("broadcast", { event: "signal" }, handleSignal).subscribe((status, err) => {
        // Production-grade: an authorization failure on a private channel
        // surfaces here as CHANNEL_ERROR, not a thrown exception — log it
        // rather than silently leaving the user with no realtime updates.
        if (status === "CHANNEL_ERROR") {
          console.error("Study Together realtime channel authorization failed", err);
        }
      });
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      if (channel) { supabase.removeChannel(channel); channelRef.current = null; }
    };
  }, [channelName, myId]);

  const startStudy1to1 = useCallback(async (lessonMeta: StudyLessonMeta) => {
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

  // Mid-call join / reconnect entry point (spec §9, §18) — idempotent.
  const joinStudy = useCallback(async (): Promise<boolean> => {
    if (!callId) return false;
    try {
      const data = await joinGroupStudy(callId);
      setSessionId(data.sessionId);
      setLesson({ id: data.lessonId, moduleId: data.moduleId ?? "", title: data.title ?? "" });
      setLeaderId(data.leaderId);
      setGroupSectionIndex(data.currentSectionIndex ?? 0);
      setIsFollowing(true);
      setDiscussionMessages([]);
      setPendingGroupStudy(null);
      startedAtRef.current = Date.now();
      setIsActive(true);
      return true;
    } catch {
      return false;
    }
  }, [callId]);

  const startStudyGroup = useCallback(async (lessonMeta: StudyLessonMeta) => {
    if (!myId || !callId) return;
    try {
      const { sessionId: newSessionId } = await startGroupStudy(callId, lessonMeta.id, lessonMeta.moduleId, lessonMeta.title);
      setSessionId(newSessionId);
      setLesson(lessonMeta);
      setLeaderId(myId);
      setGroupSectionIndex(0);
      setIsFollowing(true);
      setScripturesDiscussed([]);
      setDiscussionMessages([]);
      startedAtRef.current = Date.now();
      setIsActive(true);
      sendSignal("study_start", { sessionId: newSessionId, lesson: lessonMeta, leaderId: myId });
    } catch (e: any) {
      // Race: someone else started it a moment earlier — join their session
      // rather than dead-ending (spec §8/§9: never a second, competing session).
      if (String(e?.message ?? "").includes("already active")) {
        await joinStudy();
      }
    }
  }, [myId, callId, sendSignal, joinStudy]);

  const startStudy = useCallback(async (lessonMeta: StudyLessonMeta) => {
    if (isGroup) await startStudyGroup(lessonMeta);
    else await startStudy1to1(lessonMeta);
  }, [isGroup, startStudyGroup, startStudy1to1]);

  // Checks whether the group is already mid-study — used both to offer a
  // mid-call joiner "Join Study" (spec §9) and, on remount, as this app's
  // reconnect/restoration path (spec §18): the call screen already
  // re-initializes its Agora token/engine on mount, so re-checking current
  // study state at the same moment restores it the same way.
  const checkActiveStudy = useCallback(async (): Promise<CurrentGroupStudy | null> => {
    if (!isGroup || !callId) return null;
    try {
      const data = await getCurrentGroupStudy(callId);
      if (data.active) { setPendingGroupStudy(data); return data; }
      setPendingGroupStudy(null);
      return null;
    } catch {
      return null;
    }
  }, [isGroup, callId]);

  const dismissPendingGroupStudy = useCallback(() => setPendingGroupStudy(null), []);

  const changeSection = useCallback((index: number) => {
    setGroupSectionIndex(index);
    sendSignal("section_change", { index });
    if (isGroup && callId) void updateGroupStudySection(callId, index).catch(() => {});
  }, [sendSignal, isGroup, callId]);

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

  const sendDiscussionMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const m: DiscussionMessage = { from: myId, name: myName, text: trimmed, at: Date.now() };
    setDiscussionMessages((prev) => [...prev, m]);
    sendSignal("discussion_message", { text: trimmed, name: myName });
  }, [myId, myName, sendSignal]);

  // 1:1 only — voluntary hand-off, unchanged from before C3. Group Study
  // Together does not expose a manual "pass the lead" action (see C3 report
  // §Deferred): leadership there only ever moves via the deterministic
  // server-computed reassignment below, so this stays broadcast-only and
  // untouched for the two-party case that already relied on it.
  const passLead = useCallback((newLeaderId: string) => {
    setLeaderId(newLeaderId);
    sendSignal("pass_lead", { newLeaderId });
  }, [sendSignal]);

// C4.7 — called when a remaining group-study client observes (Agora
  // onUserOffline) that ANY study participant's uid went offline, not just
  // the leader (C3 only reported leader departures, which left a departed
  // non-leader listed as an active study participant forever). The server
  // always clears the departed participant and — only when the departure
  // actually affects leadership — computes who leads next itself (spec §6:
  // deterministic, not arbitrary). Safe to call from multiple remaining
  // clients at once (row-locked + idempotent server-side).
  const reportParticipantDeparture = useCallback(async (departedUserId: string) => {
    if (!isGroup || !callId) return;
    try {
      const data = await reportStudyParticipantDeparted(callId, departedUserId);
      if (data.ended) {
        setIsActive(false);
      } else if (data.leaderChanged && data.leaderId) {
        setLeaderId(data.leaderId);
        sendSignal("pass_lead", { newLeaderId: data.leaderId });
      }
    } catch {
      /* best-effort — another remaining participant's call will succeed */
    }
  }, [isGroup, callId, sendSignal]);

  // Study Together C6 — leader-only; authorization is enforced server-side
  // in p2p_remove_study_participant (never trust this client's own
  // isLeader flag, or the UI simply hiding the button from a non-leader, as
  // the actual control). Broadcasting "participant_removed" is the
  // cooperative signal the removed client's own app acts on — Agora itself
  // gives no participant authority over another client's media stream.
  const removeParticipant = useCallback(async (targetUserId: string): Promise<string | null> => {
    if (!isGroup || !callId) return "Not available in a 1:1 session.";
    try {
      await removeStudyParticipant(callId, targetUserId);
      sendSignal("participant_removed", { userId: targetUserId });
      return null;
    } catch (e: any) {
      return e?.message ?? "Unable to remove this participant.";
    }
  }, [isGroup, callId, sendSignal]);

  const endStudy = useCallback(async (): Promise<StudySessionSummary | null> => {
    const durationSeconds = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0;
    const summary: StudySessionSummary = {
      durationSeconds,
      lessonTitle: lesson?.title ?? "",
      questionsDiscussedCount: discussingQuestionId ? 1 : 0,
      scripturesDiscussed,
    };
    if (!isGroup) {
      if (sessionId) {
        await supabase.from("p2p_sessions").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", sessionId);
        void supabase.from("p2p_user_activity_events").insert({
          user_id: myId, event_type: "session_held", metadata: { session_id: sessionId, peer_id: otherUserId },
        });
      }
    } else if (callId) {
      await endGroupStudy(callId).catch(() => {});
    }
    sendSignal("study_end");
    setIsActive(false);
    setSessionId(null);
    setLesson(null);
    setLeaderId(null);
    return summary;
  }, [sessionId, lesson, discussingQuestionId, scripturesDiscussed, myId, otherUserId, isGroup, callId, sendSignal]);

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

  // 1:1 only — unchanged shape/behavior from before C3.
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

  // Group only — one {status, completed} entry per current call participant.
  const getGroupProgress = useCallback(async (lessonId: string): Promise<GroupStudyProgress> => {
    if (!myId || !callId) return {};
    return getGroupStudyProgress(callId, myId, lessonId);
  }, [myId, callId]);

  return {
    isActive, sessionId, lesson, leaderId, isLeader, isGroup,
    currentSectionIndex, isFollowing, discussingQuestionId, sharedScripture, scripturesDiscussed,
    discussionMessages, pendingGroupStudy, wasRemoved,
    startStudy, changeSection, exploreIndependently, returnToGroup,
    discussQuestion, shareScripture, sendDiscussionMessage, passLead, endStudy,
    getSharedLessonData, getStudyProgress, getGroupProgress,
    joinStudy, checkActiveStudy, dismissPendingGroupStudy, reportParticipantDeparture, removeParticipant,
  };
}