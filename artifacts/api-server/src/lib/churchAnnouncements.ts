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

// Cron sweep (see index.ts) — flips scheduled church announcements to
// published once their publish_at has passed, and notifies members at that
// point (immediate-publish posts already notified at creation time in
// churches.ts; this is the only path scheduled posts take to notify).
export async function publishScheduledAnnouncements(): Promise<{ published: number }> {
  const nowIso = new Date().toISOString();
  const { data: due } = await db
    .from("p2p_church_announcements")
    .select("id, church_id, title, body, author_id")
    .eq("status", "scheduled")
    .lte("publish_at", nowIso);

  let published = 0;
  for (const a of due ?? []) {
    const { error } = await db
      .from("p2p_church_announcements")
      .update({ status: "published", updated_at: nowIso })
      .eq("id", a.id as string).eq("status", "scheduled");
    if (error) continue;
    published++;

    const { data: members } = await db
      .from("p2p_church_members")
      .select("user_id")
      .eq("church_id", a.church_id as string).eq("is_active", true);
    const recipientIds = (members ?? []).map((m) => m.user_id as string).filter((id) => id !== a.author_id);
    if (recipientIds.length) {
      await db.from("p2p_notifications").insert(
        recipientIds.map((id) => ({
          user_id: id, title: `📢 ${a.title}`, message: a.body,
          notification_type: "church_announcement", data: { churchId: a.church_id, announcementId: a.id },
        }))
      );
    }
  }
  return { published };
}