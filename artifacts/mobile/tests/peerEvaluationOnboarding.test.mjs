// Peer evaluation onboarding ("Learn Together. Help Others Grow.") and the evaluation states.
//   A. The participant understood: a dedicated How to use P2P stage, finished only by ticking the
//      acknowledgement (opening the feature or past activity never finishes it), recorded through the
//      existing guide progress; no lesson has to be passed to finish it.
//   B. The platform is ready: shown separately, from GET /evaluation/status — "checking", running,
//      or unavailable; a failed check is shown as unavailable, never as ready.
//   The evaluation screen separates: not yet qualified · qualified (the exact resources) · invitation ·
//   no current invitation (no promise of one soon) · service unavailable · a personal pause.
//   No volunteer / evaluator application / sign-up anywhere.
// Run: node tests/peerEvaluationOnboarding.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const steps = src("lib/getStarted.ts"), guide = src("app/get-started.tsx"), progress = src("hooks/useGetStartedProgress.ts");
const evalHome = src("app/evaluation/index.tsx"), admin = src("app/evaluation/admin.tsx"), api = src("lib/peerEvaluationApi.ts");

// The stage
const stage = steps.slice(steps.indexOf('id: "peer-evaluation"'), steps.indexOf('id: "connect"'));
ok("stage: a dedicated step titled 'Learn Together. Help Others Grow.', right after the learning path", stage.includes('title: "Learn Together. Help Others Grow."')
  && steps.indexOf('id: "learning-path"') < steps.indexOf('id: "peer-evaluation"') && steps.includes('| "peer-evaluation"'));
ok("stage: steps numbered 1–8 in order", [..."12345678"].every((n, i, a) => { const at = steps.indexOf(`number: ${n},`); return at > 0 && (i === 0 || at > steps.indexOf(`number: ${a[i - 1]},`)); }) && !steps.includes("number: 9,"));
ok("stage: learning through Kingdom School, Kingdom Stories, plans and other resources", /Kingdom School, Kingdom Stories, reading plans and other P2P resources/.test(stage));
ok("stage: exact-resource qualification by an independent peer, automatically", /independent peer/.test(stage) && /automatically/.test(stage) && /that exact resource/.test(stage));
ok("stage: invitations only for resources you passed yourself", /only ever be invited for resources you have passed yourself/.test(stage));
ok("stage: no registration or volunteer sign-up", /nothing to register for and no volunteer sign-up/.test(stage));
ok("stage: never your own work; you keep learning while helping", /never evaluate your own work/.test(stage) && /keep learning while you help others grow/.test(stage));

// A. Understanding
ok("understanding: an explicit acknowledgement statement", stage.includes('acknowledgement: "I understand how peer evaluation works"'));
ok("understanding: never inferred from activity (passing a lesson isn't needed, nor does it finish the step)", !/peer-evaluation/.test(steps.slice(steps.indexOf("export function inferCompletedSteps"))));
ok("understanding: opening the feature doesn't finish an acknowledgement step", guide.includes("if (!acknowledgement) await complete(stepId);"));
ok("understanding: Done is disabled until the statement is ticked", guide.includes("disabled={!!step.acknowledgement && !acknowledged.has(step.id)}") && guide.includes('accessibilityRole="checkbox"'));
ok("understanding: completion is recorded by the existing guide progress (no new store)", guide.includes("void complete(step.id);") && progress.includes("markStepComplete(profile.id, stepId)") && !/AsyncStorage/.test(guide));

// B. Readiness, shown separately
ok("readiness: the stage shows whether the service is running, from /evaluation/status", stage.includes("showsServiceStatus: true") && guide.includes("getEvaluationStatus()") && api.includes('getEvaluationStatus = () => call<EvaluationStatus>("/status")'));
ok("readiness: a failed check is shown as unavailable — never as ready", guide.includes('service === "error" || service?.state === "unavailable"') && guide.includes("We couldn't check whether peer evaluation is running"));

// Evaluation screen states
ok("states: not yet qualified", evalHome.includes('"Not yet qualified"'));
ok("states: qualified, listing the exact resources by identity", evalHome.includes('"You\'re qualified to evaluate"') && evalHome.includes("qualified.slice(0, 8).map((q) => (") && evalHome.includes("key={q.resourceId}") && api.includes("qualified?: { resourceId: string; title: string; within: string | null }[];"));
ok("states: invitation available", evalHome.includes('"You have an invitation"'));
ok("states: no current invitation — without promising one soon", evalHome.includes("No invitation for you right now.") && evalHome.includes('"No current invitation."') && !/invitation (soon|shortly|any minute)/i.test(evalHome));
ok("states: service unavailable is distinct from having no invitations", evalHome.includes("Peer evaluation is temporarily unavailable") && evalHome.includes("it doesn't mean you have no invitations"));
ok("states: 'Not taking new evaluations' replaced by the personal pause wording", !evalHome.includes("Not taking new evaluations") && evalHome.includes("You've paused new invitations"));

// Admin
ok("admin: a readiness panel — checks, counts, coverage gaps", admin.includes("adminReadiness()") && admin.includes("ready.checks.map") && admin.includes("undelivered invitations") && admin.includes("waiting with nobody qualified") && admin.includes("Coverage gaps"));

// No volunteer system
const all = [steps, guide, evalHome, admin, api].join("\n").replace(/^\s*\/\/.*$/gm, "");
ok("no volunteer registration, evaluator application or manual evaluator status", !/applyToEvaluate|evaluatorApplication|becomeEvaluator|volunteerSignup|registerAsEvaluator/i.test(all) && !/"Become an evaluator"|"Apply to evaluate"|"Volunteer"/.test(all));

console.log(`peerEvaluationOnboarding (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
