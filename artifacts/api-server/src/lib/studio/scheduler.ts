// Publishing Studio — runs due scheduled jobs. Dependency-injected (no
// database or logger imports) so every path can be tested; the real wiring
// is in lib/studio/runtime.ts.
//
// The decisions that matter for safety live in the database (migration 188):
//   - p2p_studio_claim_due_jobs claims jobs atomically (FOR UPDATE SKIP
//     LOCKED), so two API instances never claim the same job;
//   - p2p_studio_run_job does the whole job in ONE transaction — approval and
//     content checks, the story change (through the publication-gate
//     trigger), the job's final status and the audit rows — and records
//     permanent refusals itself (not approved, content changed since
//     approval, story deleted, attempts exhausted);
//   - p2p_studio_finish_job records a retry or final failure, with its audit
//     row, when running the job raised an error (e.g. database unavailable).
// This module only decides WHEN to retry: capped exponential backoff with
// jitter, up to the job's max_attempts — never forever.

export type ScheduleRow = {
  id: string; item_id: string; action: "publish" | "unpublish" | "archive"; run_at: string;
  status: string; attempts: number; max_attempts: number;
  /** Issued by every claim; only this token can run or finish the job. */
  claim_token: string;
};
export type RunOutcome =
  | { outcome: "succeeded"; changed: boolean; nativeStatus: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "not_running" };

export interface SchedulerDeps {
  claim(limit: number): Promise<ScheduleRow[]>;
  /** One database transaction; throws only if the job could not be run at all.
   *  Returns not_running if the claim token is no longer current (stale worker). */
  runJob(scheduleId: string, claimToken: string): Promise<RunOutcome>;
  /** Records retry (pending + next attempt) or final failure, with its audit row;
   *  false if this worker no longer holds the claim. */
  finishJob(scheduleId: string, claimToken: string, retry: boolean, nextAttemptAt: string | null, error: string): Promise<boolean>;
  now(): number;
  random(): number;
  logger: { info(o: object, m: string): void; warn(o: object, m: string): void; error(o: object, m: string): void };
}

export const RETRY_BASE_MS = 60_000;
export const RETRY_MAX_MS = 60 * 60_000;

export function retryDelayMs(attempt: number, random: number): number {
  const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.5 + random * 0.5));
}

function shortError(e: unknown): string {
  return String((e as Error)?.message ?? e).slice(0, 500);
}

export type RunSummary = { claimed: number; succeeded: number; retried: number; failed: number; skipped: number };

export async function runDueJobs(deps: SchedulerDeps, limit = 20): Promise<RunSummary> {
  const summary: RunSummary = { claimed: 0, succeeded: 0, retried: 0, failed: 0, skipped: 0 };
  const jobs = await deps.claim(limit);
  summary.claimed = jobs.length;
  for (const job of jobs) {
    try {
      summary[await runOne(job, deps)]++;
    } catch (e) {
      // Even recording the retry failed (database unreachable). The job stays
      // 'running' and is re-claimed after the stale window; running it again
      // is safe because p2p_studio_run_job only acts on a job still 'running'.
      summary.failed++;
      deps.logger.error({ studio: "scheduler", scheduleId: job.id, reason: shortError(e) }, "studio: could not record job outcome");
    }
  }
  if (jobs.length) deps.logger.info({ studio: "scheduler", ...summary }, "studio: scheduled jobs processed");
  return summary;
}

async function runOne(job: ScheduleRow, deps: SchedulerDeps): Promise<"succeeded" | "retried" | "failed" | "skipped"> {
  let result: RunOutcome;
  try {
    result = await deps.runJob(job.id, job.claim_token);
  } catch (e) {
    // Nothing from the failed attempt was committed (single transaction).
    const reason = shortError(e);
    const retry = job.attempts < job.max_attempts;
    const next = retry ? new Date(deps.now() + retryDelayMs(job.attempts, deps.random())).toISOString() : null;
    await deps.finishJob(job.id, job.claim_token, retry, next, reason);
    deps.logger[retry ? "warn" : "error"]({ studio: "scheduler", scheduleId: job.id, jobAction: job.action, attempt: job.attempts, reason },
      retry ? "studio: job will retry" : "studio: job failed");
    return retry ? "retried" : "failed";
  }
  if (result.outcome === "succeeded") return "succeeded";
  if (result.outcome === "not_running") return "skipped"; // cancelled, finished, or claimed by another worker
  deps.logger.warn({ studio: "scheduler", scheduleId: job.id, jobAction: job.action, reason: result.reason }, "studio: job refused");
  return "failed";
}
