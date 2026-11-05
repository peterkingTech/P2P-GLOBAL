// Migration 239 (Growth Milestone Matrix, calculation version 2) — static checks
// that need no database. The behaviour itself is tested against a disposable
// restored database by migrations/tests/239_growth_matrix.db.test.mjs.
//   • the authoritative thresholds live in ONE place (p2p_growth_matrix), exactly as approved;
//   • promotions stay OFF and the matrix starts as a draft;
//   • the evidence pass never reads client-controlled or passive sources;
//   • the previous formulas can no longer change a stage;
//   • everything new is server-only, and stage points are no longer callable by phones;
//   • the API and app carry no thresholds of their own.
// Run: node tests/growthMatrixMigration.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const sql = readFileSync(path.join(repo, "migrations/239_growth_milestone_matrix.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const fn = (name) => { const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\nend \\$\\$;`)); return m ? m[0] : ""; };

// ── The matrix ──
const block = sql.slice(sql.indexOf("insert into public.p2p_growth_matrix"), sql.indexOf("on conflict (calc_version, stage, fact_key) do nothing"));
const rows = [...block.matchAll(/\(2, (\d), '(\w+)',\s+'(\w+)',\s+(\d+),\s+(null|\d+),/g)].map(([, st, dim, key, v, p]) => `${st}.${dim}.${key}=${v}${p === "null" ? "" : "/" + p}`);
const expected = [
  "2.consistency.journey_days=30", "2.consistency.active_weeks=4", "2.consistency.active_months=2", "2.learning.learning_units=10", "2.application.application_actions=10", "2.service.contributions=10",
  "3.consistency.days_in_stage=90", "3.consistency.active_weeks_window=10/16", "3.consistency.active_months=3", "3.learning.learning_units=20", "3.application.application_actions=20", "3.service.contributions=20",
  "4.consistency.days_in_stage=180", "4.consistency.active_weeks_window=18/26", "4.learning.learning_units=50", "4.application.application_actions=50", "4.service.contributions=50",
  "4.service.learners_supported_developed=1/3", "4.service.second_generation_contributors=1",
  "5.consistency.days_in_stage=180", "5.consistency.active_weeks_window=18/26", "5.learning.learning_units=100", "5.learning.core_curriculum_complete=1",
  "5.application.application_actions=100", "5.service.contributions=100", "5.service.learners_supported_developed=1/6", "5.service.second_generation_sustained=1/3",
];
ok("matrix: exactly the 27 approved requirements, in the four dimensions", JSON.stringify(rows) === JSON.stringify(expected), JSON.stringify(rows.filter((r) => !expected.includes(r))));
ok("matrix: the dimension check allows only the four dimensions (no 'fruit')", /dimension\s+text\s+not null check \(dimension in \('consistency', 'learning', 'application', 'service'\)\)/.test(sql));
ok("settings: version 2, a draft, promotions OFF", /set calc_version = 2, thresholds_status = 'draft', promotions_enabled = false/.test(sql));
ok("settings: guide-stage enforcement ON, exceptions OFF; previous formulas start frozen",
  /enforce_guide_stage\s+boolean not null default true/.test(sql) && /exceptions_enabled\s+boolean not null default false/.test(sql) && /legacy_formula_frozen\s+boolean not null default true/.test(sql));
ok("thresholds change only through one audited function, only while a draft", /thresholds can only change while the matrix is a draft/.test(fn("p2p_growth_set_threshold")) && /insert into p2p_growth_matrix_changes/.test(fn("p2p_growth_set_threshold")));

// ── Evidence comes only from trustworthy, server-side records ──
const syncFn = fn("p2p_growth_sync_evidence");
ok("evidence pass exists and is idempotent (stable dedup keys)", syncFn.length > 1000 && /on conflict \(dedup_key\) do nothing/.test(syncFn));
ok("evidence never from lesson_progress, plan enrolments, journals or prayer journals", !/p2p_lesson_progress|p2p_plan_enrollments|p2p_journal_reflections|p2p_prayer_journal|text_content/.test(syncFn));
ok("activity events count only when written by the server, and only listed kinds", /a\.origin = 'server' and a\.event_type = any \(v_set\.server_activity_types\)/.test(syncFn) && !/viewed/.test(sql.match(/server_activity_types\s+text\[\][^\n]*/)[0]));
ok("learning credit only for peer approvals that are not self-approved, not by the learner, not substantiated-invalid",
  /e\.status = 'approved' and not coalesce\(e\.self_approved, false\) and e\.evaluator_id is not null and e\.evaluator_id <> p_user/.test(syncFn) && /substantiated is true/.test(syncFn));
ok("a lesson passes only when EVERY question of its assessment is approved", /having bool_and\(coalesce\(t\.valid_peer, false\)\)/.test(syncFn));
ok("group sessions count once for the facilitator; attendance is participation only", /'service:' \|\| p_user \|\| ':session:' \|\| s\.id/.test(syncFn) && /'consistency\.group_learning_attended'/.test(syncFn)
  && /\('consistency\.group_learning_attended',\s+'consistency',\s+false,\s+true/.test(sql));
ok("confirmations of an evaluation or a session already credited never add a second credit", /coalesce\(c\.source_type, ''\) <> 'evaluation_feedback'/.test(syncFn) && /s\.leader_id = p_user\)\)/.test(syncFn));
ok("local date fixed at event time, with the zone used", /\(at at time zone v_tz\)::date, v_tz/.test(syncFn));
ok("the facts read the ledger only (no source tables)", !/p2p_submissions|p2p_lesson_evaluations|p2p_lesson_progress/.test(fn("p2p_growth_facts")));

// ── The ledger is append-only ──
ok("evidence is append-only: no delete while the person exists; facts can't change", /evidence is never deleted/.test(sql) && /only the verification of evidence can change/.test(sql));
ok("corrections are reviews with a reason, kept permanently", /create table if not exists public\.p2p_growth_evidence_reviews/.test(sql) && /evidence reviews are permanent/.test(sql));

// ── Previous formulas can't change a stage ──
const recalc = fn("p2p_growth_recalculate");
ok("recalculation: no legacy branch (growth_level never raises a stage)", !/previous_growth_formula|v_legacy/.test(recalc) && /No other branch/.test(recalc));
ok("recalculation: promotes only with an approved matrix and promotions on, one stage at a time", /v_set\.promotions_enabled and v_set\.thresholds_status = 'approved' and v_eligible > v_cur\.stage/.test(recalc) && /v_new := v_cur\.stage \+ 1/.test(recalc));
ok("the old growth_level triggers are frozen", /select coalesce\(\(select promotions_enabled or legacy_formula_frozen from p2p_growth_settings\), true\)/.test(sql));
ok("promotion wording speaks of recorded participation", /Milestone reached: /.test(recalc) && !/You have grown|spiritual/i.test(recalc));

// ── Access ──
ok("all new tables: RLS on and no phone access", ["p2p_growth_matrix", "p2p_growth_evidence", "p2p_growth_evidence_beneficiaries", "p2p_growth_evidence_reviews", "p2p_growth_pauses", "p2p_growth_learner_development"]
  .every((t) => sql.includes(`alter table public.${t} enable row level security`)) && /revoke all on public\.p2p_growth_matrix, public\.p2p_growth_matrix_changes/.test(sql));
ok("stage points are no longer callable by phones or anonymous callers", /revoke execute on function public\.p2p_growth_stage_points\(int\) from public, anon, authenticated/.test(sql));
ok("phone writes: server time and no re-targeting on answers, evaluations, confirmations, Family gatherings, activity",
  ["p2p_submissions", "p2p_lesson_evaluations", "p2p_peer_confirmations", "p2p_family_worship_sessions", "p2p_family_worship_participants"].every((t) => sql.includes(`create trigger trg_p2p_growth_server_time before`) && sql.includes(`on public.${t}\n  for each row execute function public.p2p_growth_server_time(`))
  && /create trigger trg_p2p_activity_event_origin/.test(sql));
ok("no client permission was revoked from existing tables (older builds keep working)", !/revoke (insert|update|delete|all) on (table )?public\.p2p_(lesson_progress|submissions|user_activity_events|plan_enrollments|peer_confirmations)/.test(sql));
ok("country in the collective view needs explicit consent; small groups suppressed", /share_country_in_collective boolean not null default false/.test(sql) && /having count\(\*\) >= k/.test(fn("p2p_growth_collective")));
ok("a rollback is documented", /-- Rollback \(nothing here deletes data/.test(sql));
ok("the database scenario test exists", existsSync(path.join(repo, "migrations/tests/239_growth_matrix.db.test.mjs")));

// ── No thresholds anywhere else ──
const api = ["src/lib/growthStages.ts", "src/routes/growth.ts", "src/routes/adminCentre.ts"].map((f) => readFileSync(path.join(root, f), "utf8")).join("\n");
const app = ["app/stages.tsx", "lib/growthApi.ts"].map((f) => readFileSync(path.join(repo, "artifacts/mobile", f), "utf8")).join("\n");
ok("API and app hold no copy of the thresholds", !/\b(learning_units|application_actions|contributions)\b\s*[:=]\s*(10|20|50|100)\b/.test(api + app) && !/need:\s*\d/.test(api + app));

console.log(`growthMatrixMigration: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
