// One-time script — creates the four official P2P Global system accounts
// directly via the Supabase service role, bypassing the normal registration
// flow entirely (these are never meant to be signed into by a real person
// through the app's own login screen). Idempotent: safe to re-run, already-
// existing usernames are skipped.
//
// Usage:
//   pnpm exec tsx src/scripts/createOfficialAccounts.ts
// (matches this codebase's other one-off scripts — see translateCurriculum.ts
// — not `ts-node`, which isn't installed here)

// MUST be the first import — see _loadEnv.ts for why order matters here.
import "./_loadEnv.js";

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { validateUsername } from "../lib/username.js";

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set — check artifacts/api-server/.env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface OfficialAccountSpec {
  username: string;
  displayName: string;
  label: string;
  type: "crisis_response" | "announcement" | "support" | "general";
  bio: string;
  role: string;
}

// role: the spec this was written from asked for 'admin_help' (crisis) or
// 'admin' (others) — but p2p_profiles.role is a Postgres enum (migration
// 003), not free text, and 'admin' isn't one of its values. Of these four
// accounts, only the crisis one is ever actually routed through
// role-gated admin eligibility logic (p2p_start_direct_conversation,
// migrations 021/067/069), so it gets 'admin_help' exactly as asked. The
// other three are recognized as official purely via is_official_account
// (see the p2p_stamp_official_response trigger, migration 068) — leaving
// them at 'student' avoids handing real admin-panel access to a
// shared-password service account with no functional need for it.
const OFFICIAL_ACCOUNTS: OfficialAccountSpec[] = [
  {
    username: "p2p_crises_response",
    displayName: "P2P Global Crisis Response",
    label: "Official Crisis Response Team",
    type: "crisis_response",
    bio: "We are here for every member of this network. You are not alone.",
    role: "admin_help",
  },
  {
    username: "p2pglobal_announcement",
    displayName: "P2P Global",
    label: "Official P2P Global Announcements",
    type: "announcement",
    bio: "Official announcements from the P2P Global team.",
    role: "student",
  },
  {
    username: "support",
    displayName: "P2P Global Support",
    label: "Official P2P Global Support",
    type: "support",
    bio: "Here to help with any questions or issues.",
    role: "student",
  },
  {
    username: "p2pglobal",
    displayName: "P2P Global",
    label: "Official P2P Global Account",
    type: "general",
    bio: "Building Systems that serve God's Kingdom — Matthew 6:33.",
    role: "student",
  },
];

function randomPassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

async function createOfficialAccount(spec: OfficialAccountSpec): Promise<void> {
  const { data: existing } = await supabase
    .from("p2p_profiles")
    .select("id")
    .eq("username", spec.username)
    .maybeSingle();
  if (existing) {
    console.log(`Skipping @${spec.username} — already exists`);
    return;
  }

  // p2pglobal_announcement is 22 characters — over this app's own 20-char
  // max (see lib/username.ts). Flagged, not blocked: these accounts bypass
  // normal registration on purpose, but a real user could never type this
  // username through the app's own username-setup screen, and any future
  // code path that calls validateUsername() against it will reject it.
  const validation = validateUsername(spec.username);
  if (!validation.valid) {
    console.warn(`  NOTE: @${spec.username} does not pass this app's own validateUsername() — ${validation.error}. Creating it anyway since this bypasses normal registration; flagging for your awareness.`);
  }

  const email = `${spec.username}@system.p2pglobal.internal`;
  const password = randomPassword();

  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: spec.displayName, is_official_account: true },
  });
  if (authErr || !authUser?.user) {
    console.error(`Failed to create auth user for @${spec.username}: ${authErr?.message ?? "unknown error"}`);
    return;
  }

  const { error: profileErr } = await supabase.from("p2p_profiles").insert({
    id: authUser.user.id,
    email,
    username: spec.username,
    full_name: spec.displayName,
    bio: spec.bio,
    role: spec.role,
    is_official_account: true,
    official_account_type: spec.type,
    official_account_label: spec.label,
    is_verified: true,
    verification_status: "approved",
    verification_badge_visible: true,
    grain_count: 0,
    username_changed_at: new Date().toISOString(),
  });
  if (profileErr) {
    console.error(`Created auth user for @${spec.username} but failed to create its profile: ${profileErr.message}`);
    // An orphaned auth user with no matching p2p_profiles row is worse than
    // no account at all — clean it up rather than leave a half-created account.
    await supabase.auth.admin.deleteUser(authUser.user.id);
    return;
  }

  console.log(`Created official account: @${spec.username}`);
}

async function main() {
  for (const spec of OFFICIAL_ACCOUNTS) {
    await createOfficialAccount(spec);
  }
}

main().catch((e) => {
  console.error("\nFATAL ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});