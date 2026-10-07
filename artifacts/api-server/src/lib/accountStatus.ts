import { supabaseServiceRole as db } from "./supabase";
import { logger } from "./logger";

// Account lifecycle (migration 173, p2p_account_status). No row = active.
// Only the API writes this table; clients can read their own row.

export type AccountStatus = "active" | "deactivated" | "deletion_scheduled" | "deleted";

export type AccountStatusRow = {
  user_id: string;
  status: AccountStatus;
  deactivated_at: string | null;
  deactivated_until: string | null;
  reactivated_at: string | null;
};

// A break whose end date has passed counts as active again — no job has to
// flip it at the deadline, and nothing stays suppressed by a stale row.
export function isEffectivelyDeactivated(row: Pick<AccountStatusRow, "status" | "deactivated_until"> | null | undefined): boolean {
  if (!row || row.status !== "deactivated") return false;
  return !row.deactivated_until || new Date(row.deactivated_until).getTime() > Date.now();
}

// Before migration 173 is applied the table doesn't exist; behave exactly as
// before it (everyone active) instead of failing whatever called us.
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /p2p_account_status/.test(error.message ?? ""));
}

export async function getAccountStatus(userId: string): Promise<AccountStatusRow | null> {
  const { data, error } = await db
    .from("p2p_account_status")
    .select("user_id, status, deactivated_at, deactivated_until, reactivated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data as AccountStatusRow | null) ?? null;
}

// Which of these users are currently on a break. Used to suppress their
// pushes and pastoral nudges. Fails open (empty set) on a read error, so a
// status-table problem can never stop notifications for everyone else.
export async function getDeactivatedUserIds(userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const { data, error } = await db
    .from("p2p_account_status")
    .select("user_id, status, deactivated_until")
    .in("user_id", userIds)
    .eq("status", "deactivated");
  if (error) {
    if (!isMissingTable(error)) logger.error({ err: error }, "accountStatus: failed to read deactivated users");
    return new Set();
  }
  return new Set(((data ?? []) as AccountStatusRow[]).filter(isEffectivelyDeactivated).map((r) => r.user_id));
}
