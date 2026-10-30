// Tests for the Kingdom Wins community-rules / moderation UI (migration 189):
// lib/winsModerationModel.ts (transpiled and run), its role lists against the
// API's (artifacts/api-server/src/lib/winsModeration.ts), and static checks on
// the create screen, the review screen and the admin nav. SYNTHETIC data only.
// Run: node tests/winsModeration.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const read = (p) => readFileSync(path.join(root, p), "utf8");

// Load the model.
const js = ts.transpileModule(read("lib/winsModerationModel.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, console });
const M = mod.exports;

// Role lists match the API exactly.
const api = readFileSync(path.join(root, "../api-server/src/lib/winsModeration.ts"), "utf8");
const apiMods = JSON.parse(api.match(/WINS_MODERATOR_ROLES = (\[[^\]]+\])/)[1]);
ok("app moderator roles = API moderator roles", JSON.stringify([...M.WINS_MODERATOR_ROLES].sort()) === JSON.stringify([...apiMods].sort()));
ok("app P2P Impact reviewers = moderators + admin_content", JSON.stringify([...M.IMPACT_REVIEWER_ROLES].sort()) === JSON.stringify([...apiMods, "admin_content"].sort()));
for (const role of ["student", "peer_guide", "church_leader", "admin_finance", "admin_content", null]) ok(`not a Wins moderator in the app: ${role}`, !M.isWinsModerator(role));
for (const role of apiMods) ok(`Wins moderator in the app: ${role}`, M.isWinsModerator(role));

// Community rules cover the prohibited categories.
const rules = M.WINS_COMMUNITY_RULES.join(" ").toLowerCase();
for (const word of ["genuine", "advertising", "fundraising", "donation", "payment", "money schemes", "scams", "impersonation"]) ok(`community rules mention ${word}`, rules.includes(word));
ok("rules note is honest that media is not scanned automatically", /aren't checked automatically/.test(M.WINS_RULES_NOTE) && /report/.test(M.WINS_RULES_NOTE));

// Restriction durations and expiry.
const now = Date.UTC(2026, 9, 15, 12, 0, 0);
ok("7 days expiry", M.restrictionExpiry("7d", now) === new Date(now + 7 * 86400e3).toISOString());
ok("30 days expiry", M.restrictionExpiry("30d", now) === new Date(now + 30 * 86400e3).toISOString());
ok("indefinite = null (until lifted)", M.restrictionExpiry("indefinite", now) === null);
ok("three duration choices", M.RESTRICTION_DURATIONS.map((d) => d.value).join(",") === "7d,30d,indefinite");

// Member-facing messages never include a reason.
ok("not restricted → no banner", M.postingStatusMessage({ restricted: false, until: null }) === null && M.postingStatusMessage(null) === null);
ok("restricted with end date → says until, keeps drafts", /until/.test(M.postingStatusMessage({ restricted: true, until: "2026-10-22T12:00:00Z" })) && /drafts/.test(M.postingStatusMessage({ restricted: true, until: "2026-10-22T12:00:00Z" })));
ok("restricted indefinitely → no date", !/until \d/.test(M.postingStatusMessage({ restricted: true, until: null })));

// Outcomes reflect what the server did.
ok("held post → 'Waiting for review', not 'Shared'", M.shareOutcome("published", { status: "submitted", heldForReview: true }).title === "Waiting for review");
ok("published → Shared", M.shareOutcome("published", { status: "published", heldForReview: false }).title === "Shared!");
ok("P2P Impact submitted → Submitted for review", M.shareOutcome("submitted", { status: "submitted" }).title === "Submitted for review");
ok("draft → Draft saved", M.shareOutcome("draft", { status: "draft" }).title === "Draft saved");

// Create screen.
const create = read("app/kingdom-wins/create.tsx");
ok("create: shows the community rules", /WINS_COMMUNITY_RULES\.map/.test(create) && /Community rules/.test(create));
ok("create: loads the member's posting status", /getMyWinsPostingStatus\(\)/.test(create));
ok("create: Share disabled while restricted (drafts still allowed)", /disabled=\{[^}]*!!restrictedNotice\}/.test(create) && /handleSubmit\("draft"\)\}[^\n]*disabled=\{submitting \|\| !title\.trim\(\) \|\| !hasContent\}/.test(create));
ok("create: alert reflects a held post", /shareOutcome\(status, saved\)/.test(create));
ok("create: P2P Impact still submits for review with consent", /handleSubmit\(isImpact \? "submitted" : "published"\)/.test(create) && /isImpact && !consentConfirmed/.test(create));

// Review screen.
const review = read("app/admin/kingdom-wins-review.tsx");
ok("review: restriction controls only for Wins moderators", /canModerate && item\.authorId/.test(review) && /isWinsModerator\(profile\?\.role\)/.test(review));
ok("review: restriction requires a reason", /reason\.trim\(\)\.length < 3/.test(review));
ok("review: duration choice + lift", /RESTRICTION_DURATIONS\.map/.test(review) && /liftWinsRestriction/.test(review));
ok("review: held badge and matched categories", /Held by screening/.test(review) && /screeningCategories/.test(review));
ok("review: media honestly marked as not scanned", /not automatically scanned/.test(review));
ok("review: moderators see the automatic English translation", /item\.screeningTranslation \?/.test(review) && /English translation \(automatic\)/.test(review));
ok("review: 'not yet translated' holds are explained", /translation: "Not yet translated/.test(review));
ok("rules note tells members other languages are translated, and by whom", /translated for this check by our AI provider \(Anthropic\)/.test(M.WINS_RULES_NOTE));
ok("held message doesn't assume the reason", /couldn't be checked automatically/.test(M.shareOutcome("published", { status: "submitted", heldForReview: true }).message));
// Every tappable carries a spoken label: TouchableOpacity / IconButton by accessibilityLabel, AppButton by its label.
const reviewButtons = (() => {
  const sf = ts.createSourceFile("r.tsx", review, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (n) => {
    const op = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    const name = op?.tagName.getText();
    if (name && ["TouchableOpacity", "AppButton", "IconButton"].includes(name)) {
      const has = (k) => op.attributes.properties.some((a) => a.name?.getText() === k);
      out.push({ name, labelled: name === "AppButton" ? has("label") : has("accessibilityLabel") });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
})();
ok("review: every button labelled", reviewButtons.length > 0 && reviewButtons.every((b) => b.labelled), `${reviewButtons.filter((b) => !b.labelled).length} unlabelled of ${reviewButtons.length}`);
ok("review: 44px targets for chips and buttons", /filterChip: \{[^}]*minHeight: 44/.test(review) && /<AppButton /.test(review) && !/<AppButton [^\n]*size="sm"/.test(review) /* shared buttons: 44pt */);

// Admin nav.
const nav = read("app/admin/_layout.tsx");
ok("nav: Kingdom Wins review tab for reviewer roles only", /label: "Kingdom Wins", path: "\/admin\/kingdom-wins-review"[^}]*roles: IMPACT_REVIEWER_ROLES/.test(nav));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
