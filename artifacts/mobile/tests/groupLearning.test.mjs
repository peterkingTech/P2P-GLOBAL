// Unified Learning (Family, reusable by Church) — app side, source checks.
// Server behaviour (library, journeys, permissions, isolation, progress) is
// tested against the real routes in scripts/studio-db-test/group-learning.mjs.
// Run: node tests/groupLearning.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const api = src("lib/groupLearningApi.ts");
// Response types may carry a member's userId (leaders' member progress); requests never do.
ok("API client: session token only (no client-supplied user id)", /Authorization: `Bearer \$\{token\}`/.test(api) && !/userId/.test(api.split(/\r?\n/).filter((l) => !/^export interface /.test(l)).join("\n")));
ok("API client: every server route used", ["/learning/library", "/learning/curricula/", "/journeys`", "/pause`", "/current-lesson`", "/covered`", "/covered/${lessonId}`"].every((p) => api.includes(p)));

const home = src("app/learning/[scope]/[groupId].tsx");
ok("one screen for Family and Church (scope from the route, validated)", /rawScope === "family" \|\| rawScope === "church" \? rawScope : null/.test(home));
ok("four parts: Continue Learning, P2P Library, Our Custom Lessons, Progress", ["CONTINUE LEARNING", ">P2P Library<", ">Our Custom Lessons<", ">Progress<"].every((t) => home.includes(t)));
ok("Continue opens the existing lesson screen", /pathname: "\/lesson\/\[id\]", params: \{ id: lessonId \}/.test(home));
ok("only leaders see choose/mark/resume/manage actions (server enforces too)", /\{data\.canManage && \(\s*\n\s*<AppButton label="We covered this — next lesson" onPress=\{handleCovered\}/.test(home) && /\{data\.canManage && h\.status === "paused" && \(/.test(home) && /\{data\.canManage && \(\s*\n\s*<AppButton label="Manage" onPress=\{\(\) => router\.push\(manageCustomPath/.test(home));
ok("custom lessons labelled as the group's own, never official P2P", /not official P2P curriculum/.test(home) && /Draft \(only leaders see this\)/.test(home));
ok("progress: Together and You shown separately and explained", /label="Together"/.test(home) && /label="You"/.test(home) && /"Together" counts lessons your group covered\. "You" is your own lesson progress/.test(home));
ok("loading, error (retry), not-a-member and empty states", /ActivityIndicator/.test(home) && /Try again/.test(home) && /You're not part of this/.test(home) && /Nothing chosen yet/.test(home) && /No custom lessons yet/.test(home));
ok("no invented data: everything rendered comes from the server response", !/Math\.random|mock|placeholder: \[/i.test(home));

const lib = src("app/learning/library.tsx");
ok("library: Core Foundation + P2P Plans by category, from the server", /getLibrary\(\)/.test(lib) && />Core Foundation</.test(lib) && />P2P Plans</.test(lib) && /cat\.plans\.map/.test(lib));
ok("library: group passed as short params (no route-segment collision)", /params: \{ curriculumId: item\.id, s: s \?\? "", g: g \?\? "" \}/.test(lib));

const outline = src("app/learning/curriculum/[curriculumId].tsx");
ok("outline: marked as official P2P content", /Official P2P \{outline\.curriculum\.type === "plan" \? "Plan" : "curriculum"\}/.test(outline));
ok("outline: leaders can choose it, set the current lesson, mark covered / undo", /startJourney\(scope!, groupId!, outline\.curriculum\.id\)/.test(outline) && /setCurrentLesson\(/.test(outline) && /markCovered\(/.test(outline) && /unmarkCovered\(/.test(outline) && /const canManage = !!home\?\.canManage/.test(outline));
ok("outline: every lesson opens the existing lesson view (no duplicate lesson renderer)", /pathname: "\/lesson\/\[id\]", params: \{ id: l\.id \}/.test(outline) && existsSync(path.join(root, "app/lesson/[id].tsx")));
ok("touch targets ≥ 44pt", /<AppButton /.test(outline) && !/<AppButton [^\n]*size="sm"/.test(outline) /* shared buttons: 44pt+ */ && /<AppButton label="Open lesson" size="lg"/.test(home) /* 52pt hero */);

ok("Family home → Learning home", /pathname: "\/learning\/\[scope\]\/\[groupId\]", params: \{ scope: "family", groupId: familyId \}/.test(src("app/family/[familyId].tsx")));
ok("existing custom-study screens still reachable (Manage / custom lesson rows)", /pathname: "\/family\/studies", params: \{ familyId: groupId \}/.test(api) && /pathname: "\/family\/studies\/\[studyId\]"/.test(api));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
