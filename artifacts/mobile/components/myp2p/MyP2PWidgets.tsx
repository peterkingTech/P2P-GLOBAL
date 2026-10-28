import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { STAGES, getStageFromPoints } from "@/constants/stages";
import { getDiscoverHome, saveStory, unsaveStory, formatTopicNumber, type DiscoverHome } from "@/lib/kingdomStoriesApi";
import { getMyStudies, type StudyCard } from "@/lib/studyTogetherApi";
import { getLearningOverview, STATE_LABEL, SOURCE_LABEL, type WorkItem } from "@/lib/learningCentreApi";
import { loadPosition, type ReadingPosition } from "@/lib/bibleReadingPrefs";
import { bibleRoute, bookByCode } from "@/lib/bibleReaderApi";
import { studyMinutesToday } from "@/lib/studyTime";
import { loadReminderSettings, goalProgress } from "@/lib/studyReminders";
import { journeyMilestones, stageProgress, previewText, UPDATE_TYPES, type Timeline, type WidgetId } from "@/lib/myP2P";

// The My P2P widgets. Each one reads existing data through the services the
// rest of the app already uses, shows honest loading / empty / error states,
// and only links to existing screens. Nothing here writes progress.

type S = ReturnType<typeof makeStyles>;
const useS = () => { const { colors } = useTheme(); return { c: colors, s: useMemo(() => makeStyles(colors), [colors]) }; };

function Card({ icon, title, children, s, c, onTitle }: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; children: React.ReactNode; s: S; c: AppColors; onTitle?: () => void }) {
  return (
    <View style={s.card}>
      <TouchableOpacity style={s.cardHead} onPress={onTitle} disabled={!onTitle} accessibilityRole={onTitle ? "button" : "header"} accessibilityLabel={title}>
        <Ionicons name={icon} size={18} color={c.accentGreen} />
        <Text style={s.cardTitle}>{title}</Text>
        {onTitle ? <Ionicons name="chevron-forward" size={16} color={c.textMuted} /> : null}
      </TouchableOpacity>
      {children}
    </View>
  );
}
function Btn({ label, onPress, s, primary, icon, c }: { label: string; onPress: () => void; s: S; primary?: boolean; icon?: React.ComponentProps<typeof Ionicons>["name"]; c: AppColors }) {
  return (
    <TouchableOpacity style={primary ? s.btn : s.btnSecondary} onPress={onPress} accessibilityRole="button">
      {icon ? <Ionicons name={icon} size={15} color={primary ? "#fff" : c.textDark} /> : null}
      <Text style={primary ? s.btnText : s.btnSecondaryText}>{label}</Text>
    </TouchableOpacity>
  );
}
const Bar = ({ pct, s }: { pct: number; s: S }) => (
  <View style={s.barBg} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
    <View style={[s.barFill, { width: `${Math.max(0, Math.min(100, pct))}%` as any }]} />
  </View>
);
const Loading = ({ c }: { c: AppColors }) => <ActivityIndicator color={c.accentGreen} style={{ marginVertical: 8 }} />;
const Unavailable = ({ s, text }: { s: S; text?: string }) => <Text style={s.meta}>{text ?? "This isn't available right now. Pull to refresh or try again later."}</Text>;

/** Loads `fn` on mount and whenever `refreshKey` changes; errors become `error`. */
function useLoad<T>(fn: () => Promise<T>, refreshKey: number, deps: unknown[] = []) {
  const [state, set] = useState<{ data: T | null; loading: boolean; error: boolean }>({ data: null, loading: true, error: false });
  useEffect(() => {
    let live = true;
    set((p) => ({ ...p, loading: true }));
    fn().then((data) => live && set({ data, loading: false, error: false })).catch(() => live && set((p) => ({ data: p.data, loading: false, error: true })));
    return () => { live = false; };
  }, [refreshKey, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

// ── My Discipleship Journey (required) ──────────────────────────────────────
function JourneyWidget({ refreshKey }: { refreshKey: number }) {
  const { c, s } = useS();
  const router = useRouter();
  const { profile } = useAuth();
  const { modules } = useData();
  const { data, loading, error } = useLoad<Timeline>(async () => {
    if (!profile?.id) return null;
    const { data: tl, error: e } = await supabase.rpc("p2p_get_activity_timeline", { p_user_id: profile.id });
    if (e) throw e;
    return tl as Timeline;
  }, refreshKey, [profile?.id]);
  const points = profile?.growthLevel ?? 0;
  const sp = stageProgress(points, STAGES, getStageFromPoints(points));
  const m = journeyMilestones(data);
  const currentModule = modules.find((x) => !x.isLocked && x.completedLessons < x.lessonCount) ?? null;
  const cont = () => router.push((currentModule ? `/module/${currentModule.id}` : m.next?.route ?? "/(tabs)/learn") as any);
  return (
    <Card icon="trail-sign-outline" title="My Discipleship Journey" s={s} c={c} onTitle={() => router.push("/my-discipleship/journey" as any)}>
      <Text style={s.big}>{sp.stage.name}</Text>
      <Text style={s.meta}>Current stage · {sp.number} of {sp.of}{sp.nextStage ? ` · ${sp.pct}% toward ${sp.nextStage.name}` : ""}</Text>
      <Bar pct={sp.pct} s={s} />
      {loading && !data ? <Loading c={c} /> : error && !data ? <Unavailable s={s} text="Your milestones couldn't load right now." /> : (
        <>
          <Text style={s.line}>Milestones: {m.done} / {m.total}</Text>
          <View style={s.milestones} accessible accessibilityLabel={m.list.map((x) => `${x.done ? "Done" : "Not yet"}: ${x.done ? x.label : x.goal}`).join(". ")}>
            {m.list.map((x) => <Ionicons key={x.key} name={x.done ? "checkmark-circle" : "ellipse-outline"} size={18} color={x.done ? c.accentGreen : c.textMuted} />)}
          </View>
          <Text style={s.line}>{m.next ? `Next step: ${m.next.goal}` : "Every Journey milestone is complete — keep growing and guiding others."}</Text>
          {!m.started ? <Text style={s.meta}>Your Journey starts with your first Kingdom School lesson.</Text> : null}
        </>
      )}
      <View style={s.row}>
        <Btn label={m.started ? "Continue Journey" : "Start your Journey"} primary icon="play" onPress={cont} s={s} c={c} />
        <Btn label="View Full Journey" onPress={() => router.push("/my-discipleship/journey" as any)} s={s} c={c} />
      </View>
    </Card>
  );
}

// ── My Discipleship Journal (required) ──────────────────────────────────────
function JournalWidget({ refreshKey, showPreview, onTogglePreview }: { refreshKey: number; showPreview: boolean; onTogglePreview: () => void }) {
  const { c, s } = useS();
  const router = useRouter();
  const { getJournalTimeline } = useData();
  const { data, loading, error } = useLoad(() => getJournalTimeline(), refreshKey);
  const latest = useMemo(() => [...(data ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null, [data]);
  const kind = latest ? ({ note: "Note", highlight: "Highlight", prayer: "Prayer", reflection: "Reflection" } as const)[latest.type] : null;
  const continueRoute = latest?.type === "reflection" ? `/my-discipleship/journal/reflection/${latest.id}` : "/my-discipleship/journal";
  return (
    <Card icon="journal-outline" title="My Discipleship Journal" s={s} c={c} onTitle={() => router.push("/my-discipleship/journal" as any)}>
      <Text style={s.meta}>Your personal space for reflections and growth. Private — only you can see it.</Text>
      {loading && !data ? <Loading c={c} /> : error && !data ? <Unavailable s={s} text="Your journal couldn't load right now." />
        : !latest ? <Text style={s.line}>No entries yet. Write your first reflection.</Text> : (
          <View style={s.inner}>
            <Text style={s.line}>Last entry: {kind} · {new Date(latest.at).toLocaleDateString()}</Text>
            {showPreview ? <Text style={s.preview} numberOfLines={2}>{previewText(latest.preview || latest.title)}</Text> : null}
            <TouchableOpacity onPress={onTogglePreview} accessibilityRole="button" style={s.linkBtn}>
              <Text style={s.link}>{showPreview ? "Hide preview" : "Show preview"}</Text>
            </TouchableOpacity>
          </View>
        )}
      <View style={s.row}>
        {latest ? <Btn label="Continue Journal" primary icon="create-outline" onPress={() => router.push(continueRoute as any)} s={s} c={c} /> : null}
        <Btn label="New Entry" primary={!latest} icon="add" onPress={() => router.push("/my-discipleship/journal/reflection/new" as any)} s={s} c={c} />
        <Btn label="View Journal" onPress={() => router.push("/my-discipleship/journal" as any)} s={s} c={c} />
      </View>
    </Card>
  );
}

// ── Continue Learning ───────────────────────────────────────────────────────
function useDiscover(refreshKey: number) {
  return useLoad<DiscoverHome>(() => getDiscoverHome(), refreshKey);
}
function ContinueWidget({ refreshKey }: { refreshKey: number }) {
  const { c, s } = useS();
  const router = useRouter();
  const { modules } = useData();
  const disc = useDiscover(refreshKey);
  const mod = modules.find((x) => !x.isLocked && x.completedLessons < x.lessonCount) ?? null;
  const story = disc.data?.continueLearning?.[0] ?? null;
  const sp = story?.myProgress;
  return (
    <Card icon="play-circle-outline" title="Continue Learning" s={s} c={c}>
      {mod && mod.lessonCount > 0 ? (
        <TouchableOpacity style={s.item} onPress={() => router.push(`/module/${mod.id}` as any)} accessibilityRole="button"
          accessibilityLabel={`Kingdom School: ${mod.title}, lesson ${Math.min(mod.completedLessons + 1, mod.lessonCount)} of ${mod.lessonCount}. Continue`}>
          <Text style={s.kicker}>Kingdom School</Text>
          <Text style={s.itemTitle} numberOfLines={2}>{mod.title}</Text>
          <Text style={s.meta}>Lesson {Math.min(mod.completedLessons + 1, mod.lessonCount)} of {mod.lessonCount}</Text>
          <Bar pct={Math.round((mod.completedLessons / mod.lessonCount) * 100)} s={s} />
        </TouchableOpacity>
      ) : null}
      {story && sp ? (
        <TouchableOpacity style={s.item} onPress={() => router.push({ pathname: "/kingdom-stories/[id]", params: { id: story.id, open: "next" } } as any)} accessibilityRole="button"
          accessibilityLabel={`Kingdom Story: ${story.title}. Continue`}>
          <Text style={s.kicker}>Kingdom Story{formatTopicNumber(story.topicNumber) ? ` · ${formatTopicNumber(story.topicNumber)}` : ""}</Text>
          <Text style={s.itemTitle} numberOfLines={2}>{story.title}</Text>
          <Text style={s.meta}>{story.lastChapterNumber ? `Chapter ${story.lastChapterNumber} of ${sp.totalChapters}` : `${sp.doneChapters} of ${sp.totalChapters} chapters`}</Text>
          <Bar pct={sp.totalChapters ? Math.round((sp.doneChapters / sp.totalChapters) * 100) : 0} s={s} />
        </TouchableOpacity>
      ) : null}
      {!mod && !story ? (
        disc.loading && !disc.data ? <Loading c={c} /> : (
          <>
            <Text style={s.line}>Nothing in progress right now.</Text>
            <View style={s.row}>
              <Btn label="Kingdom School" primary onPress={() => router.push("/(tabs)/learn" as any)} s={s} c={c} />
              <Btn label="Kingdom Stories" onPress={() => router.push("/kingdom-stories" as any)} s={s} c={c} />
            </View>
          </>
        )
      ) : null}
    </Card>
  );
}

// ── Daily Growth ────────────────────────────────────────────────────────────
function GrowthWidget({ refreshKey }: { refreshKey: number }) {
  const { c, s } = useS();
  const router = useRouter();
  const { profile } = useAuth();
  const { data } = useLoad(async () => {
    if (!profile?.id) return null;
    const [minutes, settings] = await Promise.all([studyMinutesToday(profile.id), loadReminderSettings(profile.id)]);
    return { minutes, settings };
  }, refreshKey, [profile?.id]);
  if (!data) return <Card icon="leaf-outline" title="Daily Growth" s={s} c={c}><Loading c={c} /></Card>;
  const g = goalProgress(data.minutes, data.settings.goalMinutes);
  return (
    <Card icon="leaf-outline" title="Daily Growth" s={s} c={c}>
      {data.settings.enabled ? (
        <>
          <Text style={s.big}>{g.label}</Text>
          <Bar pct={g.pct} s={s} />
        </>
      ) : (
        <>
          <Text style={s.line}>{data.minutes > 0 ? `${data.minutes} minutes of study today.` : "No study time recorded yet today."}</Text>
          <Text style={s.meta}>Set a daily goal in Study Reminders to see your progress toward it.</Text>
        </>
      )}
      <Text style={s.meta}>Counted only while a lesson or the Bible is open on screen.</Text>
      <View style={s.row}>
        <Btn label="Study now" primary onPress={() => router.push("/(tabs)/learn" as any)} s={s} c={c} />
        <Btn label={data.settings.enabled ? "Change goal" : "Set a goal"} onPress={() => router.push("/settings/study-reminders" as any)} s={s} c={c} />
      </View>
    </Card>
  );
}

// ── My Bible ────────────────────────────────────────────────────────────────
function BibleWidget({ refreshKey }: { refreshKey: number }) {
  const { c, s } = useS();
  const router = useRouter();
  const { data, loading } = useLoad<ReadingPosition | null>(() => loadPosition(), refreshKey);
  const name = data ? bookByCode(data.book)?.name ?? data.book : null;
  return (
    <Card icon="book-outline" title="My Bible" s={s} c={c} onTitle={() => router.push("/bible" as any)}>
      {loading && !data ? <Loading c={c} /> : data ? (
        <Text style={s.line}>Last read: {name} {data.chapter} · {data.translation}</Text>
      ) : <Text style={s.line}>Open the Bible to start reading.</Text>}
      <View style={s.row}>
        <Btn label={data ? "Continue Reading" : "Open the Bible"} primary icon="book" s={s} c={c}
          onPress={() => router.push((data ? bibleRoute({ book: data.book, chapter: data.chapter, translation: data.translation }) : "/bible") as any)} />
        {data ? <Btn label="Compare translations" icon="git-compare-outline" s={s} c={c}
          onPress={() => { const r = bibleRoute({ book: data.book, chapter: data.chapter, translation: data.translation }); router.push({ ...r, params: { ...r.params, compare: "1" } } as any); }} /> : null}
      </View>
    </Card>
  );
}

// ── Kingdom Stories ─────────────────────────────────────────────────────────
function StoriesWidget({ refreshKey }: { refreshKey: number }) {
  const { c, s } = useS();
  const router = useRouter();
  const disc = useDiscover(refreshKey);
  const [fav, setFav] = useState<boolean | null>(null);
  const story = disc.data?.continueLearning?.[0] ?? disc.data?.featured ?? disc.data?.recentlyAdded?.[0] ?? null;
  useEffect(() => { setFav(story ? !!disc.data?.favourites?.some((x) => x.id === story.id) : null); }, [story?.id, disc.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const started = !!story?.myProgress?.started;
  async function toggleFav() {
    if (!story || fav === null) return;
    const on = !fav; setFav(on);
    try { if (on) await saveStory(story.id, "favourite"); else await unsaveStory(story.id, "favourite"); } catch { setFav(!on); }
  }
  return (
    <Card icon="library-outline" title="Kingdom Stories" s={s} c={c} onTitle={() => router.push("/kingdom-stories" as any)}>
      {disc.loading && !disc.data ? <Loading c={c} /> : !disc.data?.libraryAvailable && !story ? <Unavailable s={s} />
        : !story ? <Text style={s.line}>New stories are on their way.</Text> : (
          <>
            <Text style={s.kicker}>{[formatTopicNumber(story.topicNumber), story.category?.title].filter(Boolean).join(" · ") || (started ? "Continue" : "Featured")}</Text>
            <Text style={s.itemTitle} numberOfLines={2}>{story.title}</Text>
            {story.subtitle ? <Text style={s.meta} numberOfLines={2}>{story.subtitle}</Text> : null}
            <View style={s.row}>
              <Btn label={started ? "Continue" : "Start"} primary icon="book" s={s} c={c} onPress={() => router.push({ pathname: "/kingdom-stories/[id]", params: { id: story.id, open: "next" } } as any)} />
              <TouchableOpacity style={s.iconBtn} onPress={toggleFav} accessibilityRole="button" accessibilityState={{ selected: !!fav }} accessibilityLabel={fav ? "Remove from My Favourites" : "Add to My Favourites"}>
                <Ionicons name={fav ? "heart" : "heart-outline"} size={20} color={fav ? "#E11D48" : c.textMid} />
              </TouchableOpacity>
              <Btn label="Browse" s={s} c={c} onPress={() => router.push("/kingdom-stories" as any)} />
            </View>
          </>
        )}
    </Card>
  );
}

// ── Study Together ──────────────────────────────────────────────────────────
function TogetherWidget({ refreshKey }: { refreshKey: number }) {
  const { c, s } = useS();
  const router = useRouter();
  const { data, loading, error } = useLoad(() => getMyStudies(), refreshKey);
  const item = (x: StudyCard) => (
    <TouchableOpacity key={x.id} style={s.listRow} onPress={() => router.push(`/study-together/${x.id}` as any)} accessibilityRole="button">
      <Text style={[s.line, { flex: 1 }]} numberOfLines={1}>{x.title}</Text>
      <Text style={s.meta}>{x.destination.type === "peer" ? (x.isHost ? "With peers" : `With ${x.host.name}`) : x.destination.name ?? ""}</Text>
    </TouchableOpacity>
  );
  return (
    <Card icon="people-outline" title="Study Together" s={s} c={c} onTitle={() => router.push("/study-together" as any)}>
      {loading && !data ? <Loading c={c} /> : error && !data ? <Unavailable s={s} /> : (
        <>
          {data!.invitations.length ? <Text style={s.line}>{data!.invitations.length} invitation{data!.invitations.length === 1 ? "" : "s"} waiting</Text> : null}
          {data!.active.slice(0, 3).map(item)}
          {!data!.invitations.length && !data!.active.length ? <Text style={s.line}>Study a story or lesson with a peer or your group.</Text> : null}
        </>
      )}
      <View style={s.row}>
        {data?.invitations.length ? <Btn label="Answer invitations" primary onPress={() => router.push("/study-together" as any)} s={s} c={c} /> : null}
        <Btn label="Start Study Together" primary={!data?.invitations.length} icon="add" onPress={() => router.push("/kingdom-stories" as any)} s={s} c={c} />
      </View>
    </Card>
  );
}

// ── My Communities ──────────────────────────────────────────────────────────
function CommunitiesWidget() {
  const { c, s } = useS();
  const router = useRouter();
  const { userChurch, totalUnreadCount } = useData();
  return (
    <Card icon="home-outline" title="My Communities" s={s} c={c}>
      {totalUnreadCount > 0 ? (
        <TouchableOpacity style={s.listRow} onPress={() => router.push("/(tabs)/messages" as any)} accessibilityRole="button">
          <Ionicons name="chatbubbles-outline" size={18} color={c.accentGreen} />
          <Text style={[s.line, { flex: 1 }]}>{totalUnreadCount} unread message{totalUnreadCount === 1 ? "" : "s"}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={s.listRow} onPress={() => router.push("/family" as any)} accessibilityRole="button">
        <Ionicons name="home-outline" size={18} color={c.textMid} /><Text style={[s.line, { flex: 1 }]}>Family Circle</Text><Ionicons name="chevron-forward" size={16} color={c.textMuted} />
      </TouchableOpacity>
      {userChurch ? (
        <TouchableOpacity style={s.listRow} onPress={() => router.push("/church" as any)} accessibilityRole="button">
          <Ionicons name="business-outline" size={18} color={c.textMid} /><Text style={[s.line, { flex: 1 }]} numberOfLines={1}>{userChurch.name}</Text><Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={s.listRow} onPress={() => router.push("/circles" as any)} accessibilityRole="button">
        <Ionicons name="people-circle-outline" size={18} color={c.textMid} /><Text style={[s.line, { flex: 1 }]}>My Circles</Text><Ionicons name="chevron-forward" size={16} color={c.textMuted} />
      </TouchableOpacity>
    </Card>
  );
}

// ── Prayer and Reflection ───────────────────────────────────────────────────
function PrayerWidget() {
  const { c, s } = useS();
  const router = useRouter();
  return (
    <Card icon="flame-outline" title="Prayer and Reflection" s={s} c={c}>
      <Text style={s.meta}>Your prayers and reflections are private unless you choose to share them.</Text>
      <View style={s.row}>
        <Btn label="Pray" primary icon="flame-outline" onPress={() => router.push("/prayer/journal?compose=true" as any)} s={s} c={c} />
        <Btn label="Prayer journal" onPress={() => router.push("/prayer/journal" as any)} s={s} c={c} />
        <Btn label="Reflect" onPress={() => router.push("/my-discipleship/journal/reflection/new" as any)} s={s} c={c} />
      </View>
    </Card>
  );
}

// ── P2P Updates ─────────────────────────────────────────────────────────────
function UpdatesWidget({ refreshKey }: { refreshKey: number }) {
  const { c, s } = useS();
  const router = useRouter();
  const { getMyNotifications } = useData();
  const notes = useLoad(() => getMyNotifications(), refreshKey);
  const disc = useDiscover(refreshKey);
  const fresh = (disc.data?.recentlyAdded ?? []).filter((x) => x.publishedAt && Date.now() - new Date(x.publishedAt).getTime() < 14 * 86400000).slice(0, 1);
  const list = (notes.data ?? []).filter((n) => UPDATE_TYPES.has(n.notificationType ?? "")).slice(0, 3);
  return (
    <Card icon="notifications-outline" title="P2P Updates" s={s} c={c} onTitle={() => router.push("/notifications" as any)}>
      {notes.loading && !notes.data ? <Loading c={c} /> : (
        <>
          {fresh.map((x) => (
            <TouchableOpacity key={x.id} style={s.listRow} onPress={() => router.push(`/kingdom-stories/${x.id}` as any)} accessibilityRole="button">
              <Ionicons name="sparkles-outline" size={16} color={c.accentGreen} />
              <Text style={[s.line, { flex: 1 }]} numberOfLines={1}>New story: {x.title}</Text>
            </TouchableOpacity>
          ))}
          {list.map((n) => (
            <TouchableOpacity key={n.id} style={s.listRow} onPress={() => router.push("/notifications" as any)} accessibilityRole="button">
              <View style={[s.dot, n.isRead && { opacity: 0 }]} />
              <Text style={[s.line, { flex: 1 }]} numberOfLines={1}>{n.title}</Text>
            </TouchableOpacity>
          ))}
          {!fresh.length && !list.length ? <Text style={s.line}>You're all caught up.</Text> : null}
        </>
      )}
    </Card>
  );
}

// ── My Comprehensive Checks (Learning Centre) ─────────────────────────────
function LearningWidget({ refreshKey }: { refreshKey: number }) {
  const { c, s } = useS();
  const router = useRouter();
  const { data, loading, error } = useLoad(() => getLearningOverview(), refreshKey);
  const open = (x: WorkItem) => router.push({ pathname: x.route.pathname, params: x.route.params } as any);
  const reviews = data ? data.toReview.reduce((n, x) => n + (x.waiting ?? 1), 0) : 0;
  return (
    <Card icon="school-outline" title="My Comprehensive Checks" s={s} c={c} onTitle={() => router.push("/learning" as any)}>
      {loading && !data ? <Loading c={c} /> : error && !data ? <Unavailable s={s} /> : (
        <>
          {data!.toDo.slice(0, 3).map((x) => (
            <TouchableOpacity key={x.key} style={s.listRow} onPress={() => open(x)} accessibilityRole="button" accessibilityLabel={`${x.title}, ${SOURCE_LABEL[x.source]}. ${STATE_LABEL[x.state]}`}>
              <Text style={[s.line, { flex: 1 }]} numberOfLines={1}>{x.context ?? x.title}</Text>
              <Text style={s.meta}>{STATE_LABEL[x.state]}</Text>
            </TouchableOpacity>
          ))}
          {!data!.toDo.length ? <Text style={s.line}>Nothing to do right now.</Text> : null}
          {data!.awaitingReview.length ? <Text style={s.meta}>{data!.awaitingReview.length} waiting for review</Text> : null}
          {reviews ? <Text style={s.meta}>{reviews} waiting for your review</Text> : null}
          {data!.feedback.length ? <Text style={s.meta}>{data!.feedback.length} with feedback for you</Text> : null}
        </>
      )}
      <View style={s.row}>
        <Btn label="Open Learning Centre" primary icon="school-outline" onPress={() => router.push("/learning" as any)} s={s} c={c} />
      </View>
    </Card>
  );
}

export function MyP2PWidget({ id, refreshKey, journalPreview, onToggleJournalPreview }: { id: WidgetId; refreshKey: number; journalPreview: boolean; onToggleJournalPreview: () => void }) {
  switch (id) {
    case "journey": return <JourneyWidget refreshKey={refreshKey} />;
    case "journal": return <JournalWidget refreshKey={refreshKey} showPreview={journalPreview} onTogglePreview={onToggleJournalPreview} />;
    case "continue": return <ContinueWidget refreshKey={refreshKey} />;
    case "learning": return <LearningWidget refreshKey={refreshKey} />;
    case "growth": return <GrowthWidget refreshKey={refreshKey} />;
    case "bible": return <BibleWidget refreshKey={refreshKey} />;
    case "stories": return <StoriesWidget refreshKey={refreshKey} />;
    case "together": return <TogetherWidget refreshKey={refreshKey} />;
    case "communities": return <CommunitiesWidget />;
    case "prayer": return <PrayerWidget />;
    case "updates": return <UpdatesWidget refreshKey={refreshKey} />;
  }
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige, padding: 14, gap: 8 },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
    cardTitle: { flex: 1, fontSize: 13, color: c.textDark, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
    big: { fontSize: 17, color: c.textDark, fontFamily: "Inter_700Bold" },
    line: { fontSize: 14, color: c.textDark, fontFamily: "Inter_500Medium" },
    meta: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    preview: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", fontStyle: "italic" },
    kicker: { fontSize: 11, color: c.accentGreen, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
    item: { gap: 3, paddingVertical: 4 },
    itemTitle: { fontSize: 15, color: c.textDark, fontFamily: "Inter_700Bold" },
    inner: { gap: 2 },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 2 },
    btn: { flexDirection: "row", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 10, backgroundColor: c.primaryGreen, alignItems: "center", justifyContent: "center" },
    btnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
    btnSecondary: { flexDirection: "row", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige, backgroundColor: c.lightCream, alignItems: "center", justifyContent: "center" },
    btnSecondaryText: { color: c.textDark, fontSize: 14, fontFamily: "Inter_600SemiBold" },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    barBg: { height: 6, borderRadius: 3, backgroundColor: c.progressTrack ?? c.borderBeige, overflow: "hidden" },
    barFill: { height: 6, borderRadius: 3, backgroundColor: c.accentGreen },
    milestones: { flexDirection: "row", gap: 6 },
    listRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
    linkBtn: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
    link: { fontSize: 12, color: c.accentGreen, fontFamily: "Inter_600SemiBold" },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accentGreen },
  });
}
