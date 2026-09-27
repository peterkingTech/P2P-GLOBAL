import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middleware/adminAuth";

const router: IRouter = Router();

const MAX_FIELD_LENGTH = 4000;

function truncate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…[truncated]` : value;
}

function shortString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 100) : undefined;
}

interface ClientErrorPayload {
  message: string | undefined;
  stack: string | undefined;
  componentStack: string | undefined;
  platform: string | undefined;
  osVersion: string | undefined;
  appVersion: string | undefined;
  buildNumber: string | undefined;
  tag: string | undefined;
  receivedAt: string;
}

// Temporary diagnostic sink for the TestFlight "Something went wrong" crash
// investigation (2026-09-27) — the mobile app's ErrorBoundary previously only
// console.error'd render exceptions, invisible on an external tester's
// device with no physical/Xcode access, and no crash-reporting service
// exists in this project. This surfaces the real error in this server's own
// logs (Railway) instead. Intentionally unauthenticated on the POST side — a
// crash can happen before any session exists — and intentionally NOT
// persisted to the database: this is a log sink for an active
// investigation, not a feature. Remove once the root cause is found and
// fixed (this file, its registration in routes/index.ts, and the
// `latestClientError` module state below).
//
// `latestClientError` — added because Railway's own log-search UI only
// surfaces Pino's formatted `msg` string, not the structured JSON fields
// logged alongside it, making the componentStack Pino DOES capture
// practically unreadable there. This is a single in-memory slot (last
// write wins, cleared on any redeploy/restart) purely so the full payload
// can be pulled back out via an admin-gated GET — not a queue, not
// persisted, not exposed without requireAdmin.
let latestClientError: ClientErrorPayload | null = null;

router.post("/client-errors", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const payload: ClientErrorPayload = {
    message: truncate(body.message),
    stack: truncate(body.stack),
    componentStack: truncate(body.componentStack),
    platform: shortString(body.platform),
    osVersion: shortString(body.osVersion),
    appVersion: shortString(body.appVersion),
    buildNumber: shortString(body.buildNumber),
    tag: shortString(body.tag),
    receivedAt: new Date().toISOString(),
  };
  latestClientError = payload;
  logger.warn(payload, "[client-error] Uncaught render error reported from device");
  res.status(204).end();
});

// Temporary — see file header. Admin-gated (same requireAdmin used
// throughout /admin/*) rather than inventing a new auth mechanism.
router.get("/client-errors/latest", requireAdmin, (_req, res) => {
  if (!latestClientError) {
    res.status(404).json({ error: "No client error reported yet since the last deploy/restart." });
    return;
  }
  res.json(latestClientError);
});

export default router;
