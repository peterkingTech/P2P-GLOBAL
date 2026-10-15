// Migration 189 (Kingdom Wins safeguards) on the REAL migrations 150 + 151 +
// 152 (+ 188), as real Postgres roles: every member / moderator action runs
// as `authenticated` with auth.uid() set, never as a privileged client.
// The whole suite runs twice — with and without migration 188 — and the
// outcomes are compared, proving 188 changes nothing for Kingdom Wins.
//
// Covers: A8 screening (prohibited + legitimate corpus, evasions, holds),
// A9/A10 role allowlists and report resolution, A12 database-enforced
// ownership/status/consent/media rules, A13 posting restrictions, audit rows
// and atomicity. Not covered here: PostgREST/JWT handling (see staging) and
// the API layer (see wins-routes.mjs).
//
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/wins-moderation.mjs
import { pathToFileURL } from "node:url";
import { U, ROLE, buildWinsDb, as, brief } from "./wins-setup.mjs";

const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error("Set PGLITE_MODULE (see header)."); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const isErr = (r, re) => !!r.error && (!re || re.test(r.error));
const denied = (r, re) => isErr(r, re) || (!r.error && r.rows.length === 0);
const one = (r) => !r.error && r.rows.length === 1;

// ── A8 corpus ───────────────────────────────────────────────────────────────
const REJECT = [
  "Send money to my CashApp $blessedjoy and God will bless you",
  "Please donate to my ministry via PayPal today",
  "Invest with me: guaranteed returns, double your money in 7 days",
  "Buy now! 50% off anointing oil, use promo code FAITH",
  "Forex trading signals changed my life, earn $500 daily",
  "My account number is 0123456789 at GTBank, sow a seed",
  "send it to my c@sh app",                         // l33t evasion
  "p a y p a l me your seed offering",              // spaced letters
  "d.o.n.a.t.e now to support the crusade",         // dotted letters
  "Claim your prize: a processing fee of $50 is required",
  "pay​pal me for prayer",                     // zero-width character
  "Venmo me for prayer",
];
const HOLD = [
  "Watch my full testimony at www.example.com",
  "Call me on +234 803 123 4567 for prayer",
  "Email me at grace@example.org",
  "WhatsApp me if you need prayer",
  "We are fundraising for a new church roof",
  "Follow my page for more testimonies",
  "God blessed my business; now I sell fabrics in the market",
];
const ALLOW = [
  "I prayed for healing and God healed my mother. Praise God!",
  "After losing my job, a friend paid my rent for three months. God provided.",
  "I gave my tithe faithfully even when money was tight, and God provided for us.",
  "I was addicted to gambling and drugs; Jesus set me free in 2015.",
  "I used to sell drugs on the street; now I serve at church every Sunday.",
  "Psalm 23:1-6 carried me through 3 surgeries in 2019 and 2020.",
  "Someone donated blood that saved my life after the accident.",
  "I won the battle against depression through prayer and community.",
  "God told me to give to the poor from my bank account, and joy followed.",
  "My business was failing but God gave me wisdom and it recovered.",
  "I was scammed and lost my savings, but God restored my peace.",
  "A friend sent me a verse on WhatsApp the night I wanted to give up.",
  "Our church gave food to 40 families in need at Christmas.",
  "God called me to ministry and I have served for 14 years.",
  "You won't believe how God turned my marriage around!",
  "I was in debt of $5,000 and God cleared it within a year.",
];

async function suite(db, with188) {
  const out = {};
  const rec = (k, v) => { out[k] = v; return v; };
  const screen = async (t) => (await db.query(`select p2p_kingdom_win_screen($1) r`, [t])).rows[0].r;
  const ins = (who, o = {}) => as(db, who,
    `insert into p2p_kingdom_wins (id, author_id, entry_type, title, body, category, status, consent_confirmed_at, media_type, media_path, published_at, moderation_note, moderation_hold)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, 'answered_prayer', $6, $7, $8, $9, $10, $11, $12)
     returning id, status, moderation_hold, published_at, submitted_at, consent_confirmed_at, moderation_note`,
    [o.id ?? null, o.author ?? U[who], o.type ?? "kingdom_win", o.title ?? "A testimony", o.body ?? "God healed me.", o.status ?? "published",
     o.consent ?? null, o.mediaType ?? null, o.mediaPath ?? null, o.publishedAt ?? null, o.note ?? null, o.hold ?? false]);
  const upd = (who, id, set, params = []) => as(db, who, `update p2p_kingdom_wins set ${set} where id = $1 returning id, status, moderation_hold, published_at`, [id, ...params]);
  const row = async (id) => (await db.query(`select * from p2p_kingdom_wins where id = $1`, [id])).rows[0];
  const flagFor = async (id) => (await db.query(`select * from p2p_content_flags where content_id = $1 order by created_at`, [id])).rows;
  const report = async (who, id) => (await as(db, who, `select p2p_report_content('kingdom_win', $1, 'Looks like an advert') id`, [id])).rows?.[0]?.id;
  const logs = async (action) => (await db.query(`select * from p2p_admin_activity_log where action_type = $1 order by created_at`, [action])).rows;
  const restrict = (who, user, reason = "Repeated advertising", expires = null) => as(db, who, `select p2p_wins_restrict_user($1, $2, $3) r`, [user, reason, expires]);
  const lift = (who, id, reason = "Appeal accepted") => as(db, who, `select p2p_wins_lift_restriction($1, $2) r`, [id, reason]);

  // ── Re-run safety ─────────────────────────────────────────────────────────
  const meta = (await db.query(`select (select count(*)::int from p2p_kingdom_win_screening_rules) rules,
      (select count(*)::int from pg_trigger where tgname = 'trg_p2p_kingdom_win_guard') guard`)).rows[0];
  ok("189 re-applies cleanly (applied twice: 14 rules, one guard trigger)", meta.rules === 14 && meta.guard === 1, JSON.stringify(meta));

  // ── A8: screening corpus ──────────────────────────────────────────────────
  for (const t of REJECT) ok(`A8 reject: ${JSON.stringify(t).slice(0, 60)}`, rec(`screen:${t}`, (await screen(t)).action) === "reject", JSON.stringify((await screen(t)).hits));
  for (const t of HOLD) ok(`A8 hold: ${JSON.stringify(t).slice(0, 60)}`, rec(`screen:${t}`, (await screen(t)).action) === "hold", JSON.stringify((await screen(t)).hits));
  for (const t of ALLOW) ok(`A8 legitimate testimony allowed: ${JSON.stringify(t).slice(0, 60)}`, rec(`screen:${t}`, (await screen(t)).action) === "allow", JSON.stringify((await screen(t)).hits));
  ok("A8 rules are versioned", (await screen("x")).rulesVersion === 1);
  ok("A8 an invalid rule pattern cannot be stored",
    !!(await db.query(`insert into p2p_kingdom_win_screening_rules (rule_key, category, action, target, pattern, description, rules_version) values ('bad', 'link', 'hold', 'plain', '(unclosed', 'x', 2)`).then(() => null, (e) => e)));
  ok("A8 members cannot read or edit the rules", denied(await as(db, "Q", `select * from p2p_kingdom_win_screening_rules`))
    && isErr(await as(db, "Q", `update p2p_kingdom_win_screening_rules set enabled = false`)));

  // A8 through the real write path (direct database insert — no UI, no API).
  const rej = await ins("P", { body: "Send money to my CashApp $blessedjoy" });
  ok("A8 prohibited post rejected at the database (direct write)", isErr(rej, /wins_content_rejected:payment/), brief(rej));
  ok("A8 a rejected post leaves nothing behind (no row, no flag)", (await db.query(`select count(*)::int n from p2p_kingdom_wins where body like '%blessedjoy%'`)).rows[0].n === 0
    && (await db.query(`select count(*)::int n from p2p_content_flags where content_snapshot like '%blessedjoy%'`)).rows[0].n === 0);
  const held = await ins("P", { body: "Watch my full testimony at www.example.com" });
  const heldId = held.rows?.[0]?.id;
  ok("A8 ambiguous post held: not published, moderation_hold set", one(held) && held.rows[0].status === "submitted" && held.rows[0].moderation_hold === true && !held.rows[0].published_at, brief(held));
  const hf = await flagFor(heldId);
  ok("A8 held post filed once in the existing moderation queue (automated, no reporter)", hf.length === 1 && hf[0].reporter_id === null && /Automated screening/.test(hf[0].reason));
  ok("A8 held post hidden from other members", denied(await as(db, "Q", `select id from p2p_kingdom_wins where id = $1`, [heldId])));
  ok("A8 author cannot self-publish a held post", isErr(await upd("P", heldId, `status = 'published'`), /wins_held_for_review/));
  ok("A8 author cannot clear the hold", isErr(await upd("P", heldId, `moderation_hold = false`), /wins_moderation_fields/));
  const appr = await upd("O", heldId, `status = 'published'`);
  ok("A8 a Wins moderator approves a held post (hold released, published)", one(appr) && appr.rows[0].status === "published" && appr.rows[0].moderation_hold === false, brief(appr));
  ok("A8 approval is in the admin activity log", (await logs("kingdom_win.published")).some((l) => l.target_resource_id === heldId && l.admin_id === U.O && l.action_detail.hold_released === true));
  const draftBad = await ins("P", { status: "draft", body: "Buy now! 50% off, use promo code FAITH" });
  ok("A8 drafts are private and not screened until shared", one(draftBad) && draftBad.rows[0].status === "draft");
  ok("A8 sharing that draft is rejected", isErr(await upd("P", draftBad.rows?.[0]?.id, `status = 'published'`), /wins_content_rejected:advertising/));
  const editBad = await ins("P", { body: "God provided a new job." });
  ok("A8 editing a published post re-screens it", isErr(await upd("P", editBad.rows?.[0]?.id, `body = 'Invest with me: guaranteed returns'`), /wins_content_rejected:money_scheme/));

  // ── A8 translated screening (posts in other languages) ────────────────────
  const needs = async (t) => (await db.query(`select p2p_kingdom_win_needs_translation($1) r`, [t])).rows[0].r;
  for (const t of ["Dios sanó a mi madre después de orar", "شفاني الله من المرض", "神医治了我的母亲", "Mungu ameniponya kutoka kwa ugonjwa wa muda mrefu", "Tuhan menyembuhkan ibu saya dari penyakit"]) {
    ok(`A8T detected as not English: ${t.slice(0, 30)}`, rec(`needs:${t}`, await needs(t)) === true);
  }
  for (const t of ["I prayed and God healed my mother 🙏", "God is good!", "My family came back to church after years — praise God", "Jesus set me free from addiction and gave me hope."]) {
    ok(`A8T English not sent for translation: ${t.slice(0, 30)}`, rec(`needs:${t}`, await needs(t)) === false);
  }
  const input = async (body) => (await as(db, null, `select p2p_kingdom_win_screening_input('A testimony', $1, null, null) r`, [body])).rows[0].r;
  const recordTr = async (body, english, age = "0 minutes") => {
    const i = await input(body);
    return as(db, null, `insert into p2p_kingdom_win_translations (content_hash, english_text, provider, created_at) values ($1, $2, 'test', now() - $3::interval)`, [i.hash, english, age]);
  };
  const es = "Dios sanó a mi madre después de orar tres meses.";
  const noTr = await ins("P", { body: es });
  ok("A8T non-English post with no translation is held, not published", one(noTr) && noTr.rows[0].status === "submitted" && noTr.rows[0].moderation_hold === true, brief(noTr));
  ok("A8T held post is filed for moderators as 'translation'", (await flagFor(noTr.rows?.[0]?.id)).some((f) => /translation/.test(f.reason)));
  ok("A8T members cannot record a translation (no self-supplied 'clean' text)", isErr(await as(db, "P",
    `insert into p2p_kingdom_win_translations (content_hash, english_text, provider) values ('x', 'God is good', 'me')`), /permission denied/));
  ok("A8T members cannot call the screening-input helper", isErr(await as(db, "P", `select p2p_kingdom_win_screening_input('a', 'b', null, null)`), /permission denied/));
  const es2 = "Dios restauró mi familia y ahora servimos juntos en la iglesia.";
  await recordTr(es2, "God restored my family and now we serve together in the church.");
  const trOk = await ins("P", { body: es2 });
  ok("A8T translated clean post publishes immediately", one(trOk) && trOk.rows[0].status === "published" && trOk.rows[0].moderation_hold === false, brief(trOk));
  ok("A8T English translation kept for staff", (await row(trOk.rows?.[0]?.id))?.screening?.translation?.text === "God restored my family and now we serve together in the church.");
  ok("A8T translation is single-use", (await db.query(`select count(*)::int n from p2p_kingdom_win_translations where english_text like 'God restored%'`)).rows[0].n === 0
    && (await ins("P", { body: es2 })).rows?.[0]?.status === "submitted");
  const es3 = "Envíame dinero a mi cuenta de Opay para la cruzada.";
  await recordTr(es3, "Send me money to my Opay account for the crusade.");
  ok("A8T prohibited content found in the translation is rejected", isErr(await ins("P", { body: es3 }), /wins_content_rejected:payment/));
  const sw = "Mungu ameniponya kutoka kwa ugonjwa wa muda mrefu, tazama ushuhuda wangu kamili";
  await recordTr(sw, "God healed me from a long illness, watch my full testimony at www.example.com");
  const swHeld = await ins("P", { body: sw });
  ok("A8T ambiguous content in the translation is held", one(swHeld) && swHeld.rows[0].status === "submitted" && swHeld.rows[0].moderation_hold === true, brief(swHeld));
  ok("A8T moderators see the English translation in the report", (await flagFor(swHeld.rows?.[0]?.id)).some((f) => /\[English translation\]/.test(f.content_snapshot)));
  const es4 = "Gracias a Dios encontré trabajo después de un año difícil.";
  await recordTr(es4, "Thanks to God I found work after a difficult year.", "2 hours");
  ok("A8T a stale translation is ignored (held instead)", (await ins("P", { body: es4 })).rows?.[0]?.status === "submitted");
  ok("A8T English posts are not affected", (await ins("P", { body: "God provided a job for me this week." })).rows?.[0]?.status === "published");

  // ── A11 / ordinary publishing stays immediate ─────────────────────────────
  const w = await ins("P", { body: "I prayed and God healed my mother." });
  const win = w.rows?.[0]?.id;
  ok("11 ordinary testimony publishes immediately (no Studio approval)", one(w) && w.rows[0].status === "published" && !!w.rows[0].published_at && w.rows[0].moderation_hold === false, brief(w));
  ok("11 other members see it", one(await as(db, "Q", `select id from p2p_kingdom_wins where id = $1`, [win])));
  if (with188) ok("11 no Studio records are created for Wins", (await db.query(`select count(*)::int n from p2p_studio_items where source_type = 'kingdom_win'`)).rows[0].n === 0);
  const forged = await ins("P", { body: "God is faithful.", publishedAt: "2000-01-01T00:00:00Z", note: "approved by admin", hold: true });
  ok("9 client cannot forge published_at, moderation note or hold", one(forged) && new Date(forged.rows[0].published_at).getFullYear() >= 2026
    && forged.rows[0].moderation_note === null && forged.rows[0].moderation_hold === false, JSON.stringify(forged.rows?.[0]));

  // ── A12: ownership, status, visibility, consent, media ────────────────────
  ok("9 member cannot post as another member", isErr(await ins("Q", { author: U.P }), /row-level security|wins_not_owner/));
  ok("9 member cannot edit another member's post", denied(await upd("Q", win, `title = 'hijacked'`)));
  ok("9 member cannot delete another member's post", denied(await as(db, "Q", `delete from p2p_kingdom_wins where id = $1 returning id`, [win])));
  ok("9 author cannot forge moderator-only states", denied(await upd("P", win, `status = 'removed'`)) && denied(await upd("P", win, `status = 'rejected'`)));
  ok("9 author cannot insert in a moderator-only state", isErr(await ins("P", { status: "removed" }), /wins_invalid_status/));
  ok("9 author cannot write a moderation note", isErr(await upd("P", win, `moderation_note = 'ok'`), /wins_moderation_fields/));
  ok("9 a published post cannot be made private", isErr(await upd("P", win, `visibility = 'private'`)));
  ok("9 author_id cannot be changed", isErr(await upd("P", win, `author_id = $2`, [U.Q]), /wins_not_owner|row-level/));
  ok("9 media must be in the author's own folder for this entry",
    isErr(await ins("P", { mediaType: "photo", mediaPath: `${U.Q}/whatever/photo.jpg` }), /wins_media_not_owned/));
  const mid = "33333333-3333-4333-8333-000000000001";
  ok("9 own media path accepted", one(await ins("P", { id: mid, mediaType: "photo", mediaPath: `${U.P}/${mid}/photo.jpg` })));

  ok("10 P2P Impact cannot be inserted as published", isErr(await ins("P", { type: "p2p_impact", status: "published", consent: new Date().toISOString() }), /wins_impact_requires_review/));
  ok("10 P2P Impact cannot be submitted without consent", isErr(await ins("P", { type: "p2p_impact", status: "submitted" }), /wins_consent_required/));
  const imp = await ins("P", { type: "p2p_impact", status: "submitted", consent: "2000-01-01T00:00:00Z" });
  const impId = imp.rows?.[0]?.id;
  ok("10 P2P Impact submitted with consent stays pending; consent time not back-dated", one(imp) && imp.rows[0].status === "submitted"
    && new Date(imp.rows[0].consent_confirmed_at).getFullYear() >= 2026, JSON.stringify(imp.rows?.[0]));
  ok("10 author cannot publish their own pending P2P Impact", isErr(await upd("P", impId, `status = 'published'`), /wins_impact_requires_review/));
  ok("10 author cannot switch a pending entry's type to skip review", isErr(await upd("P", impId, `entry_type = 'kingdom_win', status = 'published'`), /wins_invalid_transition/));
  ok("10 consent cannot be withdrawn once given", one(await upd("P", impId, `consent_confirmed_at = null`)) && (await row(impId)).consent_confirmed_at !== null);
  ok("10 trusted server path cannot publish P2P Impact without consent", isErr(await as(db, null,
    `insert into p2p_kingdom_wins (author_id, entry_type, title, body, category, status) values ($1, 'p2p_impact', 't', 'b', 'other', 'published')`, [U.P]), /wins_consent_required/));

  // P2P Impact reviewer (admin_content) keeps exactly its review job.
  ok("10 admin_content reviewer sees pending P2P Impact", one(await as(db, "A", `select id from p2p_kingdom_wins where id = $1`, [impId])));
  const impOk = await upd("A", impId, `status = 'published', moderation_note = 'Thank you'`);
  ok("10 admin_content approves a consented P2P Impact submission", one(impOk) && impOk.rows[0].status === "published", brief(impOk));
  ok("10 author's content edit of an approved P2P Impact sends it back to review", one(await upd("P", impId, `body = 'Updated story.'`)) && (await row(impId)).status === "submitted");
  ok("6 admin_content cannot moderate ordinary Wins", denied(await upd("A", win, `status = 'removed'`)));
  ok("6 admin_content cannot see other members' ordinary drafts", denied(await as(db, "A", `select id from p2p_kingdom_wins where id = $1`, [draftBad.rows?.[0]?.id])));

  // ── A9/A10/A12: reporting vs moderation ───────────────────────────────────
  const flagId = await report("Q", win);
  ok("12 member can report", !!flagId);
  ok("12 a report does not hide or remove the post", (await row(win)).status === "published");
  ok("12 a report is not resolved by being filed", (await db.query(`select status from p2p_content_flags where id = $1`, [flagId])).rows[0].status === "open");
  ok("8 members cannot write reports directly (forged/resolved)", isErr(await as(db, "Q",
    `insert into p2p_content_flags (content_type, content_id, author_id, reporter_id, status) values ('kingdom_win', $1, $2, $3, 'removed')`, [win, U.P, U.Q])));
  for (const who of ["Q", "P", "G", "L", "F", "A"]) {
    ok(`6 ${ROLE[who]} cannot see Wins reports`, denied(await as(db, who, `select id from p2p_content_flags where id = $1 and reporter_id is distinct from $2`, [flagId, U[who]])));
    ok(`6/8 ${ROLE[who]} cannot resolve a Wins report`, isErr(await as(db, who, `select p2p_moderate_flag($1, 'dismiss', null)`, [flagId]), /not permitted/));
    if (who !== "P") ok(`6 ${ROLE[who]} cannot change another member's Win status`, denied(await upd(who, win, `status = 'archived'`)));
    ok(`16 ${ROLE[who]} cannot restrict posting`, isErr(await restrict(who, U.Q), /wins_forbidden|not permitted|permission denied/));
  }
  for (const who of ["O", "M", "V", "S"]) ok(`5/7 ${ROLE[who]} can see Wins reports`, one(await as(db, who, `select id from p2p_content_flags where id = $1`, [flagId])));
  ok("7 admin_moderation reads poster identity for the queue", one(await as(db, "M", `select * from p2p_flag_poster_identity($1)`, [U.P])));
  ok("6 peer_guide cannot read poster identity", isErr(await as(db, "G", `select * from p2p_flag_poster_identity($1)`, [U.P]), /not permitted/));
  // admin_moderation works the general queue too (non-Wins report).
  const msgFlag = (await db.query(`insert into p2p_content_flags (content_type, content_id, author_id, reporter_id, reason) values ('message', gen_random_uuid(), $1, $2, 'spam') returning id`, [U.Q, U.P])).rows[0].id;
  ok("7 admin_moderation sees a non-Wins report", one(await as(db, "M", `select id from p2p_content_flags where id = $1`, [msgFlag])));
  ok("7 admin_moderation resolves a non-Wins report (warn)", !isErr(await as(db, "M", `select p2p_moderate_flag($1, 'warn', 'First warning')`, [msgFlag]))
    && (await db.query(`select status, resolved_by from p2p_content_flags where id = $1`, [msgFlag])).rows[0].resolved_by === U.M);
  ok("6 church_leader keeps general (non-Wins) report access", one(await as(db, "L", `select id from p2p_content_flags where id = $1`, [msgFlag])));
  const rm = await as(db, "M", `select p2p_moderate_flag($1, 'remove', 'Advertising')`, [flagId]);
  ok("5/7 admin_moderation removes a reported Win", !isErr(rm) && (await row(win)).status === "removed", brief(rm));
  ok("5 removal hides it from members", denied(await as(db, "Q", `select id from p2p_kingdom_wins where id = $1`, [win])));
  ok("A10 resolution + removal audited (actor, target, action, reason)",
    (await logs("moderation.flag_removed")).some((l) => l.admin_id === U.M && l.target_user_id === U.P && l.target_resource_id === flagId && l.action_detail.note === "Advertising")
    && (await logs("kingdom_win.removed")).some((l) => l.admin_id === U.M && l.target_resource_id === win));
  ok("9 author cannot republish a removed post", isErr(await upd("P", win, `status = 'published'`), /wins_removed_locked/));
  ok("9 author can still delete their removed post", one(await as(db, "P", `delete from p2p_kingdom_wins where id = $1 returning id`, [editBad.rows?.[0]?.id])));
  const restore = await upd("V", win, `status = 'published', moderation_note = 'Restored on appeal'`);
  ok("5 admin_supervisor restores a removed post", one(restore) && restore.rows[0].status === "published");
  ok("5 super_admin archives a post", one(await upd("S", win, `status = 'archived'`)));
  ok("8 a moderator cannot edit someone else's content", isErr(await upd("O", win, `title = 'Edited by moderator'`), /wins_moderator_content_edit/));
  const own = await ins("O", { body: "God answered my prayer." });
  const ownFlag = await report("Q", own.rows?.[0]?.id);
  ok("8 a moderator cannot resolve a report about their own post", isErr(await as(db, "O", `select p2p_moderate_flag($1, 'dismiss', null)`, [ownFlag]), /not permitted/));
  ok("8 nobody can call the audit helper directly", isErr(await as(db, "O", `select p2p_wins_log_admin_action('fake', null, null, null, '{}')`), /permission denied/));

  // ── A12/14: atomicity ─────────────────────────────────────────────────────
  await db.exec(`alter table p2p_admin_activity_log add constraint test_audit_down check (action_type <> 'kingdom_win.archived') not valid`);
  const before = (await row(own.rows[0].id)).status;
  ok("14 if the audit write fails, the moderation change is rolled back", isErr(await upd("O", (await ins("Q", { body: "Grace." })).rows[0].id, `status = 'archived'`))
    && isErr(await upd("S", own.rows[0].id, `status = 'archived'`)) && (await row(own.rows[0].id)).status === before);
  await db.exec(`alter table p2p_admin_activity_log drop constraint test_audit_down`);
  const inv = await upd("P", heldId, `title = 'New title', status = 'rejected'`);
  ok("14 an invalid transition changes nothing", denied(inv) && (await row(heldId)).title === "A testimony");

  // ── A13: posting restrictions ─────────────────────────────────────────────
  const r1 = await restrict("O", U.P, "Repeated advertising after warnings", new Date(Date.now() + 7 * 86400e3).toISOString());
  const rid = r1.rows?.[0]?.r?.id;
  ok("15 moderator restricts a member with a reason and expiry", !!rid && r1.rows[0].r.imposed_by === U.O, brief(r1));
  ok("15 restriction audited", (await logs("kingdom_win.restriction_imposed")).some((l) => l.admin_id === U.O && l.target_user_id === U.P && l.target_resource_id === rid));
  ok("15 moderators can inspect restrictions", one(await as(db, "M", `select id from p2p_kingdom_win_restrictions where id = $1`, [rid])));
  ok("16 members cannot see restrictions (not even reasons)", denied(await as(db, "P", `select id from p2p_kingdom_win_restrictions where id = $1`, [rid])));
  ok("19 restricted member sees only status + until (no reason, no moderator)",
    JSON.stringify(Object.keys((await as(db, "P", `select p2p_my_wins_posting_status() s`)).rows[0].s).sort()) === JSON.stringify(["restricted", "until"]));
  ok("15 reason is required", isErr(await restrict("O", U.Q, "  "), /wins_reason_required/));
  ok("15 expiry must be in the future", isErr(await restrict("O", U.Q, "Spam links", new Date(Date.now() - 1000).toISOString()), /wins_invalid_expiry/));
  ok("16 a moderator cannot restrict themselves", isErr(await restrict("O", U.O), /wins_cannot_restrict_self/));
  ok("16 only super_admin restricts another moderator", isErr(await restrict("M", U.O), /wins_cannot_restrict_moderator/));
  ok("16 members cannot write restrictions directly", isErr(await as(db, "Q", `insert into p2p_kingdom_win_restrictions (user_id, reason) values ($1, 'x x x')`, [U.P]))
    && isErr(await as(db, "P", `update p2p_kingdom_win_restrictions set lifted_at = now(), lift_reason = 'self' where id = $1`, [rid])));
  for (const who of ["P", "Q", "G", "L", "F", "A"]) ok(`16 ${ROLE[who]} cannot lift a restriction`, isErr(await lift(who, rid), /wins_forbidden|permission denied/));

  ok("17 restricted: new published post blocked", isErr(await ins("P", { body: "God is good." }), /wins_posting_restricted/));
  ok("17 restricted: another subtype blocked too", isErr(await ins("P", { type: "testimony", body: "God is good." }), /wins_posting_restricted/)
    && isErr(await ins("P", { type: "p2p_impact", status: "submitted", consent: new Date().toISOString() }), /wins_posting_restricted/));
  ok("17 restricted: publishing a draft blocked", isErr(await upd("P", draftBad.rows?.[0]?.id, `body = 'Clean text.', status = 'published'`), /wins_posting_restricted/));
  ok("17 restricted: editing a live post blocked", isErr(await upd("P", forged.rows?.[0]?.id, `body = 'Edited while restricted.'`), /wins_posting_restricted/));
  ok("19 restricted: drafts still allowed (private)", one(await ins("P", { status: "draft", body: "Notes for later." })));
  ok("19 restricted: own posts can still be archived", one(await upd("P", forged.rows?.[0]?.id, `status = 'archived'`)));
  ok("19 restricted: earlier posts stay up", (await row(mid)).status === "published" && one(await as(db, "Q", `select id from p2p_kingdom_wins where id = $1`, [mid])));
  ok("19 restricted: reports about them are not auto-resolved", (await db.query(`select status from p2p_content_flags where id = $1`, [hf[0].id])).rows[0].status === "open");
  const others = await as(db, "P", `select id from p2p_kingdom_wins where status = 'published' and author_id <> $1 limit 1`, [U.P]);
  ok("19 restricted: reading still works", one(others), brief(others));
  ok("19 restricted: reacting still works", one(await as(db, "P",
    `insert into p2p_kingdom_win_reactions (kingdom_win_id, user_id, reaction_type) values ($1, $2, 'amen') returning id`, [others.rows?.[0]?.id, U.P])));
  ok("19 restricted: Kingdom Stories and other features untouched (no restriction state elsewhere)",
    (await db.query(`select count(*)::int n from information_schema.columns where table_name = 'p2p_profiles' and column_name ilike '%restrict%'`)).rows[0].n === 0);
  const lifted = await lift("M", rid);
  ok("15 admin_moderation lifts with a reason; audited", !isErr(lifted) && lifted.rows[0].r.lifted_by === U.M
    && (await logs("kingdom_win.restriction_lifted")).some((l) => l.admin_id === U.M && l.target_resource_id === rid));
  ok("18 after lifting, posting works again", one(await ins("P", { body: "Thankful again." })));
  ok("15 a lifted restriction is a closed record", isErr(await lift("O", rid), /wins_restriction_not_active/)
    && isErr(await db.query(`update p2p_kingdom_win_restrictions set reason = 'changed' where id = $1`, [rid]).then(() => ({ rows: [] }), (e) => ({ error: e.message })), /wins_restriction_immutable/));
  await db.query(`insert into p2p_kingdom_win_restrictions (user_id, reason, imposed_by, imposed_at, expires_at) values ($1, 'Old restriction', $2, now() - interval '3 days', now() - interval '1 day')`, [U.Q, U.O]);
  ok("18 an expired restriction (database time) no longer blocks", one(await ins("Q", { body: "God restored my family." })));
  await db.query(`insert into p2p_kingdom_win_restrictions (user_id, reason, imposed_by, expires_at) values ($1, 'Cooling-off period', $2, now() + interval '1 hour')`, [U.Q, U.O]);
  ok("17 a restriction still within its expiry blocks", isErr(await ins("Q", { body: "Praise." }), /wins_posting_restricted/));
  const status = (await as(db, "Q", `select p2p_my_wins_posting_status() s`)).rows[0].s;
  ok("19 member sees restricted + until", status.restricted === true && !!status.until);
  const indefinite = await restrict("S", U.M, "Super admin test of indefinite restriction");
  ok("15 indefinite restriction (no expiry) supported; super_admin may restrict a moderator", !isErr(indefinite) && indefinite.rows[0].r.expires_at === null);
  ok("17 indefinite restriction blocks", isErr(await ins("M", { body: "God is faithful." }), /wins_posting_restricted/));

  // ── 13: Kingdom Stories untouched ─────────────────────────────────────────
  const cat = (await db.query(`select id from p2p_kingdom_story_categories order by display_order limit 1`)).rows[0].id;
  ok("13 members cannot create Kingdom Stories", denied(await as(db, "P", `insert into p2p_kingdom_stories (title, category_id, body) values ('x', $1, 'y') returning id`, [cat])));
  ok("13 Wins moderators get no Kingdom Stories access", denied(await as(db, "M", `insert into p2p_kingdom_stories (title, category_id, body) values ('x', $1, 'y') returning id`, [cat])));
  if (with188) {
    const story = (await db.query(`insert into p2p_kingdom_stories (title, category_id, body) values ('Editorial', $1, 'x') returning id`, [cat])).rows[0].id;
    ok("13 Story publication still needs Studio approval (188 gate)", isErr(await as(db, "A", `update p2p_kingdom_stories set status = 'published' where id = $1`, [story]), /studio_approval_required/));
    ok("13 Wins moderators cannot use the Studio", isErr(await as(db, "M", `select p2p_studio_review_transition('kingdom_story', $1, 'in_review', 1, null)`, [story]), /studio_forbidden/));
  }

  // ── Account deletion still works (author_id set null, post survives) ─────
  const x = "00000000-0000-0000-0000-0000000000aa";
  await db.query(`insert into auth.users values ($1)`, [x]);
  await db.query(`insert into p2p_profiles (id, role) values ($1, 'student')`, [x]);
  await db.exec(`set test.uid = '${x}'; set role authenticated;`);
  const xw = (await db.query(`insert into p2p_kingdom_wins (author_id, entry_type, title, body, category, status) values ('${x}', 'kingdom_win', 't', 'God healed me.', 'healing', 'published') returning id`)).rows[0].id;
  await db.exec(`reset role; set test.uid = '';`);
  await db.query(`delete from auth.users where id = $1`, [x]);
  ok("account deletion keeps the published testimony (author set null)", (await row(xw))?.author_id === null && (await row(xw)).status === "published");
  // Production keeps reports when an author deletes their account (author_id set null).
  await db.query(`insert into auth.users values ($1)`, ["00000000-0000-0000-0000-0000000000ab"]);
  await db.query(`insert into p2p_profiles (id, role) values ($1, 'student')`, ["00000000-0000-0000-0000-0000000000ab"]);
  await db.exec(`set test.uid = '00000000-0000-0000-0000-0000000000ab'; set role authenticated;`);
  const yw = (await db.query(`insert into p2p_kingdom_wins (author_id, entry_type, title, body, category, status) values ('00000000-0000-0000-0000-0000000000ab', 'kingdom_win', 't', 'God answered.', 'healing', 'published') returning id`)).rows[0].id;
  await db.exec(`reset role; set test.uid = '';`);
  const yFlag = await report("Q", yw);
  await db.query(`delete from p2p_profiles where id = $1`, ["00000000-0000-0000-0000-0000000000ab"]);
  await db.query(`delete from auth.users where id = $1`, ["00000000-0000-0000-0000-0000000000ab"]);
  ok("report about a deleted author's post survives (author null)", (await db.query(`select author_id from p2p_content_flags where id = $1`, [yFlag])).rows[0]?.author_id === null);
  ok("a moderator can still resolve it (self-resolution rule not misfiring on null)", !isErr(await as(db, "O", `select p2p_moderate_flag($1, 'remove', 'Ownerless spam')`, [yFlag]))
    && (await row(yw)).status === "removed");

  return out;
}

// Negative proofs: MUTATE_189=<name> weakens one safeguard after 189 is
// applied; the suite must then FAIL.
const MUTATIONS = {
  restriction: `create or replace function public.p2p_wins_restriction_active(p_user_id uuid) returns boolean language sql as $$ select false $$;`,
  allowlist: `create or replace function public.p2p_is_wins_moderator() returns boolean language sql stable security definer set search_path = public, pg_temp
    as $$ select exists (select 1 from public.p2p_profiles where id = auth.uid() and role::text in ('moderator','admin_moderation','admin_supervisor','super_admin','peer_guide')) $$;`,
  screening: `update public.p2p_kingdom_win_screening_rules set enabled = false;`,
  guard: `drop trigger trg_p2p_kingdom_win_guard on public.p2p_kingdom_wins;`,
  translation: `create or replace function public.p2p_kingdom_win_needs_translation(p_text text) returns boolean language sql immutable as $$ select false $$;`,
};
const mutation = MUTATIONS[process.env.MUTATE_189 ?? ""] ?? "";
if (process.env.MUTATE_189 && !mutation) { console.error(`unknown mutation; use one of ${Object.keys(MUTATIONS).join(", ")}`); process.exit(2); }
const withIt = await buildWinsDb(PGlite, { with188: true, with189: true, times189: 2 });
const without = await buildWinsDb(PGlite, { with188: false, with189: true, times189: 2 });
if (mutation) { await withIt.exec(mutation); await without.exec(mutation); }
// A crash (e.g. a weakened safeguard leaves an expected row missing) counts
// as a failure; the summary is always printed.
const safe = async (db, with188) => { try { return await suite(db, with188); } catch (e) { fail++; console.log(`FAIL suite aborted (with188=${with188}): ${e.message}`); return {}; } };
const a = await safe(withIt, true);
const failsBefore = fail;
const b = await safe(without, false);
for (const k of Object.keys(a)) ok(`same screening outcome with and without 188: ${k.slice(0, 60)}`, a[k] === b[k], `${a[k]} vs ${b[k]}`);
await withIt.close(); await without.close();
console.log(`\n${pass} passed, ${fail} failed${fail ? "" : " (suite ran on databases with and without migration 188)"}`);
process.exit(fail || failsBefore ? 1 : 0);
