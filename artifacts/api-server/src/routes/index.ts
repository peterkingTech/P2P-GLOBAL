import { Router, type IRouter } from "express";
import healthRouter from "./health";
import profilesRouter from "./profiles";
import curriculumRouter from "./curriculum";
import progressRouter from "./progress";
import prayerRouter from "./prayer";
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
import contactRouter from "./contact";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/profiles", profilesRouter);
router.use(curriculumRouter); // curriculum + modules + lessons (paths differ, handled internally)
router.use("/progress", progressRouter);
router.use("/prayers", prayerRouter);
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
router.use(contactRouter); // Contact P2P Global — peer messages + admin inbox (paths differ, handled internally)

export default router;
