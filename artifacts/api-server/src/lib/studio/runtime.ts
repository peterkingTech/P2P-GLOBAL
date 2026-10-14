// Publishing Studio — real wiring of the scheduler to the database (service
// role) and logger. All Studio writes are database functions from migration
// 188, each one a single transaction that also appends the audit row.

import { supabaseServiceRole as db } from "../supabase";
import { logger } from "../logger";
import { runDueJobs, type RunOutcome, type RunSummary, type ScheduleRow, type SchedulerDeps } from "./scheduler";

/** True when the Studio objects do not exist yet (migration 188 not applied). */
export function isStudioNotInstalled(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42883" || error.code === "PGRST205" || error.code === "PGRST202") return true;
  return /p2p_studio_/.test(error.message ?? "") && /does not exist|could not find/i.test(error.message ?? "");
}

const deps: SchedulerDeps = {
  async claim(limit) {
    const { data, error } = await db.rpc("p2p_studio_claim_due_jobs", { p_limit: limit, p_stale_seconds: 600 });
    if (error) throw new Error(`claim failed: ${error.code ?? ""} ${error.message}`);
    return (data ?? []) as ScheduleRow[];
  },
  async runJob(scheduleId, claimToken) {
    const { data, error } = await db.rpc("p2p_studio_run_job", { p_schedule_id: scheduleId, p_claim_token: claimToken });
    if (error) throw new Error(`run failed: ${error.code ?? ""} ${error.message}`);
    return data as RunOutcome;
  },
  async finishJob(scheduleId, claimToken, retry, nextAttemptAt, err) {
    const { data, error } = await db.rpc("p2p_studio_finish_job", {
      p_schedule_id: scheduleId, p_claim_token: claimToken, p_retry: retry, p_next_attempt_at: nextAttemptAt, p_error: err,
    });
    if (error) throw new Error(`finish failed: ${error.code ?? ""} ${error.message}`);
    return data === true;
  },
  now: () => Date.now(),
  random: Math.random,
  logger,
};

let running = false;
/** Called by the cron in index.ts. Off unless STUDIO_SCHEDULER_ENABLED=true. */
export async function runStudioScheduler(): Promise<RunSummary | null> {
  if (process.env.STUDIO_SCHEDULER_ENABLED !== "true") return null;
  if (running) return null; // a slow run is never overlapped by the next tick
  running = true;
  try {
    return await runDueJobs(deps);
  } catch (err) {
    const e = err as { message?: string };
    logger.error({ studio: "scheduler", reason: String(e?.message ?? err).slice(0, 300) }, "studio: scheduler run failed");
    return null;
  } finally {
    running = false;
  }
}
