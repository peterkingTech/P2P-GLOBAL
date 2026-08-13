import cron from "node-cron";
import app from "./app";
import { logger } from "./lib/logger";
import { detectInactiveUsers, escalateCrisisCalls } from "./lib/pastoralCare";
import { sweepBreakRooms } from "./lib/breakRooms";
import { cleanupVerificationFiles } from "./lib/verificationCleanup";

// Translation calls fail silently into an English fallback (see
// curriculum.ts's GET /lessons/:lessonId) by design — a missing key would
// otherwise go unnoticed until a user happens to trigger a translation.
// This just makes that state visible in the deploy logs at startup.
if (process.env.ANTHROPIC_API_KEY) {
  logger.info("ANTHROPIC_API_KEY is set — translation engine ready");
} else {
  logger.warn("ANTHROPIC_API_KEY is not set — all translations will fall back to English");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Elijah Protocol + Dormant Seed pastoral care — daily inactivity scan.
cron.schedule("0 6 * * *", async () => {
  logger.info("Running pastoral care check...");
  try {
    const result = await detectInactiveUsers();
    logger.info(result, "Pastoral care check complete");
  } catch (err) {
    logger.error({ err }, "Pastoral care check failed");
  }
});

// Break Rooms — auto-end rooms past the 3 hour cap or abandoned by their
// host for 5+ minutes. Runs every 5 minutes since that's the finer of the
// two thresholds this sweep enforces.
cron.schedule("*/5 * * * *", async () => {
  try {
    const result = await sweepBreakRooms();
    if (result.endedForTimeLimit || result.endedForAbandonment) {
      logger.info(result, "Break Rooms sweep ended rooms");
    }
  } catch (err) {
    logger.error({ err }, "Break Rooms sweep failed");
  }
});

// Crisis calls — escalate anything still ringing after 5 minutes. Runs every
// minute since that threshold is exact, not a coarse cap like the sweeps above.
cron.schedule("*/1 * * * *", async () => {
  try {
    const result = await escalateCrisisCalls();
    if (result.escalated) {
      logger.warn(result, "Crisis calls escalated to church admin");
    }
  } catch (err) {
    logger.error({ err }, "Crisis call escalation sweep failed");
  }
});

// Identity verification — delete approved applicants' submitted selfie/video
// once their 48h post-decision retention window has passed.
cron.schedule("0 */6 * * *", async () => {
  try {
    const result = await cleanupVerificationFiles();
    if (result.deleted || result.failed) {
      logger.info(result, "Verification file cleanup complete");
    }
  } catch (err) {
    logger.error({ err }, "Verification file cleanup failed");
  }
});
