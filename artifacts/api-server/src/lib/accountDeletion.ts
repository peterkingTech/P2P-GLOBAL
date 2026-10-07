import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";
import { inLiveCallOrSession } from "./accountSafety";

// Permanent account deletion (migration 175). Approved policy: 14-day grace
// period with cancellation; shared content and other people's records are
// kept with the user's identity removed; leaders/staff are blocked.
//
// Flow:
//   request  → p2p_account_deletions row (scheduled_for = now + 14 days) and
//              p2p_account_status = deletion_scheduled; all sessions revoked.
//   cancel   → status back to active; the log row is marked cancelled.
//   job      → for each due, open log row, resumable steps:
//                1. capture the user's file list (saved on the log row)
//                2. p2p_purge_account(): blockers re-checked, then profile,
//                   login and every own record removed in ONE transaction
//                3. remove the saved files from Storage
//              Each step is marked on the log row, so a crash or error at any
//              point is simply retried from the first unfinished step, and a
//              finished deletion is never repeated.
//
// Switched off unless ACCOUNT_DELETION_ENABLED=true: requests are refused
// and the job does nothing. Cancelling always works.

export const DELETION_GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 10;
const STORAGE_REMOVE_CHUNK = 100;

export function isDeletionEnabled(): boolean {
  return process.env.ACCOUNT_DELETION_ENABLED === "true";
}

// Verification exception while the switch is off: throwaway QA accounts
// (p2p-sectest-…@example.com, a domain that cannot receive mail) can run
// the full flow against the deployed server. It only ever lets such an
// account delete ITSELF, so it grants nothing over anyone else. Remove once
// deletion is switched on for everyone.
const TEST_ACCOUNT_EMAIL = /^p2p-sectest-[a-z0-9-]+@example\.com$/;
export function isTestAccountEmail(email: string | null | undefined): boolean {
  return !!email && TEST_ACCOUNT_EMAIL.test(email);
}
export async function isDeletionAllowedFor(userId: string): Promise<boolean> {
  if (isDeletionEnabled()) return true;
  const { data } = await db.auth.admin.getUserById(userId);
  return isTestAccountEmail(data?.user?.email);
}

export type DeletionLogRow = {
  id: string;
  user_id: string;
  requested_at: string;
  scheduled_for: string;
  cancelled_at: string | null;
  db_purged_at: string | null;
  storage_purged_at: string | null;
  completed_at: string | null;
  attempts: number;
  last_error: string | null;
  summary: { storage?: { bucket_id: string; name: string }[]; purge?: unknown; test_account?: boolean } | null;
};

export async function getDeletionBlockers(userId: string): Promise<string[]> {
  const { data, error } = await db.rpc("p2p_account_deletion_blockers", { p_user: userId });
  if (error) throw new Error(`deletion blockers check failed: ${error.message}`);
  return (data as string[] | null) ?? [];
}

export async function getOpenDeletion(userId: string): Promise<DeletionLogRow | null> {
  const { data, error } = await db
    .from("p2p_account_deletions").select("*")
    .eq("user_id", userId).is("cancelled_at", null).is("completed_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as DeletionLogRow | null) ?? null;
}

// Schedules deletion for an already-authorised caller. Idempotent: an
// existing open request is returned unchanged.
export async function scheduleDeletion(userId: string, reasonCode: string | null, testAccount = false): Promise<DeletionLogRow> {
  const existing = await getOpenDeletion(userId);
  if (existing) return existing;

  const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * DAY_MS).toISOString();
  const { data: log, error: logErr } = await db
    .from("p2p_account_deletions")
    .insert({ user_id: userId, scheduled_for: scheduledFor, reason_code: reasonCode, summary: testAccount ? { test_account: true } : null })
    .select("*").single();
  if (logErr) {
    // Lost a race with a concurrent request: the unique open-row index won.
    const raced = await getOpenDeletion(userId);
    if (raced) return raced;
    throw logErr;
  }

  const now = new Date().toISOString();
  const { error: statusErr } = await db.from("p2p_account_status").upsert({
    user_id: userId, status: "deletion_scheduled", deletion_scheduled_for: scheduledFor,
    deactivated_at: null, deactivated_until: null, updated_at: now,
  }, { onConflict: "user_id" });
  if (statusErr) {
    // Undo the log row so nothing is scheduled without the matching status.
    await db.from("p2p_account_deletions").update({ cancelled_at: now, last_error: "status write failed" }).eq("id", (log as DeletionLogRow).id);
    throw statusErr;
  }
  return log as DeletionLogRow;
}

// Cancels an open request. Status first: the purge function only runs while
// status = deletion_scheduled (checked under a row lock), so once this write
// lands no purge can start, whatever happens to the log update after it.
export async function cancelDeletion(userId: string): Promise<"cancelled" | "nothing_to_cancel" | "too_late"> {
  const open = await getOpenDeletion(userId);
  if (!open) return "nothing_to_cancel";
  if (open.db_purged_at) return "too_late";
  const now = new Date().toISOString();
  const { data: updated, error } = await db.from("p2p_account_status")
    .update({ status: "active", deletion_scheduled_for: null, reactivated_at: now, updated_at: now })
    .eq("user_id", userId).eq("status", "deletion_scheduled")
    .select("user_id");
  if (error) throw error;
  if (!updated?.length) {
    // Status isn't deletion_scheduled any more (e.g. already purged).
    const again = await getOpenDeletion(userId);
    if (again?.db_purged_at) return "too_late";
  }
  await db.from("p2p_account_deletions").update({ cancelled_at: now }).eq("id", open.id).is("db_purged_at", null);
  return "cancelled";
}

async function markLog(id: string, patch: Partial<DeletionLogRow> & Record<string, unknown>): Promise<void> {
  const { error } = await db.from("p2p_account_deletions").update(patch).eq("id", id);
  if (error) throw new Error(`deletion log update failed: ${error.message}`);
}

// Removes the saved file list plus anything still under "<user id>/" in each
// user-content bucket. A missing file or bucket is not an error.
async function purgeStorage(userId: string, saved: { bucket_id: string; name: string }[]): Promise<number> {
  const byBucket = new Map<string, Set<string>>();
  for (const o of saved) {
    if (!byBucket.has(o.bucket_id)) byBucket.set(o.bucket_id, new Set());
    byBucket.get(o.bucket_id)!.add(o.name);
  }
  // Anything uploaded under the user's folder that the saved list missed.
  const { data: buckets } = await db.storage.listBuckets();
  for (const b of buckets ?? []) {
    const { data: items } = await db.storage.from(b.id).list(userId, { limit: 1000 });
    for (const it of items ?? []) {
      if (it.id) {
        if (!byBucket.has(b.id)) byBucket.set(b.id, new Set());
        byBucket.get(b.id)!.add(`${userId}/${it.name}`);
      }
    }
  }
  let removed = 0;
  for (const [bucket, names] of byBucket) {
    const list = [...names];
    for (let i = 0; i < list.length; i += STORAGE_REMOVE_CHUNK) {
      const { data, error } = await db.storage.from(bucket).remove(list.slice(i, i + STORAGE_REMOVE_CHUNK));
      if (error && !/not.?found/i.test(error.message)) throw new Error(`storage remove failed in ${bucket}: ${error.message}`);
      removed += data?.length ?? 0;
    }
  }
  return removed;
}

export type DeletionRunResult = "completed" | "already_completed" | "cancelled" | "postponed_active_call" | "blocked" | "failed";

// Runs (or resumes) one deletion. Safe to call any number of times.
export async function executeDeletion(logId: string): Promise<DeletionRunResult> {
  const { data: row, error } = await db.from("p2p_account_deletions").select("*").eq("id", logId).single();
  if (error || !row) return "failed";
  const log = row as DeletionLogRow;
  if (log.completed_at) return "already_completed";
  if (log.cancelled_at) return "cancelled";

  await markLog(log.id, { attempts: log.attempts + 1 });
  try {
    if (!log.db_purged_at) {
      // A cancellation that didn't reach the log still shows in the status.
      const { data: st } = await db.from("p2p_account_status").select("status").eq("user_id", log.user_id).maybeSingle();
      const { data: authUser } = await db.auth.admin.getUserById(log.user_id);
      if (authUser?.user && st?.status !== "deletion_scheduled") {
        await markLog(log.id, { cancelled_at: new Date().toISOString(), last_error: "status no longer deletion_scheduled" });
        return "cancelled";
      }
      if (authUser?.user && await inLiveCallOrSession(log.user_id)) {
        await markLog(log.id, { last_error: "postponed: user in a live call or session" });
        return "postponed_active_call";
      }
      // 1. File list, captured once and kept for retries.
      let storage = log.summary?.storage;
      if (!storage) {
        const { data: objs, error: sErr } = await db.rpc("p2p_account_storage_objects", { p_user: log.user_id });
        if (sErr) throw new Error(`storage listing failed: ${sErr.message}`);
        storage = (objs ?? []) as { bucket_id: string; name: string }[];
        await markLog(log.id, { summary: { ...(log.summary ?? {}), storage } });
        log.summary = { ...(log.summary ?? {}), storage };
      }
      // 2. Database purge — one transaction.
      const { data: purge, error: pErr } = await db.rpc("p2p_purge_account", { p_user: log.user_id });
      if (pErr) {
        const blocked = /ACCOUNT_DELETION_BLOCKED/.test(pErr.message);
        await markLog(log.id, { last_error: pErr.message.slice(0, 500) });
        return blocked ? "blocked" : "failed";
      }
      await markLog(log.id, { db_purged_at: new Date().toISOString(), summary: { ...(log.summary ?? {}), purge } });
    }
    // 3. Files.
    if (!log.storage_purged_at) {
      const removed = await purgeStorage(log.user_id, log.summary?.storage ?? []);
      await markLog(log.id, { storage_purged_at: new Date().toISOString() });
      logger.info({ logId: log.id, removed }, "account deletion: storage purged");
    }
    await markLog(log.id, { completed_at: new Date().toISOString(), last_error: null });
    return "completed";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markLog(log.id, { last_error: message.slice(0, 500) }).catch(() => {});
    logger.error({ err: e, logId: log.id }, "account deletion step failed; will retry");
    return "failed";
  }
}

// Cron entry point: due requests, plus any finished-in-the-database ones
// whose file cleanup still has to complete.
export async function processScheduledDeletions(): Promise<Record<DeletionRunResult, number>> {
  const out = { completed: 0, already_completed: 0, cancelled: 0, postponed_active_call: 0, blocked: 0, failed: 0 };
  const enabled = isDeletionEnabled();
  const { data, error } = await db
    .from("p2p_account_deletions").select("id, summary")
    .is("cancelled_at", null).is("completed_at", null)
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true }).limit(BATCH);
  if (error) {
    logger.error({ err: error }, "account deletion: failed to list due requests");
    return out;
  }
  for (const r of data ?? []) {
    // Switched off: only throwaway QA accounts are processed.
    if (!enabled && !(r.summary as DeletionLogRow["summary"])?.test_account) continue;
    out[await executeDeletion(r.id as string)] += 1;
  }
  return out;
}
