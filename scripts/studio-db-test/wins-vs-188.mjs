// Product-rule regression: Kingdom Wins (community testimonies, self-publish,
// report-based moderation) must behave IDENTICALLY with and without migration
// 188 (Publishing Studio), while Kingdom Stories stay editor-only.
//
// Runs the REAL migrations 150 + 151 (Kingdom Wins) and 152 (Kingdom Stories)
// on two fresh PGlite databases — one without 188, one with it — plays the
// same member / moderator scenarios as real Postgres roles (authenticated +
// auth.uid()), and compares every outcome and the Wins catalog (policies,
// triggers, constraints, moderation functions).
//
// Not covered: the API layer (routes/kingdomWins.ts is unchanged by the
// Studio work), PostgREST, real JWTs.
//
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/wins-vs-188.mjs
import { pathToFileURL } from "node:url";
import { U, ROLE, buildWinsDb, as, brief } from "./wins-setup.mjs";

const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error("Set PGLITE_MODULE (see header)."); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);

// Negative proof (MUTATE_WINS_GATE=1): a 188 that WRONGLY gated Kingdom Wins
// behind Studio approval. This suite must then fail.
const MUTATION = `
  create function public.p2p_wrong_wins_gate() returns trigger language plpgsql as $m$
  begin
    if new.status = 'published' and not exists (select 1 from p2p_studio_items i where i.source_type = 'kingdom_win' and i.source_id = new.id and i.review_state = 'approved')
    then raise exception 'studio_approval_required' using errcode = 'S0423'; end if;
    return new;
  end $m$;
  create trigger trg_wrong_wins_gate before insert or update on public.p2p_kingdom_wins for each row execute function public.p2p_wrong_wins_gate();`;

const freshDb = (with188) => buildWinsDb(PGlite, { with188, extra188: process.env.MUTATE_WINS_GATE === "1" ? MUTATION : "" });

async function scenario(db) {
  const out = {};
  const ins = `insert into p2p_kingdom_wins (author_id, entry_type, title, body, category, status, published_at) values ($1, $2, $3, 'Synthetic testimony.', 'answered_prayer', $4, case when $4 = 'published' then now() end) returning id`;
  // A. Member publishes their own testimony immediately — no approval step.
  const w1 = await as(db, "P", ins, [U.P, "kingdom_win", "Healed", "published"]);
  out.memberSelfPublishes = brief(w1);
  const win = w1.rows?.[0]?.id;
  out.otherMemberSeesIt = brief(await as(db, "Q", `select id from p2p_kingdom_wins where id = $1`, [win]));
  const draft = (await as(db, "P", ins, [U.P, "testimony", "Restored", "draft"])).rows?.[0]?.id;
  out.draftHiddenFromOthers = brief(await as(db, "Q", `select id from p2p_kingdom_wins where id = $1`, [draft]));
  out.ownDraftPublishes = brief(await as(db, "P", `update p2p_kingdom_wins set status = 'published', published_at = now() where id = $1 returning id`, [draft]));
  // B. Member cannot publish as someone else, nor touch another member's post.
  out.cannotAuthorAsOther = brief(await as(db, "Q", ins, [U.P, "kingdom_win", "Forged", "published"]));
  out.cannotEditOthers = brief(await as(db, "Q", `update p2p_kingdom_wins set title = 'hijack' where id = $1 returning id`, [win]));
  out.cannotDeleteOthers = brief(await as(db, "Q", `delete from p2p_kingdom_wins where id = $1 returning id`, [win]));
  out.authorCannotSetRemoved = brief(await as(db, "P", `update p2p_kingdom_wins set status = 'removed' where id = $1 returning id`, [win]));
  out.publishedCannotBePrivate = brief(await as(db, "P", `update p2p_kingdom_wins set visibility = 'private' where id = $1 returning id`, [win]));
  // C. Reporting + post-publication moderation.
  const flag = await as(db, "Q", `select p2p_report_content('kingdom_win', $1, 'Looks like an advert') as id`, [win]);
  out.memberReports = brief(flag);
  const flagId = flag.rows?.[0]?.id;
  out.memberCannotModerate = brief(await as(db, "Q", `select p2p_moderate_flag($1, 'remove', null)`, [flagId]));
  out.authorCannotModerateOwnReport = brief(await as(db, "P", `select p2p_moderate_flag($1, 'dismiss', null)`, [flagId]));
  out.adminModerationRoleViaFlags = brief(await as(db, "M", `select p2p_moderate_flag($1, 'remove', null)`, [flagId]));
  out.moderatorRemoves = brief(await as(db, "O", `select p2p_moderate_flag($1, 'remove', null)`, [flagId]));
  out.removedHiddenFromMembers = brief(await as(db, "Q", `select id from p2p_kingdom_wins where id = $1`, [win]));
  out.removedStatus = (await db.query(`select status from p2p_kingdom_wins where id = $1`, [win])).rows[0]?.status;
  // D. Observed pre-existing behaviour (recorded, compared across both DBs).
  out.peerGuideCanEditAnyWin = brief(await as(db, "G", `update p2p_kingdom_wins set status = 'removed' where id = $1 returning id`, [draft]));
  out.directImpactPublishWithoutConsent = brief(await as(db, "P", ins, [U.P, "p2p_impact", "Impact", "published"]));
  // E. Kingdom Stories: members can neither create nor publish nor edit.
  const cat = (await db.query(`select id from p2p_kingdom_story_categories order by display_order limit 1`)).rows[0].id;
  out.memberCannotCreateStory = brief(await as(db, "P", `insert into p2p_kingdom_stories (title, category_id, body) values ('Member story', $1, 'x') returning id`, [cat]));
  const story = (await db.query(`insert into p2p_kingdom_stories (title, category_id, body) values ('Editorial', $1, 'x') returning id`, [cat])).rows[0].id;
  out.memberCannotEditStory = brief(await as(db, "P", `update p2p_kingdom_stories set status = 'published' where id = $1 returning id`, [story]));
  out.memberCannotSeeDraftStory = brief(await as(db, "P", `select id from p2p_kingdom_stories where id = $1`, [story]));
  out.peerGuideCannotCreateStory = brief(await as(db, "G", `insert into p2p_kingdom_stories (title, category_id, body) values ('Guide story', $1, 'x') returning id`, [cat]));
  return { out, story };
}

async function winsCatalog(db) {
  const q = async (s) => (await db.query(s)).rows.map((r) => Object.values(r).join(" | "));
  return {
    policies: await q(`select tablename, policyname, cmd, coalesce(qual,''), coalesce(with_check,'') from pg_policies where tablename in ('p2p_kingdom_wins','p2p_kingdom_win_reactions','p2p_content_flags') or (tablename = 'objects' and policyname ilike '%kingdom win%') order by 1,2`),
    triggers: await q(`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('p2p_kingdom_wins','p2p_kingdom_win_reactions','p2p_content_flags') order by 1,2`),
    constraints: await q(`select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where conrelid in ('p2p_kingdom_wins'::regclass, 'p2p_kingdom_win_reactions'::regclass, 'p2p_content_flags'::regclass) order by 1,2`),
    functions: await q(`select proname, md5(prosrc), coalesce(proacl::text,'') from pg_proc where proname in ('p2p_report_content','p2p_moderate_flag','p2p_is_admin','p2p_current_role') order by 1`),
    grants: await q(`select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_name in ('p2p_kingdom_wins','p2p_kingdom_win_reactions') group by 1,2 order by 1,2`),
  };
}

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

const without = await freshDb(false), withIt = await freshDb(true);
const catA = await winsCatalog(without), catB = await winsCatalog(withIt);
for (const k of Object.keys(catA)) ok(`188 leaves the Kingdom Wins ${k} unchanged`, JSON.stringify(catA[k]) === JSON.stringify(catB[k]), JSON.stringify({ before: catA[k], after: catB[k] }).slice(0, 600));

const { out: a } = await scenario(without);
const { out: b, story } = await scenario(withIt);
for (const k of Object.keys(a)) ok(`same outcome with and without 188: ${k}`, a[k] === b[k], `without=${a[k]} | with=${b[k]}`);

// Expected product behaviour (asserted on the database WITH 188).
const okRows = (v) => v === "rows: 1";
const denied = (v) => v.startsWith("error:") || v === "rows: 0";
ok("A1 member publishes own testimony immediately (no approval)", okRows(b.memberSelfPublishes), b.memberSelfPublishes);
ok("A2 other members see a published testimony", okRows(b.otherMemberSeesIt), b.otherMemberSeesIt);
ok("A3 drafts are private to the author", b.draftHiddenFromOthers === "rows: 0", b.draftHiddenFromOthers);
ok("A4 author publishes own draft directly", okRows(b.ownDraftPublishes), b.ownDraftPublishes);
ok("B1 member cannot post as another member", denied(b.cannotAuthorAsOther), b.cannotAuthorAsOther);
ok("B2 member cannot edit another member's testimony", denied(b.cannotEditOthers), b.cannotEditOthers);
ok("B3 member cannot delete another member's testimony", denied(b.cannotDeleteOthers), b.cannotDeleteOthers);
ok("B4 author cannot mark own post removed/rejected (moderator-only states)", denied(b.authorCannotSetRemoved), b.authorCannotSetRemoved);
ok("B5 a published testimony cannot be made private", denied(b.publishedCannotBePrivate), b.publishedCannotBePrivate);
ok("C1 member can report a testimony", okRows(b.memberReports), b.memberReports);
ok("C2 member cannot moderate a report", denied(b.memberCannotModerate), b.memberCannotModerate);
ok("C3 author cannot dismiss a report about their own post", denied(b.authorCannotModerateOwnReport), b.authorCannotModerateOwnReport);
ok("C4 moderator removes a reported testimony", okRows(b.moderatorRemoves) && b.removedStatus === "removed", `${b.moderatorRemoves} ${b.removedStatus}`);
ok("C5 removed testimony disappears for members", b.removedHiddenFromMembers === "rows: 0", b.removedHiddenFromMembers);
ok("E1 member cannot create a Kingdom Story", denied(b.memberCannotCreateStory), b.memberCannotCreateStory);
ok("E2 member cannot publish or edit a Kingdom Story", denied(b.memberCannotEditStory), b.memberCannotEditStory);
ok("E3 member cannot see an unpublished Kingdom Story", b.memberCannotSeeDraftStory === "rows: 0", b.memberCannotSeeDraftStory);
ok("E4 peer guide cannot create a Kingdom Story", denied(b.peerGuideCannotCreateStory), b.peerGuideCannotCreateStory);

// 188-specific: the Studio never touches Kingdom Wins.
const studioWinRows = (await withIt.query(`select count(*)::int n from p2p_studio_items where source_type = 'kingdom_win'`)).rows[0].n;
ok("F1 no Studio approval/schedule records are created for Kingdom Wins", studioWinRows === 0, `${studioWinRows}`);
const winId = (await withIt.query(`select id from p2p_kingdom_wins order by (status = 'published') desc limit 1`)).rows[0]?.id
  ?? "22222222-2222-4222-8222-0000000000ff";
for (const who of ["P", "S"]) {
  ok(`F2 Studio refuses to review a Kingdom Win (${ROLE[who]})`, denied(brief(await as(withIt, who, `select p2p_studio_review_transition('kingdom_win', $1, 'in_review', 1, null)`, [winId]))));
  ok(`F3 Studio refuses to schedule a Kingdom Win (${ROLE[who]})`, denied(brief(await as(withIt, who, `select p2p_studio_create_schedule('kingdom_win', $1, 'archive', now() + interval '2 days', '2030-01-01T09:00', 'UTC', 'key-win-regression-1')`, [winId]))));
}
ok("F4 Kingdom Story publication still requires Studio approval (gate active)", denied(brief(await as(withIt, "A", `update p2p_kingdom_stories set status = 'published' where id = $1 returning id`, [story]))));

console.log("\nObserved pre-existing Kingdom Wins behaviour (identical with and without 188):");
for (const k of ["adminModerationRoleViaFlags", "peerGuideCanEditAnyWin", "directImpactPublishWithoutConsent"]) console.log(`  ${k}: ${b[k]}`);
await without.close(); await withIt.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
