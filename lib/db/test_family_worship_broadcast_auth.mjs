// Regression test for migration 121's realtime.messages RLS policies on
// the family_worship_signal_* private broadcast topic. Two independently
// authenticated participants (not the service role) — a sender and a
// receiver, both real active session participants — confirming a
// broadcast actually crosses between them. This is the mechanism the
// worship room now relies on as its PRIMARY session-state-sync path
// (postgres_changes on p2p_family_worship_sessions does not currently
// deliver in production — see migration 120's comment and
// app/family/worship/[sessionId].tsx's broadcastState() comment for the
// full investigation), so this specific path must never silently regress.
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
const API = "http://127.0.0.1:5000/api";

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(opts.headers ?? {}) } });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}
async function api(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) } });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}
async function makeUser(tag) {
  const stamp = Date.now() + Math.random();
  const email = `test-bcast-${tag}-${stamp}@p2ptest.local`;
  const password = "TestPass123!";
  const { body: user } = await sb("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  await sb("/rest/v1/p2p_profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: user.id, email, full_name: tag, username: `bcast${tag}${Math.floor(stamp)}` }) });
  const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON_KEY }, body: JSON.stringify({ email, password }) });
  const { access_token } = await signInRes.json();
  return { id: user.id, email, token: access_token };
}

async function run() {
  const shepherd = await makeUser("shep");
  const member = await makeUser("mem");

  const { body: family } = await api("/family", shepherd.token, { method: "POST", body: JSON.stringify({ name: "Bcast Family" }) });
  const inv = await api(`/family/${family.id}/invite`, shepherd.token, { method: "POST", body: JSON.stringify({ username: member.email.split("@")[0].replace(/[^a-z0-9]/gi, "") }) });
  // fetch member's actual username since it was randomized above; simpler: query directly
  const { body: memberProfile } = await sb(`/rest/v1/p2p_profiles?id=eq.${member.id}&select=username`);
  const inv2 = await api(`/family/${family.id}/invite`, shepherd.token, { method: "POST", body: JSON.stringify({ username: memberProfile[0].username }) });
  console.log("Invite result:", inv2.ok, inv2.body);
  const acc = await api(`/family/invitations/${inv2.body.id}/respond`, member.token, { method: "POST", body: JSON.stringify({ action: "accept" }) });
  console.log("Accept result:", acc.ok, acc.body);

  const { body: session } = await api("/family/worship/start", shepherd.token, { method: "POST", body: JSON.stringify({ familyId: family.id }) });
  console.log("Session:", session.id);
  const join = await api(`/family/worship/sessions/${session.id}/join`, member.token, { method: "POST" });
  console.log("Member joined:", join.ok);

  const senderClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  senderClient.realtime.setAuth(shepherd.token);
  const receiverClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  receiverClient.realtime.setAuth(member.token);

  let received = null;
  const topic = `family_worship_signal_${session.id}`;
  const recvChannel = receiverClient.channel(topic, { config: { broadcast: { self: false }, private: true } });
  recvChannel.on("broadcast", { event: "state" }, ({ payload }) => {
    console.log(">>> RECEIVER got broadcast:", JSON.stringify(payload));
    received = payload;
  }).subscribe((status, err) => console.log(">>> Receiver subscribe status:", status, err ? `err: ${err.message ?? err}` : ""));

  const sendChannel = senderClient.channel(topic, { config: { broadcast: { self: false }, private: true } });
  await new Promise((resolve) => {
    sendChannel.subscribe((status, err) => {
      console.log(">>> Sender subscribe status:", status, err ? `err: ${err.message ?? err}` : "");
      if (status === "SUBSCRIBED") resolve();
    });
  });

  await new Promise((res) => setTimeout(res, 2000));
  console.log("Sending broadcast...");
  await sendChannel.send({ type: "broadcast", event: "state", payload: { hello: "world", isPlaying: true } });

  await new Promise((res) => setTimeout(res, 3000));
  console.log("Final received:", received);

  await receiverClient.removeChannel(recvChannel);
  await senderClient.removeChannel(sendChannel);

  await sb(`/rest/v1/p2p_family_worship_participants?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_sessions?id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_members?family_id=eq.${family.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_families?id=eq.${family.id}`, { method: "DELETE" });
  for (const u of [shepherd, member]) {
    await sb(`/rest/v1/p2p_profiles?id=eq.${u.id}`, { method: "DELETE" });
    await sb(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
  }
  console.log("cleaned up");
  process.exit(received ? 0 : 1);
}
run().catch((e) => { console.error("FATAL", e); process.exit(1); });