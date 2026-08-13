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

// Declined applications already have their file removed synchronously at
// decision time in admin.ts (the user gets an immediate "deleted" message in
// the decline confirmation) — this sweep only has real work to do for
// approved applications, whose file is kept 48h past the decision (in case a
// reviewer needs to revisit) via delete_after, set at approval time.
export async function cleanupVerificationFiles(): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;

  const { data: toDelete } = await db
    .from("p2p_verification_applications")
    .select("id, submission_path, user_id")
    .not("submission_path", "is", null)
    .not("delete_after", "is", null)
    .lt("delete_after", new Date().toISOString());

  for (const application of toDelete ?? []) {
    const path = application.submission_path as string;
    const { error: removeErr } = await db.storage.from("verification-submissions").remove([path]);
    if (removeErr) {
      failed++;
      continue;
    }
    await db.from("p2p_verification_applications").update({
      submission_path: null, submission_deleted_at: new Date().toISOString(),
    }).eq("id", application.id);
    deleted++;
  }

  return { deleted, failed };
}
