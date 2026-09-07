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

let passCount = 0, failCount = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  PASS: ${label}`); passCount++; }
  else { console.log(`  FAIL: ${label}${detail ? " — " + JSON.stringify(detail) : ""}`); failCount++; }
}

async function sb(path, opts = {}, key = SERVICE_KEY) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, ...(opts.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function createUser(email, password) {
  const { body } = await sb("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  return body.id;
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.access_token;
}

async function api(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function upsertProfile(id, email, fullName, username) {
  await sb("/rest/v1/p2p_profiles", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id, email, full_name: fullName, username }),
  });
}

const stamp = Date.now();
const users = {
  shepherd: { email: `test-shepherd-${stamp}@p2ptest.local`, password: "TestPass123!", username: `shepherd${stamp}` },
  memberA: { email: `test-membera-${stamp}@p2ptest.local`, password: "TestPass123!", username: `membera${stamp}` },
  memberB: { email: `test-memberb-${stamp}@p2ptest.local`, password: "TestPass123!", username: `memberb${stamp}` },
  outsider: { email: `test-outsider-${stamp}@p2ptest.local`, password: "TestPass123!", username: `outsider${stamp}` },
};

const created = { authIds: [], familyId: null, sessionId: null, prayerId: null };

async function cleanup() {
  console.log("\n=== Cleaning up test data ===");
  if (created.sessionId) {
    await sb(`/rest/v1/p2p_family_worship_participants?session_id=eq.${created.sessionId}`, { method: "DELETE" });
    await sb(`/rest/v1/p2p_family_worship_history?session_id=eq.${created.sessionId}`, { method: "DELETE" });
    await sb(`/rest/v1/p2p_family_worship_sessions?id=eq.${created.sessionId}`, { method: "DELETE" });
  }
  if (created.familyId) {
    await sb(`/rest/v1/p2p_family_journey_events?family_id=eq.${created.familyId}`, { method: "DELETE" });
    await sb(`/rest/v1/p2p_family_prayer_requests?family_id=eq.${created.familyId}`, { method: "DELETE" });
    await sb(`/rest/v1/p2p_family_invitations?family_id=eq.${created.familyId}`, { method: "DELETE" });
    await sb(`/rest/v1/p2p_family_members?family_id=eq.${created.familyId}`, { method: "DELETE" });
    await sb(`/rest/v1/p2p_families?id=eq.${created.familyId}`, { method: "DELETE" });
  }
  for (const id of created.authIds) {
    await sb(`/rest/v1/p2p_notifications?user_id=eq.${id}`, { method: "DELETE" });
    await sb(`/rest/v1/p2p_profiles?id=eq.${id}`, { method: "DELETE" });
    await sb(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  }
  console.log("cleaned up");
}

async function run() {
  console.log("=== Creating disposable test accounts ===");
  for (const key of Object.keys(users)) {
    const u = users[key];
    const id = await createUser(u.email, u.password);
    if (!id) throw new Error(`Failed to create user ${key}`);
    u.id = id;
    created.authIds.push(id);
    await upsertProfile(id, u.email, `Test ${key}`, u.username);
    u.token = await signIn(u.email, u.password);
    if (!u.token) throw new Error(`Failed to sign in ${key}`);
  }
  console.log("Accounts ready:", Object.keys(users).map((k) => `${k}=${users[k].id}`).join(", "));

  console.log("\n=== Family foundation ===");
  {
    const r = await api("/family", users.shepherd.token, { method: "POST", body: JSON.stringify({ name: "The Test Family" }) });
    check("shepherd creates family", r.ok, r.body);
    created.familyId = r.body.id;
  }
  {
    const r = await api(`/family/${created.familyId}/invite`, users.shepherd.token, { method: "POST", body: JSON.stringify({ username: users.memberA.username }) });
    check("shepherd invites memberA", r.ok, r.body);
    users.memberA.invitationId = r.body.id;
  }
  {
    const r = await api(`/family/${created.familyId}/invite`, users.shepherd.token, { method: "POST", body: JSON.stringify({ username: users.memberB.username }) });
    check("shepherd invites memberB", r.ok, r.body);
    users.memberB.invitationId = r.body.id;
  }
  {
    const r = await api(`/family/invitations/${users.memberA.invitationId}/respond`, users.memberA.token, { method: "POST", body: JSON.stringify({ action: "accept" }) });
    check("memberA accepts invitation", r.ok, r.body);
  }
  {
    const r = await api(`/family/invitations/${users.memberB.invitationId}/respond`, users.memberB.token, { method: "POST", body: JSON.stringify({ action: "accept" }) });
    check("memberB accepts invitation", r.ok, r.body);
  }
  {
    const r = await api("/family/mine", users.shepherd.token);
    check("roster has 3 active members", r.ok && r.body.members.length === 3, r.body);
  }
  {
    // Outsider must never be able to see this family's roster via their own /family/mine
    const r = await api("/family/mine", users.outsider.token);
    check("outsider sees no family", r.ok && r.body.family === null, r.body);
  }
  {
    // Double-accept / one-active-family-per-user should reject a 2nd invitation acceptance
    const r2 = await api(`/family/${created.familyId}/invite`, users.shepherd.token, { method: "POST", body: JSON.stringify({ username: users.memberA.username }) });
    check("re-inviting an already-active member is rejected", !r2.ok, r2.body);
  }

  console.log("\n=== Worship session lifecycle ===");
  {
    const r = await api("/family/worship/start", users.shepherd.token, { method: "POST", body: JSON.stringify({ familyId: created.familyId }) });
    check("shepherd starts worship", r.ok, r.body);
    created.sessionId = r.body.id;
    check("session host is shepherd", r.body.hostId === users.shepherd.id);
  }
  {
    const r = await sb(`/rest/v1/p2p_notifications?user_id=eq.${users.memberA.id}&notification_type=eq.family_worship_invite&select=id`);
    check("memberA got a family_worship_invite notification", r.ok && r.body.length >= 1, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${created.sessionId}/join`, users.memberA.token, { method: "POST" });
    check("memberA joins worship", r.ok, r.body);
  }
  {
    // Outsider (not a family member) must be rejected
    const r = await api(`/family/worship/sessions/${created.sessionId}`, users.outsider.token);
    check("outsider is rejected from viewing the session", r.status === 403, r.body);
  }
  {
    // Non-host cannot control playback
    const r = await api(`/family/worship/sessions/${created.sessionId}/state`, users.memberA.token, { method: "PUT", body: JSON.stringify({ isPlaying: true }) });
    check("non-host is rejected from controlling playback", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${created.sessionId}/state`, users.shepherd.token, {
      method: "PUT", body: JSON.stringify({ mediaType: "audio", mediaUrl: "https://example.com/test.mp3", isPlaying: true, positionMs: 0 }),
    });
    check("host sets media and plays", r.ok && r.body.isPlaying === true, r.body);
  }
  {
    // Shared Media / YouTube provider round-trip.
    const r = await api(`/family/worship/sessions/${created.sessionId}/state`, users.shepherd.token, {
      method: "PUT", body: JSON.stringify({ mediaProvider: "youtube", mediaId: "dQw4w9WgXcQ", mediaType: null, mediaUrl: null, isPlaying: true, positionMs: 0 }),
    });
    check("host sets a YouTube shared media item", r.ok && r.body.mediaProvider === "youtube" && r.body.mediaId === "dQw4w9WgXcQ", r.body);
    const g = await api(`/family/worship/sessions/${created.sessionId}`, users.shepherd.token);
    check("GET session reflects mediaProvider on read-back", g.body.mediaProvider === "youtube" && g.body.mediaId === "dQw4w9WgXcQ", g.body);
  }
  {
    const r = await api(`/family/worship/sessions/${created.sessionId}/state`, users.shepherd.token, {
      method: "PUT", body: JSON.stringify({ mediaProvider: "not_a_real_provider" }),
    });
    check("an invalid mediaProvider value is rejected", !r.ok, r.body);
  }

  console.log("Waiting 3s to simulate mid-playback late join...");
  await new Promise((res) => setTimeout(res, 3000));

  {
    // Late joiner (memberB) should sync to the current position, not 0.
    const r = await api(`/family/worship/sessions/${created.sessionId}/join`, users.memberB.token, { method: "POST" });
    const basePos = r.body.playbackBasePositionMs ?? 0;
    const baseTime = new Date(r.body.playbackBaseServerTime).getTime();
    const computedPos = r.body.isPlaying ? basePos + (Date.now() - baseTime) : basePos;
    check("late joiner computes a non-zero playback position (~3s in)", r.ok && computedPos > 1500, { computedPos, body: r.body });
  }
  {
    const r = await api(`/family/worship/sessions/${created.sessionId}/leave`, users.memberA.token, { method: "POST" });
    check("memberA leaves", r.ok, r.body);
    const s = await api(`/family/worship/sessions/${created.sessionId}`, users.shepherd.token);
    check("session stays active after one participant leaves (not collapsed)", s.body.status !== "ended", s.body);
  }
  {
    // Host "disconnects" (leaves) while memberB is still present — session must survive.
    const r = await api(`/family/worship/sessions/${created.sessionId}/leave`, users.shepherd.token, { method: "POST" });
    check("host leaves", r.ok, r.body);
    const s = await api(`/family/worship/sessions/${created.sessionId}`, users.memberB.token);
    check("session survives host disconnect (not destroyed)", s.body.status !== "ended", s.body);
  }
  {
    // Host reconnects (rejoins).
    const r = await api(`/family/worship/sessions/${created.sessionId}/join`, users.shepherd.token, { method: "POST" });
    check("host reconnects", r.ok, r.body);
  }
  {
    // Random outsider cannot be granted host via transfer.
    const r = await api(`/family/worship/sessions/${created.sessionId}/transfer-host`, users.shepherd.token, { method: "POST", body: JSON.stringify({ newHostId: users.outsider.id }) });
    check("transfer to a non-present user is rejected", !r.ok, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${created.sessionId}/transfer-host`, users.shepherd.token, { method: "POST", body: JSON.stringify({ newHostId: users.memberB.id }) });
    check("host transfers to present memberB", r.ok && r.body.hostId === users.memberB.id, r.body);
  }
  {
    // Old host (shepherd) can no longer control playback; new host can.
    const r1 = await api(`/family/worship/sessions/${created.sessionId}/state`, users.shepherd.token, { method: "PUT", body: JSON.stringify({ isPlaying: false }) });
    check("former host loses control after transfer", r1.status === 403, r1.body);
    const r2 = await api(`/family/worship/sessions/${created.sessionId}/state`, users.memberB.token, {
      method: "PUT", body: JSON.stringify({ currentMode: "scripture", currentScripture: { reference: "Psalm 23:1" } }),
    });
    check("new host controls mode + scripture sync", r2.ok && r2.body.currentMode === "scripture" && r2.body.currentScripture?.reference === "Psalm 23:1", r2.body);
  }

  console.log("\n=== Family prayer privacy ===");
  {
    const r = await api(`/family/${created.familyId}/prayer-requests`, users.memberA.token, {
      method: "POST", body: JSON.stringify({ content: "A private matter only I should see", visibility: "private" }),
    });
    check("memberA creates a private prayer request", r.ok, r.body);
    created.prayerId = r.body.id;
  }
  {
    const r = await api(`/family/${created.familyId}/prayer-requests`, users.shepherd.token);
    const leaked = (r.body ?? []).some((p) => p.id === created.prayerId);
    check("shepherd's shared prayer list does NOT include memberA's private request", r.ok && !leaked, r.body);
  }
  {
    const r = await api(`/family/${created.familyId}/prayer-requests`, users.memberA.token);
    const ownVisible = (r.body ?? []).some((p) => p.id === created.prayerId);
    check("memberA's own list DOES include their private request", r.ok && ownVisible, r.body);
  }

  console.log("\n=== Ending the session ===");
  {
    const r = await api(`/family/worship/sessions/${created.sessionId}/end`, users.memberB.token, { method: "POST" });
    check("current host ends the session", r.ok, r.body);
  }
  {
    const s = await sb(`/rest/v1/p2p_family_worship_sessions?id=eq.${created.sessionId}&select=status`);
    check("session row marked ended", s.body[0]?.status === "ended", s.body);
  }
  {
    const h = await sb(`/rest/v1/p2p_family_worship_history?session_id=eq.${created.sessionId}`);
    check("worship history summary row created", h.body.length === 1, h.body);
  }
  {
    const j = await sb(`/rest/v1/p2p_family_journey_events?family_id=eq.${created.familyId}&event_type=eq.worship_session_completed`);
    check("family journey event recorded", j.body.length >= 1, j.body);
  }
}

run()
  .catch((e) => { console.error("FATAL:", e); failCount++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== RESULTS: ${passCount} passed, ${failCount} failed ===`);
    process.exit(failCount > 0 ? 1 : 0);
  });