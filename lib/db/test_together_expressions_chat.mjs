// P2P Together Phase 4 — Expressions (reactions), Hand Up, Together Chat,
// and Guide moderation. "Reconnect" and "session ending" are already
// covered by the existing test_family_worship_e2e.mjs suite (host leave/
// rejoin, and the end-of-session assertions) — not duplicated here.
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

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  PASS: ${label}`); pass++; }
  else { console.log(`  FAIL: ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); fail++; }
}

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
  const email = `test-expr-${tag}-${stamp}@p2ptest.local`;
  const password = "TestPass123!";
  const { body: user } = await sb("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  await sb("/rest/v1/p2p_profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: user.id, email, full_name: tag, username: `expr${tag}${Math.floor(stamp)}` }) });
  const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON_KEY }, body: JSON.stringify({ email, password }) });
  const { access_token } = await signInRes.json();
  return { id: user.id, email, token: access_token };
}

async function run() {
  const shepherd = await makeUser("shep");
  const memberA = await makeUser("a");
  const memberB = await makeUser("b");

  const { body: family } = await api("/family", shepherd.token, { method: "POST", body: JSON.stringify({ name: "Expressions Family" }) });
  const { body: memberAProfile } = await sb(`/rest/v1/p2p_profiles?id=eq.${memberA.id}&select=username`);
  const inv = await api(`/family/${family.id}/invite`, shepherd.token, { method: "POST", body: JSON.stringify({ username: memberAProfile[0].username }) });
  await api(`/family/invitations/${inv.body.id}/respond`, memberA.token, { method: "POST", body: JSON.stringify({ action: "accept" }) });
  const { body: memberBProfile } = await sb(`/rest/v1/p2p_profiles?id=eq.${memberB.id}&select=username`);
  const invB = await api(`/family/${family.id}/invite`, shepherd.token, { method: "POST", body: JSON.stringify({ username: memberBProfile[0].username }) });
  await api(`/family/invitations/${invB.body.id}/respond`, memberB.token, { method: "POST", body: JSON.stringify({ action: "accept" }) });

  const { body: session } = await api("/family/worship/start", shepherd.token, { method: "POST", body: JSON.stringify({ familyId: family.id }) });
  await api(`/family/worship/sessions/${session.id}/join`, memberA.token, { method: "POST" });
  await api(`/family/worship/sessions/${session.id}/join`, memberB.token, { method: "POST" });
  console.log("Session:", session.id);

  // ── Expressions + Hand Up broadcast (two real, independently authenticated clients) ──
  const shepherdClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: shepherdSignIn } = await shepherdClient.auth.signInWithPassword({ email: shepherd.email, password: "TestPass123!" });
  shepherdClient.realtime.setAuth(shepherdSignIn.session.access_token);

  const memberClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: memberSignIn } = await memberClient.auth.signInWithPassword({ email: memberA.email, password: "TestPass123!" });
  memberClient.realtime.setAuth(memberSignIn.session.access_token);

  const topic = `family_worship_signal_${session.id}`;
  const receivedReactions = [];
  let receivedHandRaise = null;

  const recvChannel = memberClient.channel(topic, { config: { broadcast: { self: false }, private: true } });
  recvChannel
    .on("broadcast", { event: "reaction" }, ({ payload }) => receivedReactions.push(payload.emoji))
    .on("broadcast", { event: "hand_dismissed" }, ({ payload }) => { receivedHandRaise = `dismissed:${payload.userId}`; })
    .subscribe();

  const sendChannel = shepherdClient.channel(topic, { config: { broadcast: { self: false }, private: true } });
  await new Promise((resolve) => sendChannel.subscribe((status) => { if (status === "SUBSCRIBED") resolve(); }));
  await new Promise((res) => setTimeout(res, 2000));

  // Multiple reactions, back to back.
  for (const emoji of ["🙏", "❤️", "🔥"]) {
    await sendChannel.send({ type: "broadcast", event: "reaction", payload: { emoji } });
    await new Promise((res) => setTimeout(res, 300));
  }
  await new Promise((res) => setTimeout(res, 1500));
  check("all 3 reactions were received in order (Expressions broadcast, multiple reactions)", JSON.stringify(receivedReactions) === JSON.stringify(["🙏", "❤️", "🔥"]), receivedReactions);

  // Hand Up: Guide dismisses memberA's raised hand.
  await sendChannel.send({ type: "broadcast", event: "hand_dismissed", payload: { userId: memberA.id } });
  await new Promise((res) => setTimeout(res, 1500));
  check("Hand Up signal (Guide dismiss) is received", receivedHandRaise === `dismissed:${memberA.id}`, receivedHandRaise);

  await memberClient.removeChannel(recvChannel);
  await shepherdClient.removeChannel(sendChannel);

  // ── Together Chat: send, receive (history), persisted ──
  {
    const r = await api(`/family/worship/sessions/${session.id}/messages`, memberA.token, { method: "POST", body: JSON.stringify({ content: "Grateful to be here 🙏" }) });
    check("chat send succeeds and returns the persisted message", r.ok && r.body.content === "Grateful to be here 🙏" && r.body.authorName === "a", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/messages`, shepherd.token);
    check("chat receive: the Guide's GET sees memberA's message (persisted, not just broadcast-only)", r.ok && r.body.length === 1 && r.body[0].content === "Grateful to be here 🙏", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/messages`, memberA.token, { method: "POST", body: JSON.stringify({ content: "" }) });
    check("an empty chat message is rejected", !r.ok, r.body);
  }

  // ── Guide moderation: remove memberA, then confirm they're actually blocked ──
  {
    const r = await api(`/family/worship/sessions/${session.id}/remove`, memberA.token, { method: "POST", body: JSON.stringify({ userId: memberB.id }) });
    check("a non-Guide cannot remove anyone (server enforces authorization)", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/remove`, shepherd.token, { method: "POST", body: JSON.stringify({ userId: memberA.id }) });
    check("the Guide can remove a participant", r.ok, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/messages`, memberA.token, { method: "POST", body: JSON.stringify({ content: "can I still talk?" }) });
    check("a removed participant can no longer send chat messages (real enforcement, not cosmetic)", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/messages`, memberA.token);
    check("a removed participant can no longer read chat history", r.status === 403, r.body);
  }
  {
    // The realtime RLS layer (migration 122) independently enforces the same boundary.
    const removedClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    removedClient.realtime.setAuth(memberA.token);
    let subStatus = null;
    const ch = removedClient.channel(`removed_check_${session.id}`, { config: { broadcast: { self: false }, private: true } })
      .on("broadcast", { event: "reaction" }, () => {})
      .subscribe((status) => { subStatus = status; });
    await new Promise((res) => setTimeout(res, 2500));
    check("a removed participant's realtime subscription is rejected (RLS), not silently SUBSCRIBED", subStatus !== "SUBSCRIBED", subStatus);
    await removedClient.removeChannel(ch);
  }

  await sb(`/rest/v1/p2p_family_worship_messages?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_participants?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_sessions?id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_members?family_id=eq.${family.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_families?id=eq.${family.id}`, { method: "DELETE" });
  for (const u of [shepherd, memberA, memberB]) {
    await sb(`/rest/v1/p2p_profiles?id=eq.${u.id}`, { method: "DELETE" });
    await sb(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
  }
  console.log("cleaned up");
  console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}
run().catch((e) => { console.error("FATAL", e); process.exit(1); });