import { Router, type IRouter } from "express";
import healthRouter from "./health";
import profilesRouter from "./profiles";
import curriculumRouter from "./curriculum";
import progressRouter from "./progress";
import prayerRouter from "./prayer";
import prayerCoordinationRouter from "./prayerCoordination";
import prayerTestimoniesRouter from "./prayerTestimonies";
import prayerTopicsRouter from "./prayerTopics";
import prayerPathsRouter from "./prayerPaths";
import prayerJournalRouter from "./prayerJournal";
import prayerLibraryRouter from "./prayerLibrary";
import missionsRouter from "./missions";
import kingdomWinsRouter from "./kingdomWins";
import kingdomStoriesRouter from "./kingdomStories";
import searchRouter from "./search";
import sessionsRouter from "./sessions";
import discipleshipRouter from "./discipleship";
import notificationsRouter from "./notifications";
import adminRouter from "./admin";
import registrationRouter from "./registration";
import evaluationsRouter from "./evaluations";
import translationsRouter from "./translations";
import bibleRouter from "./bible";
import circlesRouter from "./circles";
import pastoralCareRouter from "./pastoralCare";
import accountRouter from "./account";
import callsRouter from "./calls";
import connectionsRouter from "./connections";
import feedbackRouter from "./feedback";
import churchesRouter from "./churches";
import churchCallsRouter from "./churchCalls";
import churchStudiesRouter from "./churchStudies";
import churchStudyPlansRouter from "./churchStudyPlans";
import contactRouter from "./contact";
import officialMessagesRouter from "./officialMessages";
import pushRouter from "./push";
import familyRouter from "./family";
import familyWorshipRouter from "./familyWorship";
import familyStudiesRouter from "./familyStudies";
import familyStudyPlansRouter from "./familyStudyPlans";
import youtubeEmbedRouter from "./youtubeEmbed";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/profiles", profilesRouter);
router.use(curriculumRouter); // curriculum + modules + lessons (paths differ, handled internally)
router.use("/progress", progressRouter);
router.use("/prayers", prayerRouter); // legacy, unauthenticated nation-prayer wall (Prayer 2.0 Stage 0 forensic finding — left untouched, not extended)
router.use("/prayer", prayerCoordinationRouter); // Prayer 2.0 — peer-to-peer prayer coordination (requests/availability/invitations/gatherings/participants, paths differ, handled internally)
router.use("/prayer", prayerTestimoniesRouter); // Prayer 2.0 Stage 6 — testimonies live under /prayer/testimonies/* (paths differ, handled internally)
router.use("/prayer", prayerTopicsRouter); // "Pray the Word" Stage 1 — topics/scripture references live under /prayer/topics/* and /prayer/admin/* (paths differ, handled internally)
router.use("/prayer", prayerPathsRouter); // "Pray the Word" Stage 3 — Prayer Paths live under /prayer/paths/* and /prayer/admin/* (paths differ, handled internally)
router.use("/prayer", prayerJournalRouter); // "Pray the Word" Stage 4 — Journal 2.0 additive API, live under /prayer/journal/* (paths differ, handled internally)
router.use("/prayer", prayerLibraryRouter); // "Pray the Word" Stage 5 — Personal Prayer Library (saved items, recent, answered), live under /prayer/saved-*, /prayer/library/*, /prayer/recent, /prayer/activity
router.use("/missions", missionsRouter); // Missions — new independent content domain (fields/stories/prayer points), separate from legacy p2p_missions and the Prayer Wall
router.use("/kingdom-wins", kingdomWinsRouter); // Kingdom Wins / Testimonies — peer-authored "look what God has done" domain, independent from the Prayer Wall and Missions
router.use("/kingdom-stories", kingdomStoriesRouter); // Kingdom Stories — P2P-curated EDITORIAL content (Christian history/revival/missions/etc.), admin_content/super_admin write-gated, distinct from peer-authored Kingdom Wins
router.use("/search", searchRouter); // P2P Global Search — bounded, parallel, multi-domain search extending the existing Discover search field; reuses each domain's own visibility rules, never bypasses RLS
router.use("/sessions", sessionsRouter);
router.use("/discipleship", discipleshipRouter);
router.use("/notifications", notificationsRouter);
router.use("/admin", adminRouter);
router.use("/admin/evaluations", evaluationsRouter);
router.use("/registration", registrationRouter);
router.use("/translations", translationsRouter);
router.use("/bible", bibleRouter);
router.use("/circles", circlesRouter);
router.use("/pastoral-care", pastoralCareRouter);
router.use("/account", accountRouter);
router.use(callsRouter); // calls + break rooms (paths differ, handled internally)
router.use("/connections", connectionsRouter);
router.use("/feedback", feedbackRouter);
router.use(churchesRouter); // church + members + grove + cohorts + announcements (paths differ, handled internally)
router.use(churchCallsRouter); // Church Calls — live under /churches/:churchId/calls and /churches/calls/:callId (paths differ, handled internally)
router.use(churchStudiesRouter); // Custom Studies (Church) — live under /churches/:churchId/studies and /churches/studies/:studyId (paths differ, handled internally)
router.use(churchStudyPlansRouter); // Custom Study Plans (Church) — ordered arrangements of EXISTING p2p_lessons, live under /churches/:churchId/study-plans and /churches/study-plans/:planId (paths differ, handled internally)
router.use(contactRouter); // Contact P2P Global — peer messages + admin inbox (paths differ, handled internally)
router.use(officialMessagesRouter); // Admin → User official "P2P Global" messages (paths differ, handled internally)
router.use(pushRouter); // Push notification device-token registration (paths differ, handled internally)
router.use("/family", familyRouter);
router.use("/family", familyWorshipRouter); // worship sessions live under /family/worship/* (paths differ, handled internally)
router.use("/family", familyStudiesRouter); // Custom Studies (Family) — live under /family/:familyId/studies and /family/studies/:studyId (paths differ, handled internally)
router.use("/family", familyStudyPlansRouter); // Custom Study Plans (Family) — ordered arrangements of EXISTING p2p_lessons, live under /family/:familyId/study-plans, /family/study-plans/:planId, and /family/:familyId/study-source (paths differ, handled internally)
router.use(youtubeEmbedRouter); // GET /youtube-embed — real HTTPS-origin page for the mobile YouTube WebView (see file for why)

export default router;
