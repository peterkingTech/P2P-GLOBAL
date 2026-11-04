// Admin Centre on the app side (migration 238, Phase 6):
//   • the admin session: started after the admin sign-in, sent with every API
//     call while open, forgotten when the server says it ended, ended on Exit;
//   • navigation: six areas, every existing screen kept, the new screens
//     added — and it is display only (each screen checks on the server);
//   • the new screens use only the API, ask for a reason and confirmation
//     before changes, and the overview shows totals (no names).
// Run: node tests/adminCentre.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const src = (p) => readFileSync(path.join(root, p), "utf8");
const code = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

// ── The session module (store + actions; the API client adds the header) ──
const sent = [];
let reply = { status: 201, body: { token: "tok-123", expiresAt: "2026-11-04T20:00:00Z", displayName: "Ann", roles: ["super_admin"], permissions: ["admins.manage"], identityKind: "legacy_shared" } };
const load = (file, req) => { const js = ts.transpileModule(src(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; const m = { exports: {} }; vm.runInNewContext(js, { module: m, exports: m.exports, Set, String, require: req }); return m.exports; };
const store = load("lib/adminSessionStore.ts", (n) => { throw new Error(n); });
const apiFetch = async (p, init = {}) => { sent.push([p, init, { ...store.adminSessionHeader() }]); return { ok: reply.status < 300, status: reply.status, json: async () => reply.body }; };
const A = load("lib/adminSession.ts", (n) => { if (n === "@/lib/apiClient") return { apiFetch }; if (n === "@/lib/adminSessionStore") return store; throw new Error(n); });
ok("no session: nothing extra is sent", JSON.stringify(store.adminSessionHeader()) === "{}");
let r = await A.startAdminSession();
ok("start: POST /admin-identity/session/start through the API client (which adds the sign-in token)", sent[0][0] === "/admin-identity/session/start" && sent[0][1].method === "POST" && r.ok);
ok("while open, every API call carries it", store.adminSessionHeader()["X-P2P-Admin-Session"] === "tok-123");
store.adminSessionEnded();
ok("the server says it ended → forgotten here too", JSON.stringify(store.adminSessionHeader()) === "{}");
reply = { status: 403, body: { error: "This admin account needs two-step verification.", mfaRequired: true } };
r = await A.startAdminSession();
ok("two-step verification needed → said plainly, no session", !r.ok && r.reason === "mfa" && /two-step/.test(r.message) && !A.getAdminSession());
reply = { status: 401, body: { error: "Please sign in again to open the Admin Centre.", freshSignInRequired: true } };
r = await A.startAdminSession();
ok("an old sign-in → 'sign in again'", !r.ok && r.reason === "fresh");
reply = { status: 201, body: { token: "tok-9", roles: [], permissions: [] } };
await A.startAdminSession();
await A.endAdminSession();
ok("Exit: the server ends it (sent with the session), and it's gone here", sent.at(-1)[0] === "/admin-identity/session/end" && sent.at(-1)[2]["X-P2P-Admin-Session"] === "tok-9" && !A.getAdminSession());

const client = src("lib/apiClient.ts");
ok("the API client sends the session and forgets it when ended", (client.match(/\.\.\.adminSessionHeader\(\)/g) ?? []).length === 2 && client.includes("if (b.adminSessionEnded) adminSessionEnded();"));
const login = src("app/admin/login.tsx");
ok("admin login opens the session after the role check; two-step / fresh sign-in refusals sign out", login.includes("await startAdminSession()") && /started\.reason === "mfa" \|\| started\.reason === "fresh"[\s\S]*?await supabase\.auth\.signOut\(\)/.test(login));
const lay = src("app/admin/_layout.tsx");
ok("Exit Admin ends the admin session first", lay.includes("await endAdminSession(); router.replace(\"/(tabs)\")"));

// ── Navigation ──
const EXISTING = ["/admin\"", "/admin/content\"", "/admin/kingdom-stories\"", "/admin/studio\"", "/admin/registrations\"", "/admin/help-requests\"", "/admin/email-inbox\"", "/admin/moderation\"", "/admin/kingdom-wins-review\"", "/admin/usernames\"", "/admin/verification\"", "/admin/translations\"", "/admin/team\"", "/admin/recycle-bin\""];
ok("every existing admin screen is still in the navigation", EXISTING.every((p) => lay.includes(`path: "${p}`)));
ok("…plus Discipleship & Growth, Peer Evaluations and Access & Audit", ["/admin/discipleship\"", "/evaluation/admin\"", "/admin/access\""].every((p) => lay.includes(`path: "${p}`)));
const navBlock = lay.slice(lay.indexOf("const NAV_ITEMS"), lay.indexOf("];", lay.indexOf("const NAV_ITEMS")));
ok("every item belongs to one of the six areas", (navBlock.match(/\{ label:/g) ?? []).length === (navBlock.match(/section: "(Overview|People & Communities|Discipleship & Learning|Content|Platform|Help & Support)"/g) ?? []).length);
ok("areas are labelled in the navigation, in order", lay.includes('const SECTIONS = ["Overview", "People & Communities", "Discipleship & Learning", "Content", "Platform", "Help & Support"];') && lay.includes("{firstOfSection ? <Text style={styles.navSection}"));

// ── The new screens ──
const ov = src("components/admin/PlatformOverview.tsx"), dis = src("app/admin/discipleship.tsx"), acc = src("app/admin/access.tsx");
ok("new screens read and change only through the API", ![ov, dis, acc].some((s) => /supabase|\.from\(/.test(code(s))) && ov.includes('apiRequest<Overview>("/admin-centre/overview")'));
ok("overview: hidden without permission; names never shown (totals only)", ov.includes('(e as { status?: number }).status === 403 ? "hidden"') && !/full_name|username|\.name\b(?!\})/.test(code(ov).replace(/st\.name|stage\.name/g, "")));
ok("overview: 'needs attention' lists only real current conditions", ov.includes("].filter(Boolean)") && ov.includes("Nothing needs attention right now."));
ok("growth: a reason is required; approving and switching on ask first; promotions can't start before approval", dis.includes("Write the reason first") && dis.includes('confirmAction("Approve the milestone matrix?"') && dis.includes('confirmAction("Switch promotions on?"') && dis.includes('disabled={st?.thresholds_status !== "approved"}'));
ok("corrections: a reason of at least 5 characters, confirmed, kept in history", dis.includes("disabled={fixReason.trim().length < 5}") && /confirmAction\("End this relationship\?"[\s\S]*?destructive: true/.test(dis));
ok("access: reason first; suspending says sessions end and the peer account is untouched", acc.includes("Write the reason first") && acc.includes("Their admin sessions end at once. Their peer account (if any) is not affected."));
ok("access: invitations are separate identities (own email, no peer profile)", acc.includes("A separate admin identity with its own email address (not a peer's). No peer profile is created."));

console.log(`adminCentre (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
