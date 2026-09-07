// P2P Together Phase 6 — Scripture mode: structured passage storage,
// the licensed POST /bible/passage endpoint, and Guide-only Scripture
// navigation (independent of Media Permissions tier).
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
  const email = `test-p6-${tag}-${stamp}@p2ptest.local`;
  const password = "TestPass123!";
  const { body: user } = await sb("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  await sb("/rest/v1/p2p_profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: user.id, email, full_name: tag, username: `p6${tag}${Math.floor(stamp)}` }) });
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
  console.log("=== POST /bible/passage — direct route checks ===");
  {
    const r = await api("/bible/passage", null, { method: "POST", body: JSON.stringify({ book: "Psalms", chapter: 23, startVerse: 1, endVerse: 3, translationCode: "KJV" }) });
    check("a valid passage request returns verse text for a licensed translation", r.ok && r.body.verses?.length === 3 && r.body.verses[0].text?.length > 0, r.body);
  }
  {
    const r = await api("/bible/passage", null, { method: "POST", body: JSON.stringify({ book: "Psalms", chapter: 23, startVerse: 1, translationCode: "NOT_A_REAL_CODE" }) });
    check("an unrecognized/unlicensed translation code is rejected, not silently served", r.status === 404, r.body);
  }
  {
    const r = await api("/bible/passage", null, { method: "POST", body: JSON.stringify({ book: "Psalms", chapter: 23, startVerse: 5, endVerse: 40, translationCode: "KJV" }) });
    check("a verse span over 30 verses is rejected", r.status === 400 && /30 verses/i.test(r.body.error ?? ""), r.body);
  }
  {
    const r = await api("/bible/passage", null, { method: "POST", body: JSON.stringify({ book: "Psalms", chapter: 23, startVerse: 5, endVerse: 2, translationCode: "KJV" }) });
    check("endVerse before startVerse is rejected", r.status === 400 && /endVerse/i.test(r.body.error ?? ""), r.body);
  }
  {
    const r = await api("/bible/passage", null, { method: "POST", body: JSON.stringify({ book: "Psalms", chapter: 23, translationCode: "KJV" }) });
    check("missing startVerse is rejected", r.status === 400, r.body);
  }

  console.log("\n=== Scripture navigation is Guide-only, independent of Media Permissions tier ===");
  const guide = await makeUser("guide");
  const trusted = await makeUser("trusted");
  const regular = await makeUser("regular");
  const { body: family } = await api("/family", guide.token, { method: "POST", body: JSON.stringify({ name: "Phase6 Family" }) });
  await invite(family.id, guide.token, trusted.id, trusted.token);
  await invite(family.id, guide.token, regular.id, regular.token);
  const { body: session } = await api("/family/worship/start", guide.token, { method: "POST", body: JSON.stringify({ familyId: family.id }) });
  await api(`/family/worship/sessions/${session.id}/join`, trusted.token, { method: "POST" });
  await api(`/family/worship/sessions/${session.id}/join`, regular.token, { method: "POST" });

  const scripture1 = { translation: "KJV", translationName: "King James Version", book: "John", chapter: 3, startVerse: 16, endVerse: 16 };
  const scripture2 = { translation: "KJV", translationName: "King James Version", book: "Psalms", chapter: 23, startVerse: 1, endVerse: 6 };

  {
    // mediaPermission defaults to guide_only, but Scripture selection isn't
    // gated by canControlMedia at all — it's Guide-only unconditionally.
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ currentMode: "scripture", currentScripture: scripture1 }) });
    check("the Guide selects an initial passage and mode together", r.ok && r.body.currentMode === "scripture" && r.body.currentScripture?.book === "John", r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, regular.token, { method: "PUT", body: JSON.stringify({ currentScripture: scripture2 }) });
    check("a regular Companion cannot navigate Scripture", r.status === 403, r.body);
  }
  {
    // Even after being elevated to "trusted" for MEDIA control, Scripture stays Guide-only.
    await api(`/family/worship/sessions/${session.id}/media-permission`, guide.token, { method: "PUT", body: JSON.stringify({ mediaPermission: "trusted" }) });
    await api(`/family/worship/sessions/${session.id}/trusted`, guide.token, { method: "POST", body: JSON.stringify({ userId: trusted.id, trusted: true }) });
    const r = await api(`/family/worship/sessions/${session.id}/state`, trusted.token, { method: "PUT", body: JSON.stringify({ currentScripture: scripture2 }) });
    check("a trusted Companion (media-control-eligible) still cannot navigate Scripture", r.status === 403, r.body);
  }
  {
    // Even under "everyone" media tier, Scripture stays Guide-only — the two permission surfaces are independent.
    await api(`/family/worship/sessions/${session.id}/media-permission`, guide.token, { method: "PUT", body: JSON.stringify({ mediaPermission: "everyone" }) });
    const r = await api(`/family/worship/sessions/${session.id}/state`, regular.token, { method: "PUT", body: JSON.stringify({ currentScripture: scripture2 }) });
    check("under 'everyone' media tier, a regular Companion still cannot navigate Scripture", r.status === 403, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ currentScripture: scripture2 }) });
    check("the Guide navigates to the next passage without also sending currentMode", r.ok && r.body.currentScripture?.book === "Psalms" && r.body.currentScripture?.startVerse === 1, r.body);
  }
  {
    // Malformed structured reference (missing required fields) is rejected server-side.
    const r = await api(`/family/worship/sessions/${session.id}/state`, guide.token, { method: "PUT", body: JSON.stringify({ currentScripture: { translation: "KJV" } }) });
    check("an incomplete currentScripture shape (missing book/chapter) is rejected", r.status === 400, r.body);
  }
  {
    const r = await api(`/family/worship/sessions/${session.id}`, regular.token);
    check("a fresh GET reflects the Guide's latest Scripture selection for every Companion", r.body.currentScripture?.book === "Psalms" && r.body.currentScripture?.chapter === 23, r.body);
  }

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
