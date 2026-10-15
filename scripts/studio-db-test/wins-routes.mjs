// End-to-end: the REAL Kingdom Wins API routes (routes/kingdomWins.ts) on the
// REAL migrations 150 + 151 + 152 + 188 + 189 in PGlite (lab.mjs). Reads use
// the service role as in production; every write runs AS the signed-in user.
// Auth is synthetic (token = user id). Proves the API cannot be used to skip
// the database rules (screening, roles, consent, restrictions).
//
// Not covered: real PostgREST/HTTP behaviour of Supabase, real JWTs.
//
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/wins-routes.mjs
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { U, buildWinsDb } from "./wins-setup.mjs";
import { bundleApp } from "./lab.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error("Set PGLITE_MODULE (see header)."); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

const db = await buildWinsDb(PGlite, { with188: true, with189: true });
const tmp = mkdtempSync(path.join(os.tmpdir(), "wins-routes-"));
const { app, setWinsTranslatorForTests } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
// Local stand-in for the AI translator: no network, no provider.
const translatorCalls = [];
setWinsTranslatorForTests(async (text) => {
  translatorCalls.push(text);
  if (text.includes("FALLA")) throw new Error("provider unavailable");
  if (text.includes("Envíame dinero")) return "A testimony Send me money to my Opay account for the crusade.";
  if (text.includes("tazama ushuhuda")) return "A testimony God healed me, watch my full testimony at www.example.com";
  return "A testimony God restored my family and now we serve together in the church.";
});
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${U[who]}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const post = (who, body) => call("POST", "/kingdom-wins", who, { entryType: "kingdom_win", title: "A testimony", category: "answered_prayer", status: "published", ...body });
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;

try {
  // ── A8 through the API ────────────────────────────────────────────────────
  const good = await post("P", { body: "I prayed and God healed my mother." });
  ok("11 API: ordinary testimony published immediately", good.status === 200 && good.body.status === "published" && good.body.heldForReview === false, show(good));
  const bad = await post("P", { body: "Buy now! 50% off anointing oil, use promo code FAITH" });
  ok("A8/3 API: advertising rejected server-side with a clear message", bad.status === 422 && /advertising/.test(bad.body.error) && bad.body.code === "wins_content_rejected", show(bad));
  const pay = await post("P", { body: "Send money to my c@sh app $blessedjoy" });
  ok("A8/3 API: payment instructions rejected (evasive spelling)", pay.status === 422 && /payment/.test(pay.body.error), show(pay));
  const held = await post("P", { body: "Watch my full testimony at www.example.com" });
  ok("A8/3 API: ambiguous post held for review (not published), author told", held.status === 200 && held.body.status === "submitted" && held.body.heldForReview === true
    && held.body.screeningCategories === undefined, show(held));
  const legit = await post("Q", { body: "A friend sent me a verse on WhatsApp the night I wanted to give up." });
  ok("A8/2 API: legitimate testimony mentioning WhatsApp is not held", legit.status === 200 && legit.body.status === "published", show(legit));

  // ── A8 translated screening through the API ───────────────────────────────
  const callsBefore = translatorCalls.length;
  const en = await post("Q", { body: "God provided a job for me this week." });
  ok("A8T API: English post is not sent to the translator", en.status === 200 && en.body.status === "published" && translatorCalls.length === callsBefore, show(en));
  const es = await post("P", { body: "Dios restauró mi familia y ahora servimos juntos en la iglesia." });
  ok("A8T API: Spanish post translated, screened and published immediately", es.status === 200 && es.body.status === "published" && translatorCalls.length === callsBefore + 1, show(es));
  ok("A8T API: the translator receives the post text only", /Dios restauró/.test(translatorCalls.at(-1)));
  const esBad = await post("P", { body: "Envíame dinero a mi cuenta de Opay para la cruzada." });
  ok("A8T API: payment request found via translation is rejected", esBad.status === 422 && /payment/.test(esBad.body.error), show(esBad));
  const down = await post("P", { body: "FALLA Gracias a Dios encontré trabajo después de un año difícil." });
  ok("A8T API: translator failure → held for a moderator (never published unchecked)", down.status === 200 && down.body.status === "submitted" && down.body.heldForReview === true, show(down));
  const sw = await post("P", { body: "Mungu ameniponya kutoka kwa ugonjwa wa muda mrefu, tazama ushuhuda wangu kamili" });
  ok("A8T API: link found via translation is held", sw.status === 200 && sw.body.heldForReview === true, show(sw));
  const qT = await call("GET", "/kingdom-wins/admin/queue?status=submitted", "M");
  ok("A8T API: moderators see the English translation and why it was held", qT.status === 200
    && qT.body.some((e) => e.id === sw.body.id && /www\.example\.com/.test(e.screeningTranslation ?? ""))
    && qT.body.some((e) => e.id === down.body.id && e.screeningCategories?.includes("translation")), show(qT));
  ok("A8T API: authors never see the translation or categories", sw.body.screeningTranslation === undefined && sw.body.screeningCategories === undefined);
  const edit = await call("PUT", `/kingdom-wins/${en.body.id}`, "Q", { body: "Dios restauró mi familia y ahora servimos juntos en la iglesia." });
  ok("A8T API: editing a live post into another language is translated and screened", edit.status === 200 && edit.body.status === "published", show(edit));
  // A member reports the (published) Spanish post, as the app does (RPC as the member).
  await db.exec(`set test.uid = '${U.Q}'; set role authenticated;`);
  const reportId = (await db.query(`select p2p_report_content('kingdom_win', $1, 'Please check') id`, [es.body.id])).rows[0].id;
  await db.exec("reset role; set test.uid = '';");
  const snap = (await db.query(`select content_snapshot from p2p_content_flags where id = $1`, [reportId])).rows[0]?.content_snapshot ?? "";
  ok("A8T API: a member's report of a non-English post shows moderators the English translation", /\[English translation\]\nA testimony God restored my family/.test(snap), snap.slice(0, 160));
  // Fail closed with no translator configured at all (no key, no stand-in).
  setWinsTranslatorForTests(null);
  delete process.env.ANTHROPIC_API_KEY;
  const noKey = await post("Q", { body: "Gracias a Dios mi hijo volvió a casa después de dos años." });
  ok("A8T API: no API key configured → held for a moderator, not published", noKey.status === 200 && noKey.body.status === "submitted" && noKey.body.heldForReview === true, show(noKey));

  // ── P2P Impact stays pending ──────────────────────────────────────────────
  const impPub = await post("P", { entryType: "p2p_impact", body: "God restored my family.", consentConfirmed: true });
  ok("10 API: P2P Impact cannot be published directly", impPub.status === 409 && /reviewed/.test(impPub.body.error), show(impPub));
  const imp = await post("P", { entryType: "p2p_impact", body: "God restored my family.", status: "submitted", consentConfirmed: true });
  ok("10 API: P2P Impact submitted with consent stays pending", imp.status === 200 && imp.body.status === "submitted", show(imp));
  const impNoConsent = await post("P", { entryType: "p2p_impact", body: "God restored my family.", status: "submitted" });
  ok("10 API: P2P Impact without consent refused", impNoConsent.status === 400 && /consent/.test(impNoConsent.body.error), show(impNoConsent));

  // ── Roles ─────────────────────────────────────────────────────────────────
  const win = good.body.id;
  for (const who of ["G", "L", "F"]) {
    ok(`6 API: ${who === "G" ? "peer_guide" : who === "L" ? "church_leader" : "admin_finance"} cannot edit another member's Win`, (await call("PUT", `/kingdom-wins/${win}`, who, { status: "removed" })).status === 403);
    ok(`6 API: same role cannot open the review queue`, (await call("GET", "/kingdom-wins/admin/queue", who)).status === 403);
    ok(`16 API: same role cannot restrict posting`, (await call("POST", "/kingdom-wins/admin/restrictions", who, { userId: U.P, reason: "Spam links" })).status === 403);
  }
  ok("6 API: member cannot open the review queue", (await call("GET", "/kingdom-wins/admin/queue", "Q")).status === 403);
  const draft = await post("P", { body: "Private notes.", status: "draft" });
  ok("9 API: peer_guide can no longer read another member's draft", (await call("GET", `/kingdom-wins/${draft.body.id}`, "G")).status === 404);
  ok("5 API: moderator can read it for review", (await call("GET", `/kingdom-wins/${draft.body.id}`, "O")).status === 200);
  const modEdit = await call("PUT", `/kingdom-wins/${win}`, "O", { title: "Edited by moderator" });
  ok("8 API: moderator cannot edit a member's content", modEdit.status === 403 && /status, not its content/.test(modEdit.body.error), show(modEdit));
  const queueM = await call("GET", "/kingdom-wins/admin/queue?status=submitted", "M");
  ok("7 API: admin_moderation queue shows the held post with its categories", queueM.status === 200 && queueM.body.some((e) => e.id === held.body.id && e.screeningCategories?.includes("link")), show(queueM));
  const queueA = await call("GET", "/kingdom-wins/admin/queue?status=submitted", "A");
  ok("10 API: admin_content queue shows P2P Impact only", queueA.status === 200 && queueA.body.length > 0 && queueA.body.every((e) => e.entryType === "p2p_impact"), show(queueA));
  const aHeld = await call("POST", `/kingdom-wins/${held.body.id}/moderate`, "A", { action: "approve" });
  ok("6 API: admin_content cannot release a screening hold on an ordinary post", aHeld.status === 403, show(aHeld));
  const aImp = await call("POST", `/kingdom-wins/${imp.body.id}/moderate`, "A", { action: "approve", note: "Thank you" });
  ok("10 API: admin_content approves P2P Impact (existing workflow kept)", aImp.status === 200 && aImp.body.status === "published", show(aImp));
  const mHeld = await call("POST", `/kingdom-wins/${held.body.id}/moderate`, "M", { action: "approve" });
  ok("7 API: admin_moderation releases the hold and publishes", mHeld.status === 200 && mHeld.body.status === "published" && mHeld.body.heldForReview === false, show(mHeld));
  ok("7 API: author notified of the decision", (await db.query(`select count(*)::int n from p2p_notifications where user_id = $1 and notification_type = 'kingdom_win_moderation'`, [U.P])).rows[0].n >= 1);
  ok("A10 API: moderation recorded in the admin activity log", (await db.query(`select count(*)::int n from p2p_admin_activity_log where admin_id = $1 and target_resource_id = $2`, [U.M, held.body.id])).rows[0].n === 1);

  // ── A13 restrictions through the API ──────────────────────────────────────
  const until = new Date(Date.now() + 7 * 86400e3).toISOString();
  const r = await call("POST", "/kingdom-wins/admin/restrictions", "O", { userId: U.P, reason: "Repeated advertising after warnings", expiresAt: until });
  ok("15 API: moderator restricts posting with reason + expiry", r.status === 200 && r.body.user_id === U.P && !!r.body.expires_at, show(r));
  const blocked = await post("P", { body: "God is good." });
  ok("17 API: restricted member cannot post (clear message, no reason leaked)", blocked.status === 403 && /posting restriction/.test(blocked.body.error) && !/advertising/i.test(blocked.body.error), show(blocked));
  let restrictedCalls = 0;
  setWinsTranslatorForTests(async () => { restrictedCalls++; return "A testimony God is good to me and my family always."; });
  const blockedEs = await post("P", { body: "Dios es bueno conmigo y con mi familia siempre." });
  ok("A13 API: restricted member's non-English post refused without paying for a translation", blockedEs.status === 403 && restrictedCalls === 0, show(blockedEs));
  setWinsTranslatorForTests(null);
  const st = await call("GET", "/kingdom-wins/me/posting-status", "P");
  ok("19 API: member sees restricted + until only", st.status === 200 && st.body.restricted === true && !!st.body.until && Object.keys(st.body).length === 2, show(st));
  const list = await call("GET", `/kingdom-wins/admin/restrictions?userId=${U.P}`, "V");
  ok("15 API: supervisor inspects restrictions", list.status === 200 && list.body.length === 1 && list.body[0].active === true, show(list));
  ok("16 API: restriction reason required", (await call("POST", "/kingdom-wins/admin/restrictions", "O", { userId: U.Q, reason: "" })).status === 400);
  ok("16 API: member cannot lift", (await call("POST", `/kingdom-wins/admin/restrictions/${r.body.id}/lift`, "P", { reason: "please" })).status === 403);
  const lifted = await call("POST", `/kingdom-wins/admin/restrictions/${r.body.id}/lift`, "M", { reason: "Appeal accepted" });
  ok("15 API: admin_moderation lifts with a reason", lifted.status === 200 && !!lifted.body.lifted_at, show(lifted));
  ok("18 API: member can post again", (await post("P", { body: "Thankful again." })).status === 200);

  // ── Own content + Stories untouched ───────────────────────────────────────
  ok("9 API: author deletes own post", (await call("DELETE", `/kingdom-wins/${draft.body.id}`, "P")).status === 200);
  ok("9 API: member cannot delete another's post", (await call("DELETE", `/kingdom-wins/${legit.body.id}`, "P")).status === 403);
  ok("13 API: members cannot reach Kingdom Stories admin", (await call("GET", "/kingdom-stories/admin/all", "P")).status >= 401);
  ok("13 API: Wins moderators cannot reach Kingdom Stories admin", [401, 403].includes((await call("POST", "/kingdom-stories", "M", { title: "x" })).status));
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  await db.close();
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
