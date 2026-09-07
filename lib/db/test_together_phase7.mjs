// P2P Together Phase 7 — Prayer Space (focus, timer, participation,
// Scripture-linked requests), Conversation references (context on
// messages), Teaching mode, and the Shared/Private/Scripture-linked
// Notes architecture.
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
  const email = `test-p7-${tag}-${stamp}@p2ptest.local`;
  const password = "TestPass123!";
  const { body: user } = await sb("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  await sb("/rest/v1/p2p_profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: user.id, email, full_name: tag, username: `p7${tag}${Math.floor(stamp)}` }) });
  const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON_KEY }, body: JSON.stringify({ email, password }) });
  const { access_token } = await signInRes.json();
  return { id: user.id, email, token: access_token };
}
async function invite(familyId, guideToken, userId, userToken) {
  const { body: profile } = await sb(`/rest/v1/p2p_profiles?id=eq.${userId}&select=username`);
  const inv = await api(`/family/${familyId}/invite`, guideToken, { method: "POST", body: JSON.stringify({ username: profile[0].username }) });
  await api(`/family/invitations/${inv.body.id}/respond`, userToken, { method: "POST", body: JSON.stringify({ action: "accept" }) });
}

const KJV_JOHN_3_16 = { translation: "KJV", translationName: "King James Version", book: "John", chapter: 3, startVerse: 16, endVerse: 16 };

async function run() {
  const guide = await makeUser("guide");
  const regular = await makeUser("regular");
  const { body: family } = await api("/family", guide.token, { method: "POST", body: JSON.stringify({ name: "Phase7 Family" }) });
  await invite(family.id, guide.token, regular.id, regular.token);
  const { body: session } = await api("/family/worship/start", guide.token, { method: "POST", body: JSON.stringify({ familyId: family.id }) });
  await api(`/family/worship/sessions/${session.id}/join`, regular.token, { method: "POST" });

  console.log("=== Prayer Space: Scripture-linked requests ===");
  let sharedRequestId, privateRequestId;
  {
    const r = await api(`/family/${family.id}/prayer-requests`, regular.token, {
      method: "POST", body: JSON.stringify({ content: "For healing", visibility: "family", scriptureReference: KJV_JOHN_3_16 }),
    });
    sharedRequestId = r.body.id;
    check("a prayer request can carry a structured Scripture reference", r.ok && r.body.scripture_reference?.book === "John", r.body);
  }
  {
    const r = await api(`/family/${family.id}/prayer-requests`, regular.token, { method: "POST", body: JSON.stringify({ content: "Private matter", visibility: "private" }) });
    privateRequestId = r.body.id;
    check("a private prayer request is created", r.ok && r.body.visibility === "private", r.body);
  }

  console.log("\n=== Prayer Space: focus is Guide-only and never a private request ===");
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, regular.token, { method: "PUT", body: JSON.stringify({ focusPrayerRequestId: sharedRequestId }) });
    check("a non-Guide cannot focus a prayer request", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ focusPrayerRequestId: privateRequestId }) });
    check("the Guide cannot focus someone's PRIVATE prayer request", r.status === 400, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ focusPrayerRequestId: sharedRequestId }) });
    check("the Guide focuses a shared prayer request", r.ok && r.body.currentFocusPrayerRequestId === sharedRequestId, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}`, regular.token);
    check("a fresh GET reflects the focused request for every Companion", r.body.currentFocusPrayerRequestId === sharedRequestId, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ focusPrayerRequestId: null }) });
    check("the Guide clears the focus", r.ok && r.body.currentFocusPrayerRequestId === null, r.body);
  }

  console.log("\n=== Prayer Space: shared timer is Guide-only ===");
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, regular.token, { method: "PUT", body: JSON.stringify({ prayerTimerDurationSeconds: 120 }) });
    check("a non-Guide cannot start the Prayer Timer", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ prayerTimerDurationSeconds: 0 }) });
    check("a non-positive timer duration is rejected", r.status === 400, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ prayerTimerDurationSeconds: 120 }) });
    check("the Guide starts a 2-minute Prayer Timer", r.ok && r.body.prayerTimerDurationSeconds === 120 && !!r.body.prayerTimerStartedAt, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ prayerTimerDurationSeconds: null }) });
    check("the Guide stops the timer, clearing both fields", r.ok && r.body.prayerTimerDurationSeconds === null && r.body.prayerTimerStartedAt === null, r.body);
  }

  console.log("\n=== Prayer Space: participation via presence_status ===");
  {
    const r = await api(`/family/worship/sessions/${session.id}/presence`, regular.token, { method: "PUT", body: JSON.stringify({ presenceStatus: "praying" }) });
    check("a Companion marks themselves as praying", r.ok && r.body.presenceStatus === "praying", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/presence`, regular.token, { method: "PUT", body: JSON.stringify({ presenceStatus: "not_a_real_status" }) });
    check("an invalid presenceStatus is rejected", r.status === 400, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}`, guide.token);
    const me = r.body.participants.find((p) => p.user_id === regular.id);
    check("a fresh GET reflects the praying status for other participants", me?.presence_status === "praying", me);
  }

  console.log("\n=== Prayer Space: answering stays author-only ===");
  {
    const r = await api(`/family/${family.id}/prayer-requests/${sharedRequestId}/status`, guide.token, { method: "PUT", body: JSON.stringify({ status: "answered" }) });
    check("someone other than the requester cannot mark a request answered", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/${family.id}/prayer-requests/${sharedRequestId}/status`, regular.token, { method: "PUT", body: JSON.stringify({ status: "answered" }) });
    check("the requester CAN mark their own request answered", r.ok, r.body);
  }

  console.log("\n=== Conversation: Scripture/media/question references on messages ===");
  {
    const r = await api(`/family/worship/sessions/${session.id}/messages`, regular.token, { method: "POST", body: JSON.stringify({ content: "Look at this", context: { type: "scripture", ...KJV_JOHN_3_16 } }) });
    check("a message can attach a Scripture reference", r.ok && r.body.context?.type === "scripture" && r.body.context?.book === "John", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/messages`, regular.token, { method: "POST", body: JSON.stringify({ content: "Why did this happen?", context: { type: "question" } }) });
    check("a message can be tagged as a question", r.ok && r.body.context?.type === "question", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/messages`, regular.token, { method: "POST", body: JSON.stringify({ content: "bad", context: { type: "not_a_real_type" } }) });
    check("an unrecognized context.type is rejected", r.status === 400, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/messages`, guide.token);
    check("GET messages returns the context field on each message", r.ok && r.body.some((m) => m.context?.type === "scripture"), r.body.length);
  }

  console.log("\n=== Teaching mode ===");
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, regular.token, { method: "PUT", body: JSON.stringify({ currentMode: "teaching" }) });
    check("a non-Guide cannot switch the Gathering into Teaching mode", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ currentMode: "teaching" }) });
    check("the Guide switches the Gathering into Teaching mode", r.ok && r.body.currentMode === "teaching", r.body);
  }

  console.log("\n=== Notes: shared, private, Scripture-linked, author-only edit/delete ===");
  let sharedNoteId, privateNoteId;
  {
    const r = await api(`/family/worship/sessions/${session.id}/notes`, guide.token, { method: "POST", body: JSON.stringify({ content: "Key point for today", visibility: "shared", scriptureReference: KJV_JOHN_3_16 }) });
    sharedNoteId = r.body.id;
    check("the Guide creates a shared, Scripture-linked note", r.ok && r.body.visibility === "shared" && r.body.scriptureReference?.book === "John", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/notes`, regular.token, { method: "POST", body: JSON.stringify({ content: "My own reflection", visibility: "private" }) });
    privateNoteId = r.body.id;
    check("a Companion creates a private note", r.ok && r.body.visibility === "private", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/notes`, guide.token);
    const ids = r.body.map((n) => n.id);
    check("the shared note is visible to another participant", ids.includes(sharedNoteId), r.body);
    check("someone else's private note is NOT visible", !ids.includes(privateNoteId), r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/notes`, regular.token);
    const ids = r.body.map((n) => n.id);
    check("a participant's own private note IS visible to themselves", ids.includes(privateNoteId), r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/notes/${sharedNoteId}`, regular.token, { method: "DELETE" });
    check("only the author can delete a note", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/notes/${sharedNoteId}`, guide.token, { method: "DELETE" });
    check("the author deletes their own note", r.ok, r.body);
  }

  console.log("\n=== Session Summary: modest, non-sensitive additions ===");
  await api(`/family/worship/sessions/${session.id}/end`, guide.token, { method: "POST" });
  {
    const r = await api(`/family/worship/history?familyId=${family.id}`, guide.token);
    const entry = r.body.find((h) => h.session_id === session.id);
    check("history records prayer_request_count as a COUNT, not content", entry?.prayer_request_count === 2, entry);
    check("history records notes_count", entry?.notes_count === 1, entry);
  }

  await sb(`/rest/v1/p2p_family_worship_notes?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_messages?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_participants?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_history?session_id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_worship_sessions?id=eq.${session.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_prayer_requests?family_id=eq.${family.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_family_members?family_id=eq.${family.id}`, { method: "DELETE" });
  await sb(`/rest/v1/p2p_families?id=eq.${family.id}`, { method: "DELETE" });
  for (const u of [guide, regular]) {
    await sb(`/rest/v1/p2p_profiles?id=eq.${u.id}`, { method: "DELETE" });
    await sb(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
  }
  console.log("cleaned up");
  console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}
run().catch((e) => { console.error("FATAL", e); process.exit(1); });
