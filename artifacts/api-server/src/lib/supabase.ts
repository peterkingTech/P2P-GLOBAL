import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

// Use the SUPABASE_DB_URL if it's an HTTP URL, else fall back to env vars
const supabaseUrl =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : SUPABASE_URL;

export const supabase = createClient(supabaseUrl, SUPABASE_ANON_KEY);

// p2p_lesson_progress, p2p_modules, and several other tables' RLS policies
// are scoped to the `authenticated` role only (owner/auth checks via
// auth.uid()) — the anon client above carries no forwarded user session, so
// routes doing real data reads/writes need this instead, matching the
// service-role-for-server-reads pattern already used throughout this
// codebase (curriculum.ts's supabaseRead, calls.ts's supabaseWrite, etc.).
export const supabaseServiceRole = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
);

// Study Together C2 introduced this as a scoped exception to the rest of
// this API's "trust the caller-supplied id" pattern (see calls.ts):
// verifies a real Supabase session via its access token rather than
// trusting request.body/params. C7 needs the same real-identity guarantee
// for notification access, so this is promoted here to be shared rather
// than re-duplicated a third time.
export async function verifyCaller(req: import("express").Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
