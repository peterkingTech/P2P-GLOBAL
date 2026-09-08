// Real-device call forensic audit (Priority 1) — direct test of whether
// Supabase postgres_changes actually delivers INSERT events on
// p2p_incoming_calls, the exact mechanism app/contexts/DataContext.tsx
// relies on for incoming-call detection. This project has one prior,
// confirmed case (p2p_family_worship_sessions) where postgres_changes did
// NOT deliver in production despite correct publication membership and
// RLS, with root cause never conclusively identified — this test checks
// whether p2p_incoming_calls has the same undiagnosed gap, using the real
// deployed production API (not local) so the call is created exactly the
// way the installed APK creates it.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = loadEnv(new URL("../../artifacts/api-server/.env", import.meta.url));
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.SUPABASE_ANON_KEY;
const PROD_API = "https://workspaceapi-server-production-6d56.up.railway.app/api";

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(opts.headers ?? {}) } });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}
async function api(path, token, opts = {}) {
  const res = await fetch(`${PROD_API}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) } });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}
async function makeUser(tag) {
  const stamp = Date.now() + Math.random();
  const email = `test-callrt-${tag}-${stamp}@p2ptest.local`;
  const password = "TestPass123!";
  const { body: user } = await sb("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  await sb("/rest/v1/p2p_profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: user.id, email, full_name: tag, username: `callrt${tag}${Math.floor(stamp)}` }) });
  const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON_KEY }, body: JSON.stringify({ email, password }) });
  const { access_token } = await signInRes.json();
  return { id: user.id, email, token: access_token };
}

async function run() {
  const caller = await makeUser("caller");
  const recipient = await makeUser("recipient");
  console.log("Caller:", caller.id, "Recipient:", recipient.id);

  // Mirrors DataContext.tsx's incoming-call subscription exactly: a
  // postgres_changes INSERT listener filtered to recipient_id=eq.<userId>,
  // no service-role bypass — this uses the recipient's own authenticated
  // client, same as the real app.
  const recipientClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  recipientClient.realtime.setAuth(recipient.token);

  let receivedRow = null;
  const channel = recipientClient
    .channel(`p2p_incoming_calls_${recipient.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "p2p_incoming_calls", filter: `recipient_id=eq.${recipient.id}` },
      (payload) => {
        console.log(">>> RECIPIENT received postgres_changes INSERT:", JSON.stringify(payload.new));
        receivedRow = payload.new;
      }
    );

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Subscription never reached SUBSCRIBED within 15s")), 15000);
    channel.subscribe((status, err) => {
      console.log(">>> Recipient subscribe status:", status, err ? `err: ${err.message ?? err}` : "");
      if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error(`Subscribe failed: ${status}`)); }
    });
  });

  // Give the subscription a moment to fully settle server-side before
  // creating the call, exactly the scenario a recipient who opened the
  // app slightly before being called would be in (the common case, not
  // the edge-of-race case migration 8430eb5's fallback-on-subscribe
  // already covers).
  await new Promise((res) => setTimeout(res, 3000));

  console.log("Placing real call via PRODUCTION API:", PROD_API);
  const channelName = `p2p_${[caller.id, recipient.id].sort().join("_")}`;
  const startRes = await api("/calls/start", caller.token, {
    method: "POST",
    body: JSON.stringify({ channelName, callType: "audio", recipientId: recipient.id }),
  });
  console.log("POST /calls/start result:", startRes.status, JSON.stringify(startRes.body));

  // Wait well beyond any reasonable realtime propagation delay.
  await new Promise((res) => setTimeout(res, 10000));
  console.log("Final receivedRow:", receivedRow ? JSON.stringify(receivedRow) : "NOTHING RECEIVED");

  // Fallback check: did the row actually get created server-side at all
  // (rules out "the call itself failed" vs "realtime specifically failed
  // to deliver an otherwise-real row").
  const { body: rows } = await sb(`/rest/v1/p2p_incoming_calls?recipient_id=eq.${recipient.id}&order=created_at.desc&limit=1`);
  console.log("Row actually exists in DB (service-role read):", JSON.stringify(rows));

  await recipientClient.removeChannel(channel);

  // Cleanup
  if (startRes.body?.incomingCallId) await sb(`/rest/v1/p2p_incoming_calls?id=eq.${startRes.body.incomingCallId}`, { method: "DELETE" });
  if (startRes.body?.callLogId) await sb(`/rest/v1/p2p_call_logs?id=eq.${startRes.body.callLogId}`, { method: "DELETE" });
  for (const u of [caller, recipient]) {
    await sb(`/rest/v1/p2p_profiles?id=eq.${u.id}`, { method: "DELETE" });
    await sb(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
  }
  console.log("cleaned up");

  console.log(`\n=== RESULT: realtime postgres_changes delivery ${receivedRow ? "SUCCEEDED" : "FAILED"} ===`);
  console.log(`=== RESULT: the row itself was ${rows?.length ? "CREATED in the database" : "NOT created"} ===`);
  process.exit(receivedRow ? 0 : 1);
}
run().catch((e) => { console.error("FATAL", e); process.exit(1); });
