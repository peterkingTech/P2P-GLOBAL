// P2P Together Phase 5 — Media Permissions, Media Shelf (queue), and
// stale-client protection. "Guide leaving" and "Guide transfer" are
// already covered by test_family_worship_e2e.mjs — not duplicated here.
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
  const email = `test-p5-${tag}-${stamp}@p2ptest.local`;
  const password = "TestPass123!";
  const { body: user } = await sb("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  await sb("/rest/v1/p2p_profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: user.id, email, full_name: tag, username: `p5${tag}${Math.floor(stamp)}` }) });
  const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON_KEY }, body: JSON.stringify({ email, password }) });
  const { access_token } = await signInRes.json();
  return { id: user.id, email, token: access_token };
}
async function invite(familyId, guideToken, userId, userToken) {
  const { body: profile } = await sb(`/rest/v1/p2p_profiles?id=eq.${userId}&select=username`);
  const inv = await api(`/family/${familyId}/invite`, guideToken, { method: "POST", body: JSON.stringify({ username: profile[0].username }) });
  await api(`/family/invitations/${inv.body.id}/respond`, userToken, { method: "POST", body: JSON.stringify({ action: "accept" }) });
}

async function run() {
  const guide = await makeUser("guide");
  const trusted = await makeUser("trusted");
  const regular = await makeUser("regular");

  const { body: family } = await api("/family", guide.token, { method: "POST", body: JSON.stringify({ name: "Phase5 Family" }) });
  await invite(family.id, guide.token, trusted.id, trusted.token);
  await invite(family.id, guide.token, regular.id, regular.token);

  const { body: session } = await api("/family/worship/start", guide.token, { method: "POST", body: JSON.stringify({ familyId: family.id }) });
  await api(`/family/worship/sessions/${session.id}/join`, trusted.token, { method: "POST" });
  await api(`/family/worship/sessions/${session.id}/join`, regular.token, { method: "POST" });
  console.log("Session:", session.id, "default mediaPermission:", session.mediaPermission);

  console.log("\n=== Permission enforcement: guide_only (default) ===");
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, regular.token, { method: "PUT", body: JSON.stringify({ isPlaying: true }) });
    check("a regular Companion cannot control media under guide_only", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, {
      method: "PUT", body: JSON.stringify({ mediaProvider: "youtube", mediaId: "dQw4w9WgXcQ", mediaType: null, mediaUrl: null, isPlaying: true, positionMs: 0 }),
    });
    check("the Guide can always control media", r.ok, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/media-permission`, regular.token, { method: "PUT", body: JSON.stringify({ mediaPermission: "everyone" }) });
    check("a non-Guide cannot change Media Permissions (server-enforced)", r.status === 403, r.body);
  }

  console.log("\n=== Permission enforcement: trusted tier ===");
  {
    const r = await api(`/family/worship/sessions/${session.id}/media-permission`, guide.token, { method: "PUT", body: JSON.stringify({ mediaPermission: "trusted" }) });
    check("the Guide sets mediaPermission to trusted", r.ok && r.body.mediaPermission === "trusted", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, trusted.token, { method: "PUT", body: JSON.stringify({ isPlaying: false }) });
    check("an untrusted Companion still cannot control media under 'trusted' tier (not yet added)", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/trusted`, guide.token, { method: "POST", body: JSON.stringify({ userId: trusted.id, trusted: true }) });
    check("the Guide adds a trusted Companion", r.ok && r.body.trustedUserIds.includes(trusted.id), r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, trusted.token, { method: "PUT", body: JSON.stringify({ isPlaying: false }) });
    check("a now-trusted Companion CAN control media", r.ok, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, regular.token, { method: "PUT", body: JSON.stringify({ isPlaying: true }) });
    check("a still-untrusted Companion is still rejected under 'trusted' tier", r.status === 403, r.body);
  }
  {
    // currentMode changes stay Guide-only even for a trusted participant.
    const r = await api(`/family/worship/sessions/${session.id}/state`, trusted.token, { method: "PUT", body: JSON.stringify({ currentMode: "prayer" }) });
    check("a trusted (non-Guide) Companion cannot change the Gathering's mode", r.status === 403, r.body);
  }

  console.log("\n=== Stale clients: a permission change takes effect immediately, no cached leftover access ===");
  {
    await api(`/family/worship/sessions/${session.id}/media-permission`, guide.token, { method: "PUT", body: JSON.stringify({ mediaPermission: "everyone" }) });
    const r1 = await api(`/family/worship/sessions/${session.id}/state`, regular.token, { method: "PUT", body: JSON.stringify({ isPlaying: false }) });
    check("under 'everyone', a previously-rejected regular Companion can now control media", r1.ok, r1.body);

    await api(`/family/worship/sessions/${session.id}/media-permission`, guide.token, { method: "PUT", body: JSON.stringify({ mediaPermission: "guide_only" }) });
    const r2 = await api(`/family/worship/sessions/${session.id}/state`, regular.token, { method: "PUT", body: JSON.stringify({ isPlaying: true }) });
    check("reverting to guide_only immediately blocks that same Companion again (no stale/cached access)", r2.status === 403, r2.body);

    const r3 = await api(`/family/worship/sessions/${session.id}/state`, trusted.token, { method: "PUT", body: JSON.stringify({ isPlaying: true }) });
    check("a trusted Companion also loses control the instant the tier reverts to guide_only", r3.status === 403, r3.body);
  }

  console.log("\n=== Reconnect: GET reflects current state, not a stale snapshot ===");
  {
    await api(`/family/worship/sessions/${session.id}/media-permission`, guide.token, { method: "PUT", body: JSON.stringify({ mediaPermission: "everyone", autoAdvance: true }) });
    const r = await api(`/family/worship/sessions/${session.id}`, regular.token);
    check("a fresh GET (what reconnect calls) sees the just-changed permission and autoAdvance", r.body.mediaPermission === "everyone" && r.body.autoAdvance === true, r.body);
  }

  console.log("\n=== Media Shelf (queue) ===");
  {
    const r = await api(`/family/worship/sessions/${session.id}/queue`, regular.token, {
      method: "POST", body: JSON.stringify({ mediaProvider: "youtube", mediaId: "aaaaaaaaaaa", title: "Song A" }),
    });
    check("adding to the queue succeeds under 'everyone' (regular Companion)", r.ok && r.body.position === 0, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/queue`, trusted.token, {
      method: "POST", body: JSON.stringify({ mediaProvider: "youtube", mediaId: "bbbbbbbbbbb", title: "Song B" }),
    });
    check("a second item is appended at the next position", r.ok && r.body.position === 1, r.body);
  }
  let queueIds = [];
  {
    const r = await api(`/family/worship/sessions/${session.id}/queue`, guide.token);
    queueIds = r.body.map((i) => i.id);
    check("GET queue returns both items in order", r.ok && r.body.length === 2 && r.body[0].title === "Song A" && r.body[1].title === "Song B", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/queue/reorder`, guide.token, { method: "PUT", body: JSON.stringify({ orderedItemIds: [queueIds[1], queueIds[0]] }) });
    check("reorder puts Song B first", r.ok && r.body[0].title === "Song B", r.body);
  }
  {
    await api(`/family/worship/sessions/${session.id}/media-permission`, guide.token, { method: "PUT", body: JSON.stringify({ mediaPermission: "guide_only" }) });
    const r = await api(`/family/worship/sessions/${session.id}/queue`, regular.token, {
      method: "POST", body: JSON.stringify({ mediaProvider: "youtube", mediaId: "ccccccccccc" }),
    });
    check("under guide_only, a regular Companion can no longer add to the queue", r.status === 403, r.body);
  }
  {
    // But the person who added Song A can still remove their own suggestion.
    const r = await api(`/family/worship/sessions/${session.id}/queue/${queueIds[0]}`, regular.token, { method: "DELETE" });
    check("a Companion can remove their own queued item even without media-control permission", r.ok, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/queue/next`, guide.token, { method: "POST" });
    check("Play Next advances Song B into Shared Media and removes it from the queue", r.ok && r.body.mediaId === "bbbbbbbbbbb", r.body);
    const q = await api(`/family/worship/sessions/${session.id}/queue`, guide.token);
    check("the queue is now empty after Play Next consumed the only remaining item", q.body.length === 0, q.body);
  }

  await sb(`/rest/v1/p2p_family_worship_queue?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_participants?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_sessions?id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_members?family_id=eq.${family.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_families?id=eq.${family.id}`, { method: "DELETE" });
  for (const u of [guide, trusted, regular]) {
    await sb(`/rest/v1/p2p_profiles?id=eq.${u.id}`, { method: "DELETE" });
    await sb(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
  }
  console.log("cleaned up");
  console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}
run().catch((e) => { console.error("FATAL", e); process.exit(1); });