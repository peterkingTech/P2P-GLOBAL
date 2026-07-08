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
router.use("/registration", registrationRouter);

export default router;
