// Admin Recycle Bin (migration 214) on PGlite with the REAL migrations 152 +
// 188 + 210 + 211 + 212 + 214 and stand-ins for the Kingdom School, prayer and
// mission tables that copy production's foreign keys and delete rules (the
// cascade graph read from production). Synthetic data only.
//   • Kingdom School: a lesson / module / curriculum with sections, questions,
//     assignments AND learners' submissions, evaluations, progress, highlights
//     goes to the bin and comes back intact — same ids, same values, links
//     that were cleared (SET NULL) re-linked; side-effect triggers are NOT
//     re-run on restore.
//   • Kingdom Stories: a live story cannot be binned; a draft story with
//     chapters, images and sources is binned and restored as a draft (never
//     published); a chapter restored into a taken position goes at the end.
//   • Prayer / missions: topic, path (+ steps, progress), field, story.
//   • Authorization: roles per type; purge is super_admin only.
//   • Duplicate restore refused; conflicts refused without changing anything;
//     missing parent explained; optional links to removed rows cleared with a
//     warning; purge keeps files still used elsewhere.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/recycle-bin.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, setupBase } from "./setup.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const db = new PGlite();
const read = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const catId = await setupBase(db, read("152_kingdom_stories.sql"));
await db.exec(read("188_publishing_studio_foundation.sql"));
await db.exec(read("210_kingdom_story_catalogue.sql"));
await db.exec(read("211_kingdom_story_chapter_assignment_media.sql"));
// Kingdom School stand-ins: production columns that matter + production FK rules.
await db.exec(`
  alter table public.p2p_curriculums add column if not exists type text not null default 'core',
    add column if not exists description text, add column if not exists is_visible boolean default true, add column if not exists admin_notes text,
    add column if not exists parent_category_id uuid references public.p2p_curriculums(id);
  create table public.p2p_modules (id uuid primary key default gen_random_uuid(), curriculum_id uuid references public.p2p_curriculums(id),
    title text, description text, order_index int, status text default 'draft', created_at timestamptz default now());
  create table public.p2p_lessons (id uuid primary key default gen_random_uuid(), module_id uuid references public.p2p_modules(id),
    title text, subtitle text, order_index int, status text default 'draft', created_at timestamptz default now());
  create table public.p2p_lesson_sections (id uuid primary key default gen_random_uuid(), lesson_id uuid references public.p2p_lessons(id), section_order int, title text, content text);
  create table public.p2p_lesson_blocks (id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.p2p_lessons(id) on delete cascade, block_type text, content jsonb, order_index int);
  create table public.p2p_scriptures (id uuid primary key default gen_random_uuid(), lesson_id uuid references public.p2p_lessons(id), reference text, display_order int);
  create table public.p2p_reflection_questions (id uuid primary key default gen_random_uuid(), lesson_id uuid references public.p2p_lessons(id), question text, display_order int);
  create table public.p2p_assignments (id uuid primary key default gen_random_uuid(), lesson_id uuid references public.p2p_lessons(id), title text, instructions text);
  create table public.p2p_assignment_questions (id uuid primary key default gen_random_uuid(), assignment_id uuid references public.p2p_assignments(id) on delete cascade, question text, display_order int);
  create table public.p2p_lesson_progress (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid references public.p2p_lessons(id),
    completed boolean default false, progress_percent int, updated_at timestamptz default now(), status text not null default 'not_started', unique (user_id, lesson_id));
  create table public.p2p_submissions (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid not null references public.p2p_lessons(id) on delete cascade,
    reflection_question_id uuid references public.p2p_reflection_questions(id) on delete set null, assignment_id uuid references public.p2p_assignments(id) on delete set null,
    assignment_question_id uuid references public.p2p_assignment_questions(id) on delete set null, submission_type text, text_content text, created_at timestamptz default now());
  create table public.p2p_lesson_evaluations (id uuid primary key default gen_random_uuid(), lesson_id uuid references public.p2p_lessons(id) on delete cascade,
    submission_id uuid references public.p2p_submissions(id) on delete cascade, status text, feedback text);
  create table public.p2p_user_highlights (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid references public.p2p_lessons(id) on delete cascade,
    section_id uuid references public.p2p_lesson_sections(id) on delete cascade, text text);
  create table public.p2p_user_notes (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid references public.p2p_lessons(id) on delete set null,
    module_id uuid references public.p2p_modules(id) on delete set null, body text);
  create table public.p2p_journal_reflections (id uuid primary key default gen_random_uuid(), user_id uuid, linked_lesson_id uuid references public.p2p_lessons(id) on delete set null, content text);
  -- The side-effect triggers 214 guards (stand-in bodies that leave a trace).
  create table public.side_effects (what text, at timestamptz default now());
  create function public.p2p_tree_growth_on_submission() returns trigger language plpgsql as $$ begin insert into side_effects values ('tree'); return null; end $$;
  create function public.p2p_assign_evaluator_on_submission() returns trigger language plpgsql as $$ begin insert into side_effects values ('assign'); return null; end $$;
  create function public.p2p_apply_evaluation_outcome() returns trigger language plpgsql as $$ begin insert into side_effects values ('outcome'); return null; end $$;
  create function public.p2p_create_encouragement_confirmation() returns trigger language plpgsql as $$ begin insert into side_effects values ('encourage'); return null; end $$;
  create function public.p2p_notify_evaluator() returns trigger language plpgsql as $$ begin insert into side_effects values ('notify'); return null; end $$;
  create trigger p2p_tree_growth_on_submission_trg after insert on public.p2p_submissions for each row execute function public.p2p_tree_growth_on_submission();
  create trigger trg_assign_evaluator_on_submission after insert on public.p2p_submissions for each row execute function public.p2p_assign_evaluator_on_submission();
  create trigger trg_apply_evaluation_outcome after insert or update of status on public.p2p_lesson_evaluations for each row execute function public.p2p_apply_evaluation_outcome();
  create trigger trg_create_encouragement_confirmation after insert or update of status, feedback on public.p2p_lesson_evaluations for each row execute function public.p2p_create_encouragement_confirmation();
  create trigger trg_notify_evaluator_on_insert after insert on public.p2p_lesson_evaluations for each row execute function public.p2p_notify_evaluator();
  -- Prayer / mission stand-ins (production FK rules).
  alter table public.p2p_prayer_paths add column topic_id uuid references public.p2p_prayer_topics(id) on delete set null;
  create table public.p2p_prayer_path_steps (id uuid primary key default gen_random_uuid(), path_id uuid not null references public.p2p_prayer_paths(id) on delete cascade,
    step_order int not null, reflect_prompt text, unique (path_id, step_order));
  create table public.p2p_prayer_path_progress (id uuid primary key default gen_random_uuid(), user_id uuid, path_id uuid references public.p2p_prayer_paths(id) on delete cascade, current_step int);
  alter table public.p2p_mission_fields add column title text, add column status text default 'published';
  alter table public.p2p_mission_stories add column title text, add column status text default 'published', add column media_path text,
    add column mission_field_id uuid references public.p2p_mission_fields(id) on delete set null;
  create table public.p2p_mission_prayer_points (id uuid primary key default gen_random_uuid(), title text, status text default 'published',
    mission_field_id uuid references public.p2p_mission_fields(id) on delete cascade, mission_story_id uuid references public.p2p_mission_stories(id) on delete cascade);
`);
await db.exec(read("212_kingdom_story_learning.sql"));
await db.exec(read("214_admin_recycle_bin.sql"));
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const expectErr = async (sql, p) => { try { await q(sql, p); return null; } catch (e) { return e.message; } };
const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const LEARNER = id(900), LEARNER2 = id(901);
const binDelete = async (who, type, cid) => (await one(`select p2p_recycle_delete($1, $2, $3) r`, [who, type, cid])).r;
const binRestore = async (who, entry) => (await one(`select p2p_recycle_restore($1, $2) r`, [who, entry])).r;
const dump = async (t, ids) => JSON.stringify(await q(`select * from ${t} where id = any($1) order by id`, [ids]));

// ── Kingdom School content with learner work ───────────────────────────────
await q(`insert into p2p_curriculums (id, title, status) values ($1, 'Core', 'published')`, [id(1)]);
await q(`insert into p2p_modules (id, curriculum_id, title, order_index, status) values ($1, $2, 'Module A', 1, 'published')`, [id(2), id(1)]);
await q(`insert into p2p_lessons (id, module_id, title, order_index, status) values ($1, $2, 'Lesson One', 1, 'published'), ($3, $2, 'Lesson Two', 2, 'draft')`, [id(3), id(2), id(4)]);
await q(`insert into p2p_lesson_sections (id, lesson_id, section_order, title) values ($1, $2, 1, 'Intro')`, [id(10), id(3)]);
await q(`insert into p2p_lesson_blocks (id, lesson_id, block_type, content, order_index) values ($1, $2, 'text', '{"text":"hi"}', 1)`, [id(11), id(3)]);
await q(`insert into p2p_scriptures (id, lesson_id, reference) values ($1, $2, 'John 3:16')`, [id(12), id(3)]);
await q(`insert into p2p_reflection_questions (id, lesson_id, question, display_order) values ($1, $2, 'Why?', 1)`, [id(13), id(3)]);
await q(`insert into p2p_assignments (id, lesson_id, title) values ($1, $2, 'Do it')`, [id(14), id(3)]);
await q(`insert into p2p_assignment_questions (id, assignment_id, question) values ($1, $2, 'How?')`, [id(15), id(14)]);
await q(`insert into p2p_submissions (id, user_id, lesson_id, reflection_question_id, assignment_id, assignment_question_id, text_content)
         values ($1, $2, $3, $4, $5, $6, 'My answer'), ($7, $8, $3, $4, null, null, 'Their answer')`, [id(20), LEARNER, id(3), id(13), id(14), id(15), id(21), LEARNER2]);
await q(`insert into p2p_lesson_evaluations (id, lesson_id, submission_id, status, feedback) values ($1, $2, $3, 'approved', 'Well done')`, [id(22), id(3), id(20)]);
await q(`insert into p2p_lesson_progress (id, user_id, lesson_id, completed, progress_percent, status) values ($1, $2, $3, true, 100, 'completed')`, [id(23), LEARNER, id(3)]);
await q(`insert into p2p_user_highlights (id, user_id, lesson_id, section_id, text) values ($1, $2, $3, $4, 'grace')`, [id(24), LEARNER, id(3), id(10)]);
await q(`insert into p2p_user_notes (id, user_id, lesson_id, module_id, body) values ($1, $2, $3, $4, 'private note')`, [id(25), LEARNER, id(3), id(2)]);
await q(`insert into p2p_journal_reflections (id, user_id, linked_lesson_id, content) values ($1, $2, $3, 'journal')`, [id(26), LEARNER, id(3)]);
await q(`delete from side_effects`);

const lessonTables = { p2p_lessons: [id(3)], p2p_lesson_sections: [id(10)], p2p_lesson_blocks: [id(11)], p2p_scriptures: [id(12)], p2p_reflection_questions: [id(13)],
  p2p_assignments: [id(14)], p2p_assignment_questions: [id(15)], p2p_submissions: [id(20), id(21)], p2p_lesson_evaluations: [id(22)], p2p_lesson_progress: [id(23)], p2p_user_highlights: [id(24)] };
const before = {}; for (const [t, ids] of Object.entries(lessonTables)) before[t] = await dump(t, ids);
const notesBefore = await dump("p2p_user_notes", [id(25)]), journalBefore = await dump("p2p_journal_reflections", [id(26)]);

// Authorization: a student and a moderator cannot bin a lesson.
ok("lesson: a student cannot move content to the bin", /recycle_forbidden/.test(await expectErr(`select p2p_recycle_delete($1, 'lesson', $2)`, [U.P, id(3)]) ?? ""));
ok("lesson: an admin_moderation (no Kingdom School rights) cannot either", /recycle_forbidden/.test(await expectErr(`select p2p_recycle_delete($1, 'lesson', $2)`, [U.M, id(3)]) ?? ""));
const prev = (await one(`select p2p_recycle_preview($1, 'lesson', $2) r`, [U.A, id(3)])).r;
ok("preview: counts everything that moves, including learners' work, and changes nothing",
  prev.title === "Lesson One" && prev.counts.p2p_submissions === 2 && prev.counts.p2p_lesson_evaluations === 1 && prev.counts.p2p_lesson_progress === 1 && prev.links === 2 && prev.blocked === null
  && (await one(`select count(*)::int n from p2p_lessons where id = $1`, [id(3)])).n === 1, JSON.stringify(prev));

const del = await binDelete(U.A, "lesson", id(3));
ok("lesson: moved to the bin — gone from every normal view, with all dependants",
  (await one(`select count(*)::int n from p2p_lessons where id = $1`, [id(3)])).n === 0 && (await one(`select count(*)::int n from p2p_submissions`)).n === 0
  && (await one(`select count(*)::int n from p2p_lessons where id = $1`, [id(4)])).n === 1);
ok("lesson: links outside the item were cleared (notes, journal keep their text)",
  (await one(`select lesson_id, module_id, body from p2p_user_notes where id = $1`, [id(25)])).lesson_id === null
  && (await one(`select linked_lesson_id from p2p_journal_reflections where id = $1`, [id(26)])).linked_lesson_id === null);
const entry = await one(`select * from p2p_recycle_bin where id = $1`, [del.entryId]);
ok("bin entry: who, what, where, original status", entry.content_type === "lesson" && entry.title === "Lesson One" && entry.parent_label === "Module A"
  && entry.parent_id === id(2) && entry.original_status === "published" && entry.deleted_by === U.A && entry.status === "in_bin");

const res = await binRestore(U.B, del.entryId);
let same = true; for (const [t, ids] of Object.entries(lessonTables)) if ((await dump(t, ids)) !== before[t]) { same = false; console.log("  differs:", t); }
ok("lesson: restored with the same ids and exact values (content AND learners' work)", same && res.restored === true && res.warnings.length === 0, JSON.stringify(res));
ok("lesson: cleared links re-linked", (await dump("p2p_user_notes", [id(25)])) === notesBefore && (await dump("p2p_journal_reflections", [id(26)])) === journalBefore);
ok("restore did not re-run side effects (no evaluator assigned, no notification, no tree growth)", (await one(`select count(*)::int n from side_effects`)).n === 0);
await q(`insert into p2p_submissions (user_id, lesson_id, text_content) values ($1, $2, 'new answer')`, [LEARNER, id(3)]);
ok("side-effect triggers still run for normal new work", (await one(`select count(*)::int n from side_effects`)).n === 2);
ok("restored publication state kept (published lesson stays published, draft stays draft)",
  (await one(`select status from p2p_lessons where id = $1`, [id(3)])).status === "published" && (await one(`select status from p2p_lessons where id = $1`, [id(4)])).status === "draft");
ok("duplicate restore refused", /recycle_not_in_bin/.test(await expectErr(`select p2p_recycle_restore($1, $2)`, [U.A, del.entryId]) ?? ""));

// Module → curriculum, and restore order (child before parent explained).
const delLesson2 = await binDelete(U.A, "lesson", id(4));
const delModule = await binDelete(U.A, "module", id(2));
ok("module: takes its remaining lesson and its learners' work", (await one(`select count(*)::int n from p2p_lessons`)).n === 0
  && (await one(`select (counts->>'p2p_submissions')::int n from p2p_recycle_bin where id = $1`, [delModule.entryId])).n === 3);
ok("lesson restore before its module is explained (missing parent), nothing changes",
  /recycle_missing_parent/.test(await expectErr(`select p2p_recycle_restore($1, $2)`, [U.A, delLesson2.entryId]) ?? "")
  && (await one(`select status from p2p_recycle_bin where id = $1`, [delLesson2.entryId])).status === "in_bin");
await binRestore(U.A, delModule.entryId);
await binRestore(U.A, delLesson2.entryId);
ok("module then lesson restored", (await one(`select count(*)::int n from p2p_lessons`)).n === 2 && (await one(`select count(*)::int n from p2p_submissions`)).n === 3);
const delCur = await binDelete(U.A, "curriculum", id(1));
ok("curriculum: whole tree in one entry", (await one(`select count(*)::int n from p2p_modules`)).n === 0
  && (await one(`select counts from p2p_recycle_bin where id = $1`, [delCur.entryId])).counts.p2p_lessons === 2);
await binRestore(U.A, delCur.entryId);
ok("curriculum restored", (await one(`select count(*)::int n from p2p_lessons`)).n === 2 && (await one(`select count(*)::int n from p2p_lesson_evaluations`)).n === 1);

// A single lesson content block (removed in the block editor).
const blockBefore = await dump("p2p_lesson_blocks", [id(11)]);
const delBlock = await binDelete(U.A, "lesson_block", id(11));
const blkTitle = (await one(`select title from p2p_recycle_bin where id = $1`, [delBlock.entryId])).title, blkN = (await one(`select count(*)::int n from p2p_lesson_blocks`)).n;
ok("lesson block: binned with a readable title", blkN === 0
  && blkTitle === "Text block: hi", `${blkN} ${blkTitle}`);
await binRestore(U.A, delBlock.entryId);
ok("lesson block: restored exactly", (await dump("p2p_lesson_blocks", [id(11)])) === blockBefore);
// Signed-in clients can no longer hard-delete Kingdom School rows directly.
await db.exec(`grant select, insert, update, delete on p2p_curriculums, p2p_modules, p2p_lessons to authenticated`);
await db.exec(read("214_admin_recycle_bin.sql")); // re-applying 214 is idempotent; it revokes direct deletes again
await db.exec(`set role authenticated`);
const direct = await expectErr(`delete from p2p_lessons where id = $1`, [id(4)]);
await db.exec(`reset role`);
ok("direct client delete of a lesson refused (must go through the bin)", /permission denied/.test(direct ?? ""), direct);

// Conflict: a row with the same id came back another way → refused, unchanged.
const delSec = await binDelete(U.A, "lesson", id(4));
await q(`insert into p2p_lessons (id, module_id, title) values ($1, $2, 'Recreated')`, [id(4), id(2)]);
ok("conflict: refused when the id exists again, entry stays in the bin",
  /recycle_conflict/.test(await expectErr(`select p2p_recycle_restore($1, $2)`, [U.A, delSec.entryId]) ?? "")
  && (await one(`select title from p2p_lessons where id = $1`, [id(4)])).title === "Recreated");

// The hidden storybook curriculum (212) is never binned.
const sysCur = await one(`select id from p2p_curriculums where type = 'kingdom_story'`);
ok("the storybook's system curriculum exists (212) and is refused", !!sysCur && /recycle_system_content/.test(await expectErr(`select p2p_recycle_delete($1, 'curriculum', $2)`, [U.S, sysCur.id]) ?? ""));
await q(`insert into p2p_modules (id, curriculum_id, title) values ($1, $2, 'Story module')`, [id(50), sysCur.id]);
await q(`insert into p2p_lessons (id, module_id, title) values ($1, $2, 'Story chapter lesson')`, [id(51), id(50)]);
ok("fixed 212 guard: the storybook's modules and lessons still cannot be deleted directly",
  /kingdom_story_learning_kept/.test(await expectErr(`delete from p2p_lessons where id = $1`, [id(51)]) ?? "")
  && /kingdom_story_learning_kept/.test(await expectErr(`delete from p2p_modules where id = $1`, [id(50)]) ?? ""));
ok("…nor binned", /recycle_system_content/.test(await expectErr(`select p2p_recycle_delete($1, 'lesson', $2)`, [U.S, id(51)]) ?? "")
  && /recycle_system_content/.test(await expectErr(`select p2p_recycle_delete($1, 'module', $2)`, [U.S, id(50)]) ?? ""));

// ── Kingdom Stories ─────────────────────────────────────────────────────────
const S1 = id(100);
await q(`insert into p2p_kingdom_story_topics (id, slug, title, category_id, status) values ($1, 'topic-x', 'Topic X', $2, 'drafting')`, [id(99), catId]);
await q(`insert into p2p_kingdom_stories (id, title, body, category_id, status, topic_id) values ($1, 'Daniel', 'Body', $2, 'draft', $3)`, [S1, catId, id(99)]);
await q(`insert into p2p_kingdom_story_chapters (id, story_id, chapter_number, title, narrative) values ($1, $2, 1, 'Ch 1', 'N1'), ($3, $2, 2, 'Ch 2', 'N2')`, [id(101), S1, id(102)]);
await q(`insert into p2p_kingdom_story_media (id, story_id, media_type, media_path, chapter_id, is_cover) values ($1, $2, 'image', $3, null, true), ($4, $2, 'image', $5, $6, false)`,
  [id(103), S1, `${S1}/cover.jpg`, id(104), `${S1}/ch1.jpg`, id(101)]);
await q(`insert into p2p_kingdom_story_sources (id, story_id, title, chapter_id) values ($1, $2, 'Source', $3)`, [id(105), S1, id(101)]);
ok("stories: only Kingdom Stories editors may bin them", /recycle_forbidden/.test(await expectErr(`select p2p_recycle_delete($1, 'kingdom_story', $2)`, [U.M, S1]) ?? ""));
await q(`update p2p_kingdom_stories set status = 'review' where id = $1`, [S1]);
const storyBefore = await dump("p2p_kingdom_stories", [S1]), chBefore = await dump("p2p_kingdom_story_chapters", [id(101), id(102)]), mediaBefore = await dump("p2p_kingdom_story_media", [id(103), id(104)]);
const delStory = await binDelete(U.A, "kingdom_story", S1);
ok("story: binned with chapters, images and sources", (await one(`select count(*)::int n from p2p_kingdom_story_chapters`)).n === 0
  && JSON.stringify((await one(`select storage_paths from p2p_recycle_bin where id = $1`, [delStory.entryId])).storage_paths.map((f) => f.path).sort()) === JSON.stringify([`${S1}/ch1.jpg`, `${S1}/cover.jpg`]));
ok("story deletion audited in the Studio log as the editor, via the bin",
  !!(await one(`select 1 x from p2p_studio_audit_log where action = 'story.deleted' and source_id = $1 and actor_id = $2 and details->>'path' = 'recycle_bin'`, [S1, U.A])));
await binRestore(U.A, delStory.entryId);
ok("story: restored exactly, still in review (never published by a restore)",
  (await dump("p2p_kingdom_stories", [S1])) === storyBefore && (await dump("p2p_kingdom_story_chapters", [id(101), id(102)])) === chBefore
  && (await dump("p2p_kingdom_story_media", [id(103), id(104)])) === mediaBefore && (await one(`select status from p2p_kingdom_stories where id = $1`, [S1])).status === "review");

// Chapter into a taken position → goes at the end, with a warning.
const delCh = await binDelete(U.A, "kingdom_story_chapter", id(101));
ok("chapter: binned with its image and source", (await one(`select count(*)::int n from p2p_kingdom_story_media where chapter_id = $1`, [id(101)])).n === 0
  && (await one(`select count(*)::int n from p2p_kingdom_story_sources`)).n === 0);
await q(`update p2p_kingdom_story_chapters set chapter_number = 1 where id = $1`, [id(102)]);
const chRes = await binRestore(U.A, delCh.entryId);
ok("chapter: restored at the end when its number is taken (warning explains)", (await one(`select chapter_number from p2p_kingdom_story_chapters where id = $1`, [id(101)])).chapter_number === 2
  && /Restored as chapter 2/.test(chRes.warnings[0] ?? ""), JSON.stringify(chRes));

// A live story is not binned (the Studio's freeze): unpublish first.
// (Published directly with triggers off: the Studio approval flow is tested elsewhere.)
await db.exec(`set session_replication_role = replica`); await q(`update p2p_kingdom_stories set status = 'published' where id = $1`, [S1]); await db.exec(`set session_replication_role = origin`);
ok("live story refused (unpublish first); its chapters/images too",
  /recycle_live_story/.test(await expectErr(`select p2p_recycle_delete($1, 'kingdom_story', $2)`, [U.A, S1]) ?? "")
  && /recycle_live_story/.test(await expectErr(`select p2p_recycle_delete($1, 'kingdom_story_media', $2)`, [U.A, id(103)]) ?? "")
  && (await one(`select (p2p_recycle_preview($1, 'kingdom_story', $2))->>'blocked' b`, [U.A, S1])).b === "recycle_live_story");
await db.exec(`set session_replication_role = replica`); await q(`update p2p_kingdom_stories set status = 'draft' where id = $1`, [S1]); await db.exec(`set session_replication_role = origin`);

// Topic: the story's link is cleared and re-linked.
const delTopic = await binDelete(U.A, "kingdom_story_topic", id(99));
ok("topic: binned; the story keeps existing with its link cleared", (await one(`select topic_id from p2p_kingdom_stories where id = $1`, [S1])).topic_id === null);
await binRestore(U.A, delTopic.entryId);
ok("topic: restored and the story re-linked", (await one(`select topic_id from p2p_kingdom_stories where id = $1`, [S1])).topic_id === id(99));

// Optional link to something removed meanwhile → cleared with a warning.
const delStory2 = await binDelete(U.A, "kingdom_story", S1);
const delTopic2 = await binDelete(U.A, "kingdom_story_topic", id(99));
const r2 = await binRestore(U.A, delStory2.entryId);
ok("story restored while its topic is in the bin: link cleared, warned", (await one(`select topic_id from p2p_kingdom_stories where id = $1`, [S1])).topic_id === null
  && r2.warnings.some((w) => /kingdom_story_topics/.test(w)), JSON.stringify(r2));
await binRestore(U.A, delTopic2.entryId);

// ── Prayer / missions ───────────────────────────────────────────────────────
await q(`insert into p2p_prayer_topics (id, title, status) values ($1, 'Peace', 'published')`, [id(200)]);
await q(`insert into p2p_prayer_paths (id, title, status, topic_id) values ($1, 'Path', 'published', $2)`, [id(201), id(200)]);
await q(`insert into p2p_prayer_path_steps (id, path_id, step_order) values ($1, $2, 1), ($3, $2, 2)`, [id(202), id(201), id(203)]);
await q(`insert into p2p_prayer_path_progress (id, user_id, path_id, current_step) values ($1, $2, $3, 2)`, [id(204), LEARNER, id(201)]);
const delPath = await binDelete(U.M, "prayer_path", id(201));
ok("prayer path: any admin (as today); steps and learners' progress go with it", (await one(`select count(*)::int n from p2p_prayer_path_progress`)).n === 0);
await binRestore(U.M, delPath.entryId);
ok("prayer path: restored with progress", (await one(`select current_step from p2p_prayer_path_progress where id = $1`, [id(204)])).current_step === 2);
const delStep = await binDelete(U.M, "prayer_path_step", id(202));
await q(`update p2p_prayer_path_steps set step_order = 1 where id = $1`, [id(203)]);
const stepRes = await binRestore(U.M, delStep.entryId);
ok("path step restored at the end when its position is taken", (await one(`select step_order from p2p_prayer_path_steps where id = $1`, [id(202)])).step_order === 2 && stepRes.warnings.length === 1);
const delPTopic = await binDelete(U.M, "prayer_topic", id(200));
ok("prayer topic: the path survives with its link cleared", (await one(`select topic_id from p2p_prayer_paths where id = $1`, [id(201)])).topic_id === null);
await binRestore(U.M, delPTopic.entryId);
ok("prayer topic: re-linked", (await one(`select topic_id from p2p_prayer_paths where id = $1`, [id(201)])).topic_id === id(200));
await q(`insert into p2p_mission_fields (id, title) values ($1, 'Field')`, [id(300)]);
await q(`insert into p2p_mission_stories (id, title, mission_field_id, media_path) values ($1, 'Story', $2, 'm/1.mp3')`, [id(301), id(300)]);
await q(`insert into p2p_mission_prayer_points (id, title, mission_field_id) values ($1, 'Point', $2)`, [id(302), id(300)]);
const delField = await binDelete(U.M, "mission_field", id(300));
ok("mission field: prayer points go with it, the story keeps existing (link cleared)",
  (await one(`select count(*)::int n from p2p_mission_prayer_points`)).n === 0 && (await one(`select mission_field_id from p2p_mission_stories where id = $1`, [id(301)])).mission_field_id === null);
await binRestore(U.M, delField.entryId);
ok("mission field restored, points back, story re-linked", (await one(`select count(*)::int n from p2p_mission_prayer_points`)).n === 1
  && (await one(`select mission_field_id from p2p_mission_stories where id = $1`, [id(301)])).mission_field_id === id(300));

// ── Purge ───────────────────────────────────────────────────────────────────
const delMs = await binDelete(U.M, "mission_story", id(301));
ok("purge: admins other than super_admin refused", /recycle_forbidden/.test(await expectErr(`select p2p_recycle_purge($1, $2)`, [U.A, delMs.entryId]) ?? ""));
const pg1 = (await one(`select p2p_recycle_purge($1, $2) r`, [U.S, delMs.entryId])).r;
ok("purge: snapshot dropped, the unused file is returned for removal", pg1.purged === true && pg1.files.length === 1 && pg1.files[0].path === "m/1.mp3"
  && (await one(`select snapshot from p2p_recycle_bin where id = $1`, [delMs.entryId])).snapshot === null);
ok("purged entry cannot be restored", /recycle_not_in_bin/.test(await expectErr(`select p2p_recycle_restore($1, $2)`, [U.M, delMs.entryId]) ?? ""));
// A file another live row still uses is kept.
const delCover = await binDelete(U.A, "kingdom_story_media", id(103));
await q(`insert into p2p_kingdom_story_media (story_id, media_type, media_path) values ($1, 'image', $2)`, [S1, `${S1}/cover.jpg`]);
const pg2 = (await one(`select p2p_recycle_purge($1, $2) r`, [U.S, delCover.entryId])).r;
ok("purge: a file still used by another image is kept", pg2.files.length === 0 && pg2.keptFiles === 1);

// ── Server-only ─────────────────────────────────────────────────────────────
const asAuth = async (sql, p) => { await db.exec(`set role authenticated`); try { return await expectErr(sql, p); } finally { await db.exec(`reset role`); } };
ok("signed-in users cannot read the bin or call the functions directly",
  /permission denied/.test(await asAuth(`select * from p2p_recycle_bin`) ?? "") && /permission denied/.test(await asAuth(`select p2p_recycle_delete($1, 'lesson', $2)`, [U.S, id(3)]) ?? ""));

console.log(`recycle bin (214): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
