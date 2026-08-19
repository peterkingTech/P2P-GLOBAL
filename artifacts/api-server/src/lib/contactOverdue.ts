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

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Cron sweep (see index.ts) — anything still unread 24h after arriving gets
// flagged to super admins, grouped by department so the digest is scannable.
export async function flagOverdueContactMessages(): Promise<{ overdue: number; notified: number }> {
  const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString();

  const { data: overdueMessages } = await db
    .from("p2p_contact_messages")
    .select("id, reference_number, to_department, subject, created_at")
    .eq("status", "unread")
    .lt("created_at", cutoff);

  if (!overdueMessages || overdueMessages.length === 0) return { overdue: 0, notified: 0 };

  const byDepartment = new Map<string, number>();
  for (const m of overdueMessages) {
    byDepartment.set(m.to_department as string, (byDepartment.get(m.to_department as string) ?? 0) + 1);
  }
  const summary = [...byDepartment.entries()].map(([dept, count]) => `${count} ${dept.replace(/_/g, " ")}`).join(", ");

  const { data: superAdmins } = await db.from("p2p_profiles").select("id").eq("role", "super_admin");
  if (!superAdmins || superAdmins.length === 0) return { overdue: overdueMessages.length, notified: 0 };

  const notifications = superAdmins.map((admin) => ({
    user_id: admin.id,
    title: "Contact P2P Global — overdue messages",
    message: `${overdueMessages.length} message${overdueMessages.length === 1 ? " has" : "s have"} gone unread for 24+ hours: ${summary}.`,
    notification_type: "contact_message_overdue",
    data: { overdueCount: overdueMessages.length, byDepartment: Object.fromEntries(byDepartment) },
  }));
  await db.from("p2p_notifications").insert(notifications);

  return { overdue: overdueMessages.length, notified: superAdmins.length };
}