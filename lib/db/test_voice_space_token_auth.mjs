// Regression test for the family_worship_ branch added to POST
// /calls/token (calls.ts) for P2P Together Phase 3's Voice Space. Before
// this branch, ANY channelName not matching p2p_/circle_/room_ (including
// family_worship_*) fell through with no authorization check at all.
import { readFileSync } from "node:fs";

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
  const email = `test-voice-${tag}-${stamp}@p2ptest.local`;
  const password = "TestPass123!";
  const { body: user } = await sb("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  await sb("/rest/v1/p2p_profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: user.id, email, full_name: tag, username: `voice${tag}${Math.floor(stamp)}` }) });
  const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON_KEY }, body: JSON.stringify({ email, password }) });
  const { access_token } = await signInRes.json();
  return { id: user.id, email, token: access_token };
}
function rawToken(directCall) { return directCall; }

async function run() {
  const shepherd = await makeUser("shep");
  const outsider = await makeUser("out");

  const { body: family } = await api("/family", shepherd.token, { method: "POST", body: JSON.stringify({ name: "Voice Family" }) });
  const { body: session } = await api("/family/worship/start", shepherd.token, { method: "POST", body: JSON.stringify({ familyId: family.id }) });
  console.log("Session:", session.id, "channel:", session.channelName);

  // Shepherd (an active participant, auto-joined by /worship/start) requests a real token.
  {
    const r = await fetch(`${API}/calls/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName: session.channelName, uid: 12345, userId: shepherd.id }),
    });
    const body = await r.json();
    check("active participant (Guide) gets a real token", r.ok && !!body.token && body.appId, body);
  }

  // Outsider — never joined this family/session — must be rejected.
  {
    const r = await fetch(`${API}/calls/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName: session.channelName, uid: 99999, userId: outsider.id }),
    });
    const body = await r.json();
    check("outsider is rejected with 403, no token issued", r.status === 403 && !body.token, body);
  }

  // A participant who left is no longer authorized.
  {
    await api(`/family/worship/sessions/${session.id}/leave`, shepherd.token, { method: "POST" });
    const r = await fetch(`${API}/calls/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName: session.channelName, uid: 12345, userId: shepherd.id }),
    });
    const body = await r.json();
    check("a participant who left is rejected on a fresh token request", r.status === 403, body);
  }

  // Existing p2p_/circle_/room_ prefixes must be completely unaffected — a
  // channel name that doesn't match ANY known prefix should still be
  // rejected the same way it always was (untouched behavior), not silently
  // start requiring family_worship_-style auth.
  {
    const r = await fetch(`${API}/calls/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName: "some_unrelated_channel_name", uid: 1, userId: outsider.id }),
    });
    const body = await r.json();
    check("an unrelated, unprefixed channel name still gets a token unconditionally (unchanged pre-existing behavior)", r.ok && !!body.token, body);
  }

  await sb(`/rest/v1/p2p_family_worship_participants?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_sessions?id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_members?family_id=eq.${family.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_families?id=eq.${family.id}`, { method: "DELETE" });
  for (const u of [shepherd, outsider]) {
    await sb(`/rest/v1/p2p_profiles?id=eq.${u.id}`, { method: "DELETE" });
    await sb(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
  }
  console.log("cleaned up");
  console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}
run().catch((e) => { console.error("FATAL", e); process.exit(1); });