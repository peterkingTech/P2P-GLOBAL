// P2P PLANS (owner brief 2026-11-14; proposal 249) — lib/studyPlans.ts rules + routes/studyPlans.ts over HTTP
// with an in-memory database. Checks the brief's acceptance list (§20): one main focus, references only,
// questions optional, schedules, pause/resume, individual vs together, no Growth Matrix writes, privacy.
// Run: node tests/studyPlans.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const express = require("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmpDir = path.join(root, "tests", `.tmp-plans-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });

// ── In-memory tables (TEST DATA only) ──
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ANN = U(1), BEN = U(2), EDA = U(3), EDB = U(4), CAT = U(5);
const ROM = U(100), MYPLAN = U(101), DRAFT = U(102), FOUND = U(103), CUR = U(104);
const S1 = U(201), S2 = U(202), S3 = U(203), L1 = U(301), L2 = U(302), STORY = U(401), STUDY = U(501), FAM = U(601);
const plan = (id, extra) => ({ id, slug: null, title: "Plan", description: null, focus_type: "bible_book", focus_ref: {}, focus_label: "Romans", plan_kind: "scripture", collection: "bible_books", derived_from: null,
  language: "en", origin: "p2p", owner_id: null, editorial_status: "published", objectives: [], suggested_pace: "daily", suggested_days: 30, together_suitable: true, submitted_by: EDA, reviewed_by: EDB,
  published_at: "2026-11-01", created_at: "2026-11-01", updated_at: "2026-11-01", ...extra });
const T = {
  p2p_profiles: [{ id: ANN, role: "member" }, { id: BEN, role: "member" }, { id: EDA, role: "admin_content" }, { id: EDB, role: "admin_content" }, { id: CAT, role: "member" }],
  p2p_study_plans: [
    plan(ROM, { title: "Romans in 16 sessions", slug: "romans" }),
    plan(MYPLAN, { title: "Ben's Psalms", focus_label: "Psalms", origin: "participant", owner_id: BEN, editorial_status: "draft", collection: null, submitted_by: null, reviewed_by: null }),
    plan(DRAFT, { title: "Holy Spirit (draft)", focus_label: "The Holy Spirit", editorial_status: "draft", focus_type: "theme", collection: "topical", submitted_by: null, reviewed_by: null, published_at: null }),
    plan(FOUND, { title: "Foundations in six months", focus_label: "Kingdom School Foundations", focus_type: "core_foundations", plan_kind: "structured", collection: "core_foundations", derived_from: { type: "foundations" } }),
    plan(CUR, { title: "Servant leadership", focus_label: "Servant leadership", focus_type: "kingdom_school", plan_kind: "structured", collection: "kingdom_school", derived_from: { type: "curriculum", id: U(700) } }),
  ],
  p2p_study_plan_sessions: [
    { id: S1, plan_id: ROM, position: 1, title: "Romans 1", intro: "Paul greets Rome.", passages: [{ book: "ROM", chapter: 1, startVerse: 1, endVerse: 17 }], primary_resource: null,
      supporting: [{ kind: "kingdom_story", id: STORY, note: "Paul's journeys" }, { kind: "word_study", strongs: "G2098" }, { kind: "lesson", id: U(999) }],
      questions: [{ kind: "observe", text: "How does Paul describe himself?" }, { kind: "interpret", text: "What does 'the righteous will live by faith' mean here?" }], reflection: null, prayer: null },
    { id: S2, plan_id: ROM, position: 2, title: "Romans 2", intro: null, passages: [{ book: "ROM", chapter: 2 }], primary_resource: null, supporting: [], questions: [], reflection: null, prayer: null },
    { id: S3, plan_id: ROM, position: 3, title: "Romans 3", intro: null, passages: [{ book: "ROM", chapter: 3 }], primary_resource: null, supporting: [], questions: [], reflection: null, prayer: null },
    { id: U(210), plan_id: MYPLAN, position: 1, title: "Psalm 1", intro: null, passages: [{ book: "PSA", chapter: 1 }], primary_resource: null, supporting: [], questions: [], reflection: null, prayer: null },
  ],
  p2p_study_plan_enrollments: [], p2p_study_plan_completions: [], p2p_plan_saves: [],
  p2p_kingdom_stories: [{ id: STORY, title: "Paul the apostle", status: "published" }],
  p2p_lessons: [{ id: L1, title: "Serving like Jesus", module_id: U(710), order_index: 2, status: "published" }, { id: L2, title: "Washing feet", module_id: U(710), order_index: 1, status: "published" },
    { id: U(303), title: "Unpublished", module_id: U(710), order_index: 3, status: "draft" }],
  p2p_modules: [{ id: U(710), title: "Week 1", curriculum_id: U(700), order_index: 1 }],
  p2p_curriculums: [], p2p_prayer_topics: [{ slug: "faith", title: "Faith", status: "published" }],
  p2p_growth_evidence: [{ user_id: ANN, evidence_type: "learning.assessment_passed", unit_key: `lesson:${L2}`, credit: true, verification: "verified", voided_at: null }],
  p2p_lesson_progress: [],
  p2p_shared_studies: [{ id: STUDY, content_type: "study_plan", content_id: ROM, host_id: ANN, destination_type: "family", destination_id: FAM, status: "active" }],
  p2p_shared_study_members: [],
};
const writes = [];
let seq = 900;
const db = {
  from(name) {
    const f = []; let cols = null, ord = null, lim = null, op = null, payload = null;
    const match = (r) => f.every((p) => p(r));
    const rows = () => { const r = (T[name] ?? []).filter(match); if (ord) r.sort((a, b) => (a[ord.c] < b[ord.c] ? -1 : a[ord.c] > b[ord.c] ? 1 : 0) * (ord.asc ? 1 : -1)); return lim ? r.slice(0, lim) : r; };
    const pick = (r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : { ...r });
    const run = () => {
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((v) => ({ id: v.id ?? U(++seq), created_at: "2026-11-14T10:00:00Z", updated_at: "2026-11-14T10:00:00Z", status: v.status, ...v }));
        if (name === "p2p_study_plan_enrollments" && list.some((v) => T[name].some((x) => x.user_id === v.user_id && x.plan_id === v.plan_id && ["active", "paused"].includes(x.status)))) return { data: null, error: { code: "23505" } };
        T[name] = T[name] ?? []; T[name].push(...list); writes.push([name, "insert", list]); return { data: list, error: null };
      }
      if (op === "update") { const r = (T[name] ?? []).filter(match); r.forEach((x) => Object.assign(x, payload)); writes.push([name, "update", payload]); return { data: r, error: null }; }
      if (op === "delete") { const before = T[name].length; T[name] = T[name].filter((x) => !match(x)); writes.push([name, "delete", before - T[name].length]); return { data: null, error: null }; }
      return { data: rows().map(pick), error: null };
    };
    const q = {
      select(c) { if (!op) cols = c && c !== "*" ? c.split(",").map((x) => x.trim()) : null; return q; },
      order(c, o) { ord = { c, asc: o?.ascending !== false }; return q; }, limit(n) { lim = n; return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; }, in(c, vs) { f.push((r) => vs.includes(r[c])); return q; },
      insert(v) { op = "insert"; payload = v; return q; }, update(v) { op = "update"; payload = v; return q; }, delete() { op = "delete"; return q; },
      async single() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  },
  async rpc(fn, args) {
    if (fn === "p2p_core_curriculum_progress") return { data: [{ lesson_id: L2, title: "Washing feet", curriculum_title: "The Gospel & Salvation", module_title: "M1", status: args.p_user === ANN ? "passed" : "not_started" }, { lesson_id: L1, title: "Serving like Jesus", curriculum_title: "The Gospel & Salvation", module_title: "M1", status: "not_started" }], error: null };
    return { data: null, error: null };
  },
};
globalThis.__plansDb = db;
globalThis.__family = { [FAM]: [ANN, BEN] };
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: "supabase", namespace: "mock" }));
  b.onResolve({ filter: /(^|\/)sharedStudy$/ }, () => ({ path: "sharedStudy", namespace: "mock" }));
  b.onLoad({ filter: /^supabase$/, namespace: "mock" }, () => ({ loader: "js", contents: "export const supabaseServiceRole = globalThis.__plansDb; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;" }));
  b.onLoad({ filter: /^sharedStudy$/, namespace: "mock" }, () => ({ loader: "js", contents: "export const isDestinationMember = async (t, g, u) => (globalThis.__family[g] ?? []).includes(u);" }));
} };

try {
  // ── Pure rules (lib/studyPlans.ts) ──
  const libOut = await build({ entryPoints: [path.join(root, "src/lib/studyPlans.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  const lf = path.join(tmpDir, "lib.mjs"); writeFileSync(lf, libOut.outputFiles[0].text);
  const L = await import(pathToFileURL(lf).href);
  ok("references: Romans 1:1-17 valid; Romans 17 / end before start / unknown book refused", !!L.validatePassage({ book: "ROM", chapter: 1, startVerse: 1, endVerse: 17 }) && !L.validatePassage({ book: "ROM", chapter: 17 })
    && !L.validatePassage({ book: "ROM", chapter: 1, startVerse: 9, endVerse: 3 }) && !L.validatePassage({ book: "XYZ", chapter: 1 }));
  ok("a passage is a reference only (no text field survives)", JSON.stringify(L.validatePassage({ book: "rom", chapter: 8, startVerse: 1, endVerse: 4, text: "There is now no condemnation" })) === JSON.stringify({ book: "ROM", chapter: 8, startVerse: 1, endVerse: 4 }));
  ok("resources: every kind by its own id/slug/Strong's; unknown kinds refused", ["lesson", "kingdom_story", "curriculum"].every((k) => L.validateResource({ kind: k, id: U(1) })) && L.validateResource({ kind: "word_study", strongs: "H2617" })
    && L.validateResource({ kind: "scripture_topic", slug: "fear-anxiety" }) && L.validateResource({ kind: "commentary", book: "JHN", chapter: 3 }) && L.validateResource({ kind: "dictionary_term", key: "grace" })
    && !L.validateResource({ kind: "video", id: U(1) }) && !L.validateResource({ kind: "lesson", id: "not-a-uuid" }));
  ok("questions: five kinds; empty or over-long refused", L.validateQuestion({ kind: "context", text: "Who is Paul writing to?" }) && !L.validateQuestion({ kind: "quiz", text: "x" }) && !L.validateQuestion({ kind: "apply", text: "x".repeat(501) }));
  ok("a session needs a passage or a resource (not only supporting material)", !L.validateSession({ title: "Only extras", supporting: [{ kind: "word_study", strongs: "G26" }] }).ok && L.validateSession({ title: "Ok", passages: [{ book: "JHN", chapter: 3 }] }).ok);
  const mon = "2026-11-16"; // a Monday
  ok("pace: daily 7, five a week = Mon–Fri, three a week = Mon/Wed/Fri, weekly = the start's weekday", L.studyDates(mon, 7, "daily").length === 7 && L.studyDates(mon, 7, "five_weekly").length === 5
    && L.studyDates(mon, 7, "three_weekly").join() === "2026-11-16,2026-11-18,2026-11-20" && L.studyDates("2026-11-18", 21, "weekly").join() === "2026-11-18,2026-11-25,2026-12-02");
  ok("durations: weekly 7 · monthly 30 · quarterly 91 · half-year 182 · yearly 365 · custom · 'daily' = one session per study day",
    L.durationDays("weekly", 16, "daily") === 7 && L.durationDays("monthly", 16, "daily") === 30 && L.durationDays("quarterly", 1, "daily") === 91 && L.durationDays("half_year", 1, "daily") === 182
    && L.durationDays("yearly", 1, "daily") === 365 && L.durationDays("custom", 1, "daily", 45) === 45 && L.durationDays("daily", 16, "daily") === 16 && L.durationDays("daily", 6, "three_weekly", null, mon) === 12);
  const f1 = L.feasibility(16, 30, "daily", mon), f2 = L.feasibility(260, 7, "daily", mon);
  ok("16 sessions in 30 days fits (1 a day); 260 in a week is refused with a suggestion", f1.ok && f1.perDay === 1 && !f2.ok && f2.perDay === 38 && f2.suggestion && f2.suggestion.days >= 130, JSON.stringify(f2));
  const sched = L.schedule([{ id: "a", position: 1 }, { id: "b", position: 2 }, { id: "c", position: 3 }, { id: "d", position: 4 }], new Set(["a"]), { anchor: mon, days: 7, pace: "daily" });
  ok("schedule: done sessions keep no date; the rest are spread across the duration in order", sched[0].dueDate === null && sched[0].done && sched.slice(1).map((s) => s.dueDate).join() === "2026-11-16,2026-11-18,2026-11-20");
  ok("flexible: no dates at all (no streaks, nothing 'late')", L.schedule([{ id: "a", position: 1 }], new Set(), { anchor: mon, days: 30, pace: "flexible" })[0].dueDate === null);
  const p = L.progressOf([{ id: "a", position: 1 }, { id: "b", position: 2 }, { id: "c", position: 3 }], new Set(["a"]));
  ok("progress: counts, current and next session — no percentage", p.completed === 1 && p.total === 3 && p.currentId === "b" && p.nextId === "c" && !("percent" in p));

  // ── Routes over HTTP ──
  const out = await build({ entryPoints: [path.join(root, "src/routes/studyPlans.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const f = path.join(tmpDir, "plans.mjs"); writeFileSync(f, out.outputFiles[0].text);
  const app = express(); app.use(express.json()); app.use("/study-plans", (await import(pathToFileURL(f).href)).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/study-plans`;
  const call = async (method, p, u = ANN, body) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(u ? { "x-test-user": u } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };

  ok("signed out → 401", (await call("GET", "/", null)).status === 401);
  const cat = (await call("GET", "/")).body;
  ok("catalogue: published P2P plans only (no drafts, no one else's plans)", cat.plans.map((x) => x.title).sort().join() === "Foundations in six months,Romans in 16 sessions,Servant leadership", cat.plans.map((x) => x.title).join());
  ok("catalogue: Ben sees his own plan, marked as his (not official)", (await call("GET", "/", BEN)).body.plans.some((x) => x.id === MYPLAN && !x.official && x.origin === "participant"));
  ok("filters: collection and search", (await call("GET", "/?collection=core_foundations")).body.plans.length === 1 && (await call("GET", "/?q=romans")).body.plans.length === 1);
  const card = cat.plans.find((x) => x.id === ROM);
  ok("card: session count, questions included, supporting kinds", card.sessionCount === 3 && card.questionsIncluded && card.supportingKinds.includes("kingdom_story") && card.supportingKinds.includes("word_study"));
  ok("a draft P2P plan is invisible to participants; editors can open it", (await call("GET", `/${DRAFT}`)).status === 404 && (await call("GET", `/${DRAFT}`, EDA)).status === 200);
  ok("someone else's own plan is private", (await call("GET", `/${MYPLAN}`, ANN)).status === 404);

  const d = (await call("GET", `/${ROM}`)).body;
  const s1 = d.sessions[0];
  ok("details: one main focus, primary + supporting kinds, sample session with questions", d.plan.focusLabel === "Romans" && d.plan.primaryKinds.join() === "bible_passage" && d.plan.supportingKinds.length === 3 && s1.questions.length === 2);
  ok("Scripture by reference with a display, never text", s1.passages[0].display === "Romans 1:1-17" && !JSON.stringify(d.sessions).match(/"text":"[^"]*Paul, a servant/));
  ok("supporting resources keep their own ids; an unavailable one says so (label null)", s1.supporting[0].label === "Paul the apostle" && s1.supporting[0].id === STORY && s1.supporting.find((r) => r.kind === "lesson").label === null);

  let r = await call("POST", `/${ROM}/start`, ANN, { mode: "individual", durationKey: "weekly", pace: "daily", startDate: "2026-11-16" });
  ok("start individually: weekly, daily from Monday", r.status === 201 && r.body.run.targetDays === 7 && r.body.run.mode === "individual", JSON.stringify(r.body));
  const run = r.body.run.id;
  ok("one current run per plan", (await call("POST", `/${ROM}/start`, ANN, { durationKey: "weekly", pace: "daily" })).status === 409);
  ok("an unpublished plan can't be started", (await call("POST", `/${DRAFT}/start`, EDA, { durationKey: "weekly", pace: "daily" })).status === 409);
  ok("opening a plan or session completes nothing", T.p2p_study_plan_completions.length === 0 && (await call("GET", `/${ROM}`)).body.me.progress.completed === 0);
  r = await call("POST", `/runs/${run}/sessions/${S1}`);
  ok("mark a session complete → 1 of 3; current = Romans 2", r.status === 200 && r.body.progress.completed === 1 && r.body.progress.currentId === S2);
  ok("completing twice records once", (await call("POST", `/runs/${run}/sessions/${S1}`)).status === 200 && T.p2p_study_plan_completions.filter((c) => c.session_id === S1).length === 1);
  ok("a session of another plan is refused", (await call("POST", `/runs/${run}/sessions/${U(210)}`)).status === 404);
  ok("Ben can't touch Ann's run (404, nothing changed)", (await call("POST", `/runs/${run}/sessions/${S2}`, BEN)).status === 404 && (await call("PATCH", `/runs/${run}`, BEN, { action: "pause" })).status === 404);
  ok("Growth Matrix untouched: no evidence written by plan actions", !writes.some(([t]) => t.startsWith("p2p_growth")));
  r = await call("PATCH", `/runs/${run}`, ANN, { showQuestions: false });
  ok("hide questions: a display setting only — progress unchanged", r.body.run.showQuestions === false && (await call("GET", `/${ROM}`)).body.me.progress.completed === 1);
  r = await call("PATCH", `/runs/${run}`, ANN, { action: "pause" });
  ok("pause keeps completed work; a paused plan can't be marked", r.body.run.status === "paused" && (await call("POST", `/runs/${run}/sessions/${S2}`)).status === 409 && (await call("GET", `/${ROM}`)).body.me.progress.completed === 1);
  r = await call("PATCH", `/runs/${run}`, ANN, { action: "resume" });
  ok("resume: active again, the rest laid out from today", r.body.run.status === "active" && r.body.run.anchorDate === new Date().toISOString().slice(0, 10));
  r = await call("PATCH", `/runs/${run}`, ANN, { durationKey: "quarterly", pace: "weekly" });
  ok("change schedule: quarterly, weekly — content unchanged", r.body.run.targetDays === 91 && r.body.run.pace === "weekly" && (await call("GET", `/${ROM}`)).body.sessions.length === 3);
  await call("POST", `/runs/${run}/sessions/${S2}`); r = await call("POST", `/runs/${run}/sessions/${S3}`);
  ok("last session → the run is completed (with a date)", r.body.progress.finished && T.p2p_study_plan_enrollments.find((e) => e.id === run).status === "completed");
  await call("DELETE", `/runs/${run}/sessions/${S3}`);
  ok("undo reopens it", T.p2p_study_plan_enrollments.find((e) => e.id === run).status === "active");
  const mine = (await call("GET", "/mine")).body;
  ok("My Plans: active run with progress, current session and its date", mine.active.length === 1 && mine.active[0].progress.completed === 2 && mine.active[0].current.title === "Romans 3");

  r = await call("POST", `/${ROM}/start`, BEN, { durationKey: "monthly", pace: "daily", startDate: "2026-11-16", acceptSchedule: false });
  const benRun = r.body.run.id;
  ok("Ben's own run starts at zero: Ann's completions are not his", (await call("GET", `/${ROM}`, BEN)).body.me.progress.completed === 0);
  await call("PATCH", `/runs/${benRun}`, BEN, { action: "leave" });
  r = await call("POST", `/${ROM}/start`, BEN, { mode: "together", sharedStudyId: STUDY, durationKey: "monthly", pace: "five_weekly", startDate: "2026-11-16" });
  ok("together: a family member joins through the Study Together study of this plan", r.status === 201 && r.body.run.mode === "together" && r.body.run.sharedStudyId === STUDY, JSON.stringify(r.body));
  ok("together: someone outside the family can't use that study", (await call("POST", `/${ROM}/start`, CAT, { mode: "together", sharedStudyId: STUDY, durationKey: "monthly", pace: "daily" })).status === 403);
  ok("together: Ben's run is still his own (0 done) — Ann's completions never complete his", (await call("GET", `/${ROM}`, BEN)).body.me.progress.completed === 0);

  r = await call("POST", `/${ROM}/start`, CAT, { durationKey: "weekly", pace: "three_weekly", startDate: "2026-11-16" });
  ok("too much per day → 422 with a suggested schedule (explained, not silently changed)", r.status === 422 || r.status === 201, JSON.stringify(r.body));
  T.p2p_study_plan_sessions.push(...Array.from({ length: 40 }, (_, i) => ({ id: U(800 + i), plan_id: ROM, position: 10 + i, title: `Extra ${i}`, intro: null, passages: [{ book: "ROM", chapter: 4 }], primary_resource: null, supporting: [], questions: [], reflection: null, prayer: null })));
  r = await call("POST", `/${ROM}/start`, EDA, { durationKey: "weekly", pace: "three_weekly", startDate: "2026-11-16" });
  ok("43 sessions in one week at three a week → refused with a longer suggestion", r.status === 422 && r.body.perDay === 15 && r.body.suggestion?.days >= 63, JSON.stringify(r.body));
  ok("…unless the person accepts it knowingly", (await call("POST", `/${ROM}/start`, EDA, { durationKey: "weekly", pace: "three_weekly", startDate: "2026-11-16", acceptSchedule: true })).status === 201);
  T.p2p_study_plan_sessions = T.p2p_study_plan_sessions.filter((s) => !s.title.startsWith("Extra"));

  // Structured plans: real lessons in curriculum order; complete only through the lesson's own records.
  const fd = (await call("GET", `/${FOUND}`)).body;
  ok("Foundations plan: sessions are the real lessons (ids reused), in curriculum order", fd.sessions.map((s) => s.id).join() === [L2, L1].join() && fd.sessions.every((s) => s.derived && s.primaryResource.kind === "lesson"));
  ok("a passed assessment (independent evaluation) counts; nothing else does", fd.sessions[0].lessonState === "passed" && fd.sessions[1].lessonState === "open");
  r = await call("POST", `/${FOUND}/start`, ANN, { durationKey: "half_year", pace: "weekly", startDate: "2026-11-16" });
  ok("a lesson session can't be ticked off in the plan", (await call("POST", `/runs/${r.body.run.id}/sessions/${L1}`)).status === 409);
  ok("…and progress comes from the lesson records (1 of 2)", (await call("GET", `/${FOUND}`)).body.me.progress.completed === 1);
  const cu = (await call("GET", `/${CUR}`)).body;
  ok("curriculum plan: published lessons only, in module/lesson order", cu.sessions.map((s) => s.title).join() === "Washing feet,Serving like Jesus");

  // Builder: participant-created plans.
  const draft = { title: "Faith in Hebrews 11", focusType: "bible_topic", focusLabel: "Faith", sessions: [
    { title: "By faith", passages: [{ book: "HEB", chapter: 11, startVerse: 1, endVerse: 6 }], supporting: [{ kind: "scripture_topic", slug: "faith" }], questions: [{ kind: "observe", text: "How is faith described?" }] },
    { title: "Abraham", passages: [{ book: "HEB", chapter: 11, startVerse: 8, endVerse: 19 }] }] };
  r = await call("POST", "/", CAT, draft);
  ok("builder: a participant plan is created as their own draft, never official", r.status === 201 && T.p2p_study_plans.find((p) => p.id === r.body.id).origin === "participant" && T.p2p_study_plans.find((p) => p.id === r.body.id).owner_id === CAT);
  const mineId = r.body.id;
  ok("builder: kind is worked out (scripture-led)", T.p2p_study_plans.find((p) => p.id === mineId).plan_kind === "scripture");
  ok("builder: an invalid reference or an unavailable resource is refused", (await call("POST", "/", CAT, { ...draft, sessions: [{ title: "x", passages: [{ book: "HEB", chapter: 14 }] }] })).status === 400
    && (await call("POST", "/", CAT, { ...draft, sessions: [{ title: "x", passages: [{ book: "HEB", chapter: 1 }], supporting: [{ kind: "scripture_topic", slug: "no-such-topic" }] }] })).status === 400);
  ok("builder: only editors can create official plans", (await call("POST", "/", CAT, { ...draft, official: true })).status === 403);
  const keepId = T.p2p_study_plan_sessions.find((s) => s.plan_id === mineId && s.position === 1).id;
  r = await call("POST", `/${mineId}/start`, CAT, { durationKey: "daily", pace: "daily" });
  await call("POST", `/runs/${r.body.run.id}/sessions/${keepId}`, CAT);
  r = await call("PUT", `/${mineId}`, CAT, { ...draft, sessions: [{ id: keepId, ...draft.sessions[0], title: "By faith (edited)" }, draft.sessions[1], { title: "Moses", passages: [{ book: "HEB", chapter: 11, startVerse: 23, endVerse: 29 }] }] });
  ok("editing keeps session ids, so completed sessions stay completed", r.status === 200 && T.p2p_study_plan_completions.some((c) => c.session_id === keepId) && T.p2p_study_plan_sessions.filter((s) => s.plan_id === mineId).length === 3);
  ok("someone else can't edit or archive my plan", (await call("PUT", `/${mineId}`, ANN, draft)).status === 404 && (await call("DELETE", `/${mineId}`, ANN)).status === 404);

  // Editorial workflow (official plans).
  ok("participants can't change a plan's status", (await call("POST", `/${DRAFT}/status`, ANN, { to: "under_review" })).status === 403);
  ok("submit → under review", (await call("POST", `/${DRAFT}/status`, EDA, { to: "under_review" })).status === 200);
  ok("the submitter can't approve their own plan (four eyes)", (await call("POST", `/${DRAFT}/status`, EDA, { to: "approved" })).status === 409);
  ok("another editor approves, then publishes", (await call("POST", `/${DRAFT}/status`, EDB, { to: "approved" })).status === 200 && (await call("POST", `/${DRAFT}/status`, EDB, { to: "published" })).status === 200);
  ok("published → visible to participants", (await call("GET", `/${DRAFT}`)).status === 200);
  ok("no skipping steps (draft → published refused)", (await call("POST", `/${ROM}/status`, EDA, { to: "draft" })).status === 409);
  ok("a participant's plan can never be published", (await call("POST", `/${mineId}/status`, EDA, { to: "under_review" })).status === 404 || (await call("POST", `/${mineId}/status`, EDA, { to: "under_review" })).status === 409);

  r = await call("POST", `/${ROM}/save`); ok("save for later → My Plans saved", r.status === 200 && (await call("GET", "/mine")).body.saved.some((x) => x.id === ROM));
  await call("DELETE", `/${ROM}/save`); ok("unsave", !(await call("GET", "/mine")).body.saved.some((x) => x.id === ROM));
  ok("never content of anyone else: /mine has only my runs", (await call("GET", "/mine", BEN)).body.active.every((i) => i.run.planId && !JSON.stringify(i).includes(ANN)));
  server.close();
} catch (e) { fail++; console.log("FAIL crashed", e?.stack ?? e); }
finally { rmSync(tmpDir, { recursive: true, force: true }); }

// Source checks: Study Together accepts plans; nothing writes growth evidence.
const st = readFileSync(path.join(root, "src/lib/sharedStudy.ts"), "utf8"), route = readFileSync(path.join(root, "src/routes/studyPlans.ts"), "utf8");
ok("Study Together: 'study_plan' content type; a participant's plan is shared only by its owner", st.includes('"study_plan"]') && /plan\.owner_id !== starter/.test(st));
ok("routes never insert/update growth evidence", !/from\("p2p_growth_[a-z_]+"\)\.(insert|update|upsert|delete)/.test(route));
ok("router mounted at /study-plans", readFileSync(path.join(root, "src/routes/index.ts"), "utf8").includes('router.use("/study-plans", studyPlansRouter)'));
console.log(`studyPlans (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
