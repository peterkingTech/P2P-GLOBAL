import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

export async function computeReportStats(adminId: string, periodStart: string, periodEnd: string) {
  const { data: activity } = await db
    .from("p2p_admin_activity_log").select("action_type")
    .eq("admin_id", adminId).gte("created_at", periodStart).lte("created_at", periodEnd);
  const { data: feedback } = await db
    .from("p2p_admin_interaction_feedback").select("rating, submitted_at")
    .eq("admin_user_id", adminId).gte("submitted_at", periodStart).lte("submitted_at", periodEnd);

  const byAction: Record<string, number> = {};
  for (const a of activity ?? []) byAction[a.action_type as string] = (byAction[a.action_type as string] ?? 0) + 1;
  const ratings = (feedback ?? []).map((f) => f.rating).filter((r): r is number => r != null);

  return {
    totalActions: (activity ?? []).length,
    byAction,
    avgFeedbackRating: ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null,
    feedbackCount: ratings.length,
  };
}

function lastWeekRange(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now);
  end.setDate(now.getDate() - now.getDay()); // most recent Sunday
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// Sunday 20:00 UTC — creates an unsubmitted (submitted_at: null) report row
// per active admin for the week that just ended, pre-filled with real
// computed stats so the admin only has to add notes and submit.
export async function generateWeeklyReportDrafts(): Promise<{ created: number }> {
  const { start, end } = lastWeekRange();
  const { data: admins } = await db.from("p2p_profiles").select("id, role").neq("role", "student").eq("admin_is_active", true);
  let created = 0;

  for (const admin of admins ?? []) {
    const { data: existing } = await db
      .from("p2p_admin_reports").select("id")
      .eq("admin_id", admin.id).eq("report_period", "weekly").eq("period_start", start).maybeSingle();
    if (existing) continue;

    const stats = await computeReportStats(admin.id as string, start, end);
    await db.from("p2p_admin_reports").insert({
      admin_id: admin.id, admin_role: admin.role, report_period: "weekly",
      period_start: start, period_end: end, stats, submitted_at: null,
    });
    created++;
  }
  return { created };
}

export async function notifyAdminsToSubmitReports(): Promise<{ notified: number }> {
  const { start } = lastWeekRange();
  const { data: drafts } = await db
    .from("p2p_admin_reports").select("admin_id").eq("report_period", "weekly").eq("period_start", start).is("submitted_at", null);
  if (!drafts?.length) return { notified: 0 };

  await db.from("p2p_notifications").insert(
    drafts.map((d) => ({
      user_id: d.admin_id, title: "Your weekly report is ready for review",
      message: "Add your notes and submit by Monday.",
      notification_type: "admin_report_ready", data: {},
    }))
  );
  return { notified: drafts.length };
}

// Monday 09:00 UTC — any report drafted for last week that's still
// unsubmitted is overdue; notify supervisors/super admin once per admin.
export async function flagOverdueReports(): Promise<{ overdue: number }> {
  const { start } = lastWeekRange();
  const { data: overdue } = await db
    .from("p2p_admin_reports")
    .select("admin_id, p2p_profiles(full_name)")
    .eq("report_period", "weekly").eq("period_start", start).is("submitted_at", null);
  if (!overdue?.length) return { overdue: 0 };

  const { data: supervisors } = await db.from("p2p_profiles").select("id").in("role", ["super_admin", "admin_supervisor"]);
  if (supervisors?.length) {
    await db.from("p2p_notifications").insert(
      supervisors.flatMap((s) =>
        overdue.map((o) => ({
          user_id: s.id,
          title: "Overdue admin report",
          message: `${(o as any).p2p_profiles?.full_name ?? "An admin"} has not submitted their weekly report.`,
          notification_type: "admin_report_overdue", data: { adminId: o.admin_id },
        }))
      )
    );
  }
  return { overdue: overdue.length };
}

// Daily 08:00 UTC — a quick platform pulse for every super_admin.
export async function sendSuperAdminDailyDigest(): Promise<{ sent: number }> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count: actionsCount }, { count: openHelp }, { count: pendingVerification }, { count: unreviewedFlags }] = await Promise.all([
    db.from("p2p_admin_activity_log").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
    db.from("p2p_help_requests").select("id", { count: "exact", head: true }).neq("status", "resolved"),
    db.from("p2p_profiles").select("id", { count: "exact", head: true }).eq("verification_status", "pending"),
    db.from("p2p_content_flags").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const { data: superAdmins } = await db.from("p2p_profiles").select("id").eq("role", "super_admin");
  if (!superAdmins?.length) return { sent: 0 };

  await db.from("p2p_notifications").insert(
    superAdmins.map((s) => ({
      user_id: s.id, title: "Daily platform digest",
      message: `${actionsCount ?? 0} admin actions · ${openHelp ?? 0} open help requests · ${pendingVerification ?? 0} pending verifications · ${unreviewedFlags ?? 0} unreviewed flags`,
      notification_type: "super_admin_daily_digest",
      data: { actionsCount, openHelp, pendingVerification, unreviewedFlags },
    }))
  );
  return { sent: superAdmins.length };
}