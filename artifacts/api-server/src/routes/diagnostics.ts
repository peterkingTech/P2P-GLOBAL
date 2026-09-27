import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MAX_FIELD_LENGTH = 4000;

function truncate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…[truncated]` : value;
}

function shortString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 100) : undefined;
}

// Temporary diagnostic sink for the TestFlight "Something went wrong" crash
// investigation (2026-09-27) — the mobile app's ErrorBoundary previously only
// console.error'd render exceptions, invisible on an external tester's
// device with no physical/Xcode access, and no crash-reporting service
// exists in this project. This surfaces the real error in this server's own
// logs (Railway) instead. Intentionally unauthenticated — a crash can happen
// before any session exists — and intentionally NOT persisted to the
// database: this is a log sink for an active investigation, not a feature.
// Remove once the root cause is found and fixed.
router.post("/client-errors", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  logger.warn(
    {
      message: truncate(body.message),
      stack: truncate(body.stack),
      componentStack: truncate(body.componentStack),
      platform: shortString(body.platform),
      osVersion: shortString(body.osVersion),
      appVersion: shortString(body.appVersion),
      buildNumber: shortString(body.buildNumber),
      tag: shortString(body.tag),
    },
    "[client-error] Uncaught render error reported from device"
  );
  res.status(204).end();
});

export default router;
