import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import * as Linking from "expo-linking";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { DAILY_VERSES } from "@/constants/dailyVerses";
import { buildWidgetSnapshot, signedOutSnapshot, type WidgetInputs } from "@/lib/widgetSnapshot";
import { clearWidgetSnapshot, loadWidgetPrefs, widgetsSupported, writeWidgetSnapshot } from "@/lib/widgetSync";
import { getDiscoverHome } from "@/lib/kingdomStoriesApi";
import { getLearningOverview } from "@/lib/learningCentreApi";
import { getMyStudies } from "@/lib/studyTogetherApi";
import { getChurchCalls } from "@/lib/churchCallApi";
import { loadPosition } from "@/lib/bibleReadingPrefs";
import { bookByCode, bookByName } from "@/lib/bibleReaderApi";

// Keeps the home-screen widgets' snapshot current (see lib/widgetSnapshot).
// Renders nothing. Reads only what the app already reads elsewhere, through
// the same APIs, and only when the app is open: on sign-in, when the app
// returns to the foreground (at most every 15 minutes for network data) and
// whenever already-loaded data (modules, plans) changes. Each source fails
// on its own — a failure keeps that part of the last snapshot's shape empty
// rather than inventing anything. Sign-out clears the widgets.

const REMOTE_EVERY_MS = 15 * 60 * 1000;
/** Emitted (DeviceEventEmitter) after the person changes widget settings, so widgets update at once. */
export const WIDGET_PREFS_CHANGED = "widgets:prefsChanged";
const link = (path: string) => Linking.createURL(path);

/** "John 15:5" → the Bible reader at John 15 (verse 5); otherwise Bible Study. */
function verseLink(ref: string): string {
  const m = ref.match(/^(.+?)\s+(\d+):(\d+)/);
  const book = m ? bookByName(m[1]) : undefined;
  return book ? link(`/bible?book=${book.code}&chapter=${m![2]}&v=${m![3]}`) : link("/bible-study");
}
const VERSES = DAILY_VERSES.map((v) => ({ ...v, url: verseLink(v.ref) }));

type Remote = Pick<WidgetInputs, "stories" | "overview" | "studies" | "nextGathering" | "activePlans" | "bible">;
const EMPTY: Remote = { stories: [], overview: null, studies: [], nextGathering: null, activePlans: [], bible: null };

export default function WidgetSyncHost() {
  const { profile, isAuthenticated } = useAuth();
  const { modules, plans, userChurch } = useData();
  const [remote, setRemote] = useState<Remote>(EMPTY);
  const [prefsVersion, setPrefsVersion] = useState(0);
  const lastRemote = useRef(0);
  const userId = isAuthenticated ? profile?.id ?? null : null;

  const loadRemote = useCallback(async (force = false) => {
    if (!userId || !widgetsSupported()) return;
    if (!force && Date.now() - lastRemote.current < REMOTE_EVERY_MS) return;
    lastRemote.current = Date.now();
    const [disc, overview, studies, calls, enrolments, pos] = await Promise.all([
      getDiscoverHome().catch(() => null),
      getLearningOverview().catch(() => null),
      getMyStudies().catch(() => null),
      userChurch?.id ? getChurchCalls(userChurch.id).catch(() => null) : Promise.resolve(null),
      supabase.from("p2p_plan_enrollments").select("plan_id, status").eq("user_id", userId).neq("status", "completed")
        .then(({ data }) => (data ?? []) as { plan_id: string }[], () => [] as { plan_id: string }[]),
      loadPosition().catch(() => null),
    ]);
    const next = calls?.upcoming?.find((c) => c.scheduledStartAt && Date.parse(c.scheduledStartAt) > Date.now()) ?? null;
    const titleOf = new Map(plans.map((p) => [p.id, p.title]));
    setRemote({
      stories: disc?.continueLearning ?? [],
      overview: overview ? { toDo: overview.toDo.length, awaitingReview: overview.awaitingReview.length, feedback: overview.feedback.length, toReview: overview.toReview.length } : null,
      studies: (studies?.active ?? []).map((s) => ({ id: s.id, title: s.title, destinationName: s.destination.name })),
      nextGathering: next ? { title: next.title, startsAt: next.scheduledStartAt!, churchName: userChurch?.name ?? null } : null,
      activePlans: enrolments.filter((e) => titleOf.has(e.plan_id)).map((e) => ({ id: e.plan_id, title: titleOf.get(e.plan_id)! })),
      bible: pos ? { book: pos.book, bookName: bookByCode(pos.book)?.name ?? pos.book, chapter: pos.chapter, translation: pos.translation } : null,
    });
  }, [userId, userChurch?.id, userChurch?.name, plans]);

  // Widget settings changed (app/settings/widgets.tsx): rebuild now.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(WIDGET_PREFS_CHANGED, () => setPrefsVersion((v) => v + 1));
    return () => sub.remove();
  }, []);

  // Network data: on sign-in and on returning to the app.
  useEffect(() => {
    if (!userId) return;
    void loadRemote(true);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void loadRemote(); });
    return () => sub.remove();
  }, [userId, loadRemote]);

  // Build + write whenever anything changes (writes only when the content differs).
  useEffect(() => {
    if (!widgetsSupported()) return;
    if (!userId) {
      void clearWidgetSnapshot().then(() => writeWidgetSnapshot(signedOutSnapshot(new Date(), link, VERSES)));
      setRemote(EMPTY);
      return;
    }
    let cancelled = false;
    (async () => {
      const prefs = await loadWidgetPrefs(userId);
      if (cancelled) return;
      const firstName = (profile?.displayName ?? "").trim().split(/\s+/)[0] || null;
      await writeWidgetSnapshot(buildWidgetSnapshot({
        now: new Date(), signedIn: true, firstName, prefs, link, verses: VERSES, modules, ...remote,
      }));
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [userId, profile?.displayName, modules, remote, prefsVersion]);

  return null;
}
