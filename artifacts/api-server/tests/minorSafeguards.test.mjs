// Child/teen safeguards — API wiring the lab harness can't mount
// (calls.ts, profiles.ts, prayerCoordination.ts need native/agora deps):
// lib/minors.ts behaviour (incl. fail-closed) with a mocked db, plus source
// checks of each enforcement site. Route behaviour for Gathering media and
// search: scripts/studio-db-test/minor-routes.mjs; database rules:
// scripts/studio-db-test/migration198.mjs.
// Run: node tests/minorSafeguards.test.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const tmp = mkdtempSync(path.join(os.tmpdir(), "minor-safeguards-"));
try {
  const out = await build({
    entryPoints: [path.join(root, "src/lib/minors.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
    plugins: [{ name: "mock", setup(b) {
      b.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: "supabase", namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: "export const supabaseServiceRole = globalThis.__ms.db;" }));
    } }],
  });
  const state = { rows: [], error: null, calls: [] };
  globalThis.__ms = { db: { from(t) {
    const q = { t, f: [] };
    const c = { select() { return c; }, in(k, v) { q.f.push(["in", k, v]); return c; }, eq(k, v) { q.f.push(["eq", k, v]); return c; },
      then(res) { state.calls.push(q); return Promise.resolve(state.error ? { data: null, error: state.error } : { data: state.rows, error: null }).then(res); } };
    return c;
  } } };
  writeFileSync(path.join(tmp, "m.mjs"), out.outputFiles[0].text);
  const M = await import(pathToFileURL(path.join(tmp, "m.mjs")).href);

  state.rows = [{ user_id: "kid" }];
  const kids = await M.childUserIds(["a", "kid", "a", ""]);
  ok("childUserIds: only active 'child' roles, deduplicated query", kids.has("kid") && kids.size === 1
    && JSON.stringify(state.calls.at(-1).f) === JSON.stringify([["in", "user_id", ["a", "kid"]], ["eq", "status", "active"], ["eq", "role", "child"]]));
  const kept = await M.withoutChildren([{ id: "a" }, { id: "kid" }], (r) => r.id);
  ok("withoutChildren removes children, keeps everyone else", kept.length === 1 && kept[0].id === "a");
  state.error = { message: "timeout" };
  ok("lookup failure → everyone hidden (fail closed)", (await M.withoutChildren([{ id: "a" }, { id: "b" }], (r) => r.id)).length === 0);
  state.error = null;
  const before = state.calls.length;
  ok("no ids → no query", (await M.childUserIds([])).size === 0 && state.calls.length === before);
  ok("safeguardRefusal: recognises the database refusal and words it plainly",
    M.safeguardRefusal({ code: "42501", message: "P2P_MINOR_SAFEGUARD: children can only join their family and church circle" }) === "Children can only join their family and church circle."
    && M.safeguardRefusal({ message: "duplicate key" }) === null && M.safeguardRefusal(null) === null);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── Enforcement sites ─────────────────────────────────────────────────────
const calls = src("src/routes/calls.ts");
ok("calls/start: minor rule applies even inside an existing shared conversation", /rpc\("p2p_minor_contact_allowed", \{ p_a: callerId, p_b: recipientId \}\)/.test(calls)
  && /if \(!minorErr && minorOk === false\) \{[\s\S]{0,300}rpc\("p2p_can_contact_directly"[\s\S]{0,120}if \(!canContact\) return err\(res, "This call isn't available for this account\.", 403\);/.test(calls));
ok("calls/start: a failing check refuses (503) unless 198 isn't applied yet", /const missing = !!minorErr && \["PGRST202", "42883"\]\.includes/.test(calls) && /if \(minorErr && !missing\) return err\(res, "Couldn't start this call right now\. Please try again\.", 503\);/.test(calls));
ok("calls/start: the minor check runs after the existing authorisation (doesn't replace it)", calls.indexOf('return err(res, "Connect with this person first to start a call.", 403);') < calls.indexOf('rpc("p2p_minor_contact_allowed"'));
ok("call invitations: database refusal → 403", /if \(safeguardRefusal\(rpcErr\)\) return err\(res, "This person can't be added to this call\.", 403\);/.test(calls));
ok("break room join: never returns the channel when the join was refused", /const \{ error: joinErr \} = await supabaseWrite\.from\("p2p_break_room_participants"\)\.upsert\(/.test(calls)
  && /if \(joinErr\) \{ const refusal = safeguardRefusal\(joinErr\); return err\(res, refusal \?\? "Couldn't join this room", refusal \? 403 : 500\); \}/.test(calls)
  && calls.indexOf("if (joinErr)") < calls.indexOf("channelName: room.channel_name, speakingMode"));
const circles = src("src/routes/circles.ts");
ok("circle approval: a refused add puts the request back to pending (no fake 'approved')", /if \(addErr\) \{[\s\S]{0,200}from\("p2p_peer_circle_join_requests"\)\.update\(\{ status: "pending", responded_at: null, responded_by: null \}\)\.eq\("id", requestId\);[\s\S]{0,200}status\(refusal \? 403 : 500\)/.test(circles));
ok("circle add-by-username and create: refusal → 403", (circles.match(/status\(refusal \? 403 : 500\)/g) ?? []).length === 3);
ok("prayer invitations: refusal → 403", /if \(safeguardRefusal\(error\)\) return err\(res, "This person can't be invited\.", 403\);/.test(src("src/routes/prayerCoordination.ts")));
const profiles = src("src/routes/profiles.ts"), search = src("src/routes/search.ts");
ok("profile search (/profiles/search) filters children before responding", /results = await withoutChildren\(results, \(r\) => r\.id\);/.test(profiles));
ok("global search people filtered", /await withoutChildren\(matches\.filter/.test(search));
const worship = src("src/routes/familyWorship.ts");
ok("Gathering: every media-control site uses the child-aware check", (worship.match(/await canControlMediaFor\(session as Record<string, unknown>, userId\)/g) ?? []).length === 5
  && !/!canControlMedia\(session as Record/.test(worship) && /return data\?\.role !== "child";/.test(worship));

// ── Migration 198 shape ───────────────────────────────────────────────────
const m = readFileSync(path.join(root, "../../migrations/198_minor_safeguards.sql"), "utf8");
ok("198: helpers private (not callable by app users), callable by the API's service role",
  /revoke all on function public\.p2p_family_minor_role\(uuid\) from public, anon, authenticated;/.test(m) && /grant execute on function public\.p2p_minor_contact_allowed\(uuid, uuid\) to service_role;/.test(m));
ok("198: replaced functions keep their existing grants (CREATE OR REPLACE, no revoke)", !/revoke [^;]*p2p_can_contact_directly/i.test(m) && !/revoke [^;]*p2p_discover_peers/i.test(m));
ok("198: date-of-birth adult/minor rule untouched (p2p_start_direct_conversation not redefined)", !/function public\.p2p_start_direct_conversation/.test(m));
ok("198: triggers on every group/room/invitation table + messages", ["p2p_messages", "p2p_peer_circle_members", "p2p_group_members", "p2p_break_room_participants", "p2p_call_invitations", "p2p_prayer_coord_invitations", "p2p_peer_circles", "p2p_groups", "p2p_break_rooms"]
  .every((t) => new RegExp(`create trigger \\w+_000_minor_safeguard[\\s\\S]{0,120}on public\\.${t}\\b`).test(m)));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
