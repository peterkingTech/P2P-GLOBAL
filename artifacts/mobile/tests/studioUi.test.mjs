// Tests for the Publishing Studio admin screens (app/admin/studio/*), their
// logic (lib/studioApi.ts, lib/studioModel.ts, lib/studioActions.ts,
// components/studio/*) and the story editor's approval notice. Real files are
// transpiled with TypeScript and run with react-native, expo-router, auth and
// the data hook mocked; screens are rendered to element trees and inspected.
// SYNTHETIC data only, no network.
// Run: node tests/studioUi.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const React = require("react");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

// ── Mocks ──────────────────────────────────────────────────────────────────
const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = {
  View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), ScrollView: host("ScrollView"),
  FlatList: host("FlatList"), TextInput: host("TextInput"), Modal: host("Modal"), ActivityIndicator: host("ActivityIndicator"),
  StyleSheet: { create: (s) => s }, useWindowDimensions: () => env.window,
};
const Ionicons = host("Ionicons");
const env = { window: { width: 1200, height: 800 }, profile: { id: "u-me", role: "admin_content" }, query: null, params: {}, pushes: [], pathname: "/admin/studio", stateSwap: null };
const reactMock = {
  ...React,
  // env.stateSwap lets a test start a screen in another mode (keyed by the initial value).
  useState: (init) => { const v = typeof init === "function" ? init() : init; return [env.stateSwap && typeof v === "string" && v in env.stateSwap ? env.stateSwap[v] : v, () => {}]; },
  useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: (v) => ({ current: v }),
};
const mocks = {
  react: reactMock,
  "react-native": RN,
  "@expo/vector-icons": { Ionicons },
  "expo-router": {
    useRouter: () => ({ push: (p) => env.pushes.push(p), replace: () => {} }),
    useLocalSearchParams: () => env.params, useFocusEffect: () => {}, usePathname: () => env.pathname, Slot: host("Slot"),
  },
  "@/contexts/AuthContext": { useAuth: () => ({ profile: env.profile }), supabase: {} },
  "@/lib/adminFetch": { authedFetch: (p, i) => env.fetch(p, i) },
  "@/components/studio/useStudioQuery": { useStudioQuery: () => env.query },
};

const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext)) return base + ext;
  if (existsSync(base) && /\.(tsx?|js)$/.test(base)) return base;
  throw new Error(`cannot resolve ${spec}`);
}
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, Date, Math, JSON, Intl, Promise, setTimeout, clearTimeout, Error, Array, Object, Map, Set, Number, String, encodeURIComponent,
    require: (n) => (n in mocks ? mocks[n] : loadFile(resolveFile(n, path.dirname(file)))),
  });
  return mod.exports;
}
const load = (rel) => loadFile(path.join(root, rel));

function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !node.type) return node;
  if (typeof node.type === "function" && !node.type.__host) return expand(node.type(node.props));
  if (node.type === RN.FlatList) {
    const p = node.props;
    const items = (p.data ?? []).map((item, index) => p.renderItem({ item, index }));
    return { ...node, props: { ...p, children: expand([p.ListHeaderComponent ?? null, ...(items.length ? items : [p.ListEmptyComponent ?? null]), p.ListFooterComponent ?? null]) } };
  }
  const children = node.props?.children;
  return { ...node, props: { ...node.props, children: children === undefined ? undefined : expand(children) } };
}
function findAll(node, pred, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.type === RN.Modal && !node.props.visible) return out; // hidden dialogs are not on screen
  if (pred(node)) out.push(node);
  findAll(node.props?.children, pred, out);
  return out;
}
const textOf = (tree) => findAll(tree, (n) => n.type === RN.Text).map((t) => [].concat(t.props.children).flat(Infinity).filter((c) => typeof c === "string" || typeof c === "number").join("")).join(" | ");
const buttons = (tree) => findAll(tree, (n) => n.type === RN.TouchableOpacity && ["button", "link", "tab"].includes(n.props.accessibilityRole));
const button = (tree, label) => buttons(tree).find((b) => b.props.accessibilityLabel === label);
const render = (rel) => expand(React.createElement(load(rel).default));
const q = (data, o = {}) => ({ data, loading: false, error: null, reload: async () => {}, ...o });

// ── Fixtures ───────────────────────────────────────────────────────────────
const HOUR = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const studio = (o = {}) => ({ itemId: "it", reviewState: "draft", plannedFor: null, timezone: "UTC", version: 2, submittedBy: null, submittedAt: null, reviewedBy: null, reviewedAt: null, reviewNote: null, approvalStale: false, ...o });
const story = (id, o = {}) => ({ sourceId: id, title: `Story ${id}`, nativeStatus: "draft", contentType: "historical_story", updatedAt: iso(Date.now() - HOUR), publishedAt: null, studio: null, schedules: [], ...o });
const sched = (o = {}) => ({ id: "j1", action: "publish", runAt: iso(Date.now() + 48 * HOUR), localTime: "2026-10-16T09:00", timezone: "Europe/London", status: "pending", attempts: 0, lastError: null, ...o });
const page = (items, o = {}) => ({ page: 0, pageSize: 20, total: items.length, items, ...o });

const Api = load("lib/studioApi.ts");
const M = load("lib/studioModel.ts");
const A = load("lib/studioActions.ts");

// ── 1. API client ──────────────────────────────────────────────────────────
{
  const calls = [];
  const respond = (status, body) => ({ ok: status < 300, status, json: async () => body });
  Api.__setStudioFetcher(async (p, init) => { calls.push({ p, init }); return env.next(p, init); });
  const kindFor = async (status, body = { error: `e${status}` }) => { env.next = () => respond(status, body); try { await Api.getStudioItems({ sourceType: "kingdom_story" }); } catch (e) { return e; } };
  ok("api: 403 → permission (server message kept)", (await kindFor(403)).kind === "permission");
  ok("api: 401 → unauthenticated, 409 → conflict, 503 → not_installed", (await kindFor(401)).kind === "unauthenticated" && (await kindFor(409)).kind === "conflict" && (await kindFor(503)).kind === "not_installed");
  const coded = await kindFor(409, { error: "This story changed after it was approved.", code: "studio_approval_stale" });
  ok("api: error code from the server kept", coded.code === "studio_approval_stale" && /changed after/.test(coded.message));
  env.next = () => { throw new TypeError("Failed to fetch"); };
  let netKind;
  try { await Api.getOverview("UTC"); } catch (e) { netKind = e.kind; }
  ok("api: network failure → network error", netKind === "network");
  env.next = () => respond(200, { items: [], total: 0 });
  await Api.getStudioItems({ sourceType: "curriculum", q: "plan & more", status: "", page: 2, pageSize: 20 });
  ok("api: list query string (empty filters omitted, values encoded)", calls.at(-1).p === "/studio/items?sourceType=curriculum&q=plan%20%26%20more&page=2&pageSize=20", calls.at(-1).p);
  env.next = () => respond(201, { replayed: false, schedule: {} });
  await Api.createSchedule("s1", { action: "publish", localTime: "2026-11-01T09:00", timezone: "UTC" }, "studio-key-123");
  const last = calls.at(-1);
  ok("api: schedule sends Idempotency-Key, no fold unless chosen", last.p === "/studio/items/kingdom_story/s1/schedules" && last.init.headers["Idempotency-Key"] === "studio-key-123" && !("fold" in JSON.parse(last.init.body)));
  env.next = () => respond(200, { itemId: "i", reviewState: "approved", version: 3, cancelledPublishSchedules: 0 });
  await Api.changeReviewState("s1", "approved", 2, "fine");
  ok("api: review change always sends the version the user saw, never an actor", JSON.parse(calls.at(-1).init.body).version === 2 && !("actorId" in JSON.parse(calls.at(-1).init.body)));
  env.next = () => respond(200, { sourceId: "s1", nativeStatus: "published" });
  await Api.setStoryStatus("s1", "published");
  ok("api: publish now posts to the status route", calls.at(-1).p === "/studio/items/kingdom_story/s1/status" && JSON.parse(calls.at(-1).init.body).status === "published");
  const routes = readFileSync(path.join(root, "../api-server/src/routes/studio.ts"), "utf8");
  const used = [["get", '"/items"'], ["get", '"/items/:sourceType/:sourceId"'], ["get", '"/review-queue"'], ["get", '"/overview"'], ["get", '"/calendar"'], ["get", '"/media"'], ["get", '"/analytics"'], ["get", '"/settings"'], ["get", '"/audit"'], ["get", '"/time-preview"'],
    ["post", '"/items/:sourceType/:sourceId/review"'], ["post", '"/items/:sourceType/:sourceId/status"'], ["post", '"/items/:sourceType/:sourceId/schedules"'], ["post", '"/schedules/:id/cancel"']];
  ok("api: every client endpoint exists on the server (no invented routes)", used.every(([m, p]) => routes.includes(`router.${m}(${p}`)), used.filter(([m, p]) => !routes.includes(`router.${m}(${p}`)).join(";"));
  ok("api: no audit-log writes offered by the client", !/audit[^\n]*method:\s*"(POST|PUT|PATCH|DELETE)"/i.test(readFileSync(path.join(root, "lib/studioApi.ts"), "utf8")));
  Api.__setStudioFetcher(async (p, i) => env.fetch(p, i));
}

// ── 2. Model rules ─────────────────────────────────────────────────────────
{
  const ctx = (o = {}) => ({ editable: true, userId: "u-me", role: "admin_content", ...o });
  const labels = (item, c) => M.reviewActions(item, c).map((a) => a.label + (a.disabledReason ? "(disabled)" : ""));
  ok("review: draft → Submit", labels(story("a"), ctx()).join() === "Submit for review");
  ok("review: own submission → approve/request disabled (independent reviewer)", labels(story("a", { studio: studio({ reviewState: "in_review", submittedBy: "u-me" }) }), ctx()).join() === "Approve(disabled),Request changes(disabled),Withdraw");
  ok("review: super_admin may approve own submission", labels(story("a", { studio: studio({ reviewState: "in_review", submittedBy: "u-me" }) }), ctx({ role: "super_admin" }))[0] === "Approve");
  ok("review: stale approval offers 'Reopen for review'", labels(story("a", { studio: studio({ reviewState: "approved", approvalStale: true }) }), ctx())[0] === "Reopen for review");
  ok("review: viewer role gets no actions", M.reviewActions(story("a", { studio: studio({ reviewState: "in_review" }) }), ctx({ editable: false })).length === 0);
  ok("publish now: only approved, current, unpublished, by an editor",
    M.publishNowBlocker(story("a", { studio: studio({ reviewState: "approved" }) }), true) === null
    && /approval first/.test(M.publishNowBlocker(story("a"), true))
    && /Changed since approval/.test(M.publishNowBlocker(story("a", { studio: studio({ reviewState: "approved", approvalStale: true }) }), true))
    && /Already published/.test(M.publishNowBlocker(story("a", { nativeStatus: "published", studio: studio({ reviewState: "approved" }) }), true))
    && /cannot publish/.test(M.publishNowBlocker(story("a", { studio: studio({ reviewState: "approved" }) }), false)));
  const b = (item, action, editable = true) => M.scheduleBlocker(item, action, { editable });
  ok("schedule: publish blocked without approval or with stale approval", /must be approved/.test(b(story("a"), "publish")) && /changed after it was approved/.test(b(story("a", { studio: studio({ reviewState: "approved", approvalStale: true }) }), "publish")));
  ok("schedule: approved + current can be scheduled", b(story("a", { studio: studio({ reviewState: "approved" }) }), "publish") === null);
  ok("schedule: viewer blocked; duplicate live job blocked", /cannot schedule/.test(b(story("a"), "archive", false)) && /already scheduled/.test(b(story("a", { schedules: [sched({ action: "archive" })] }), "archive")));
  ok("local time: valid / impossible / malformed", M.buildLocalTime("2026-11-01", "09:30").localTime === "2026-11-01T09:30" && !M.buildLocalTime("2026-02-30", "09:00").ok && !M.buildLocalTime("1/2/26", "9").ok);
  const evs = [{ kind: "schedule", id: "e1", sourceId: "s", title: "T", action: "publish", at: "2026-10-31T23:30:00.000Z", localTime: "", timezone: "", status: "pending", attempts: 0, lastError: null }];
  ok("calendar: events grouped by day in the chosen time zone", M.eventsByDay(evs, "Africa/Lagos").has("2026-11-01") && M.eventsByDay(evs, "UTC").has("2026-10-31"));
  ok("calendar: overdue pending job flagged", M.isOverdue({ ...evs[0], at: iso(Date.now() - 2 * HOUR) }, Date.now()) && !M.isOverdue({ ...evs[0], status: "succeeded", at: iso(Date.now() - 2 * HOUR) }, Date.now()));
  const g = M.monthGrid(2026, 1);
  const r = M.gridRange(g);
  ok("calendar: month grid Monday-first; fetch range covers it within 62 days", g[0][0].key === "2026-01-26" && (Date.parse(r.to) - Date.parse(r.from)) / 864e5 <= 62);
  ok("paging: labels and next-page", M.pageLabel({ page: 1, pageSize: 20, total: 45 }) === "21–40 of 45" && M.hasNextPage({ page: 1, pageSize: 20, total: 45 }) && !M.hasNextPage({ page: 2, pageSize: 20, total: 45 }));
  ok("audit: only known detail fields shown", M.auditDetailLines({ from: "in_review", to: "approved", note: "ok", secretish: "x" }).join("|") === "In review → Approved|Note: ok");
  ok("audit: story events labelled", M.auditActionLabel("story.published") === "Published" && M.auditActionLabel("review.invalidated").includes("content changed"));
  ok("tabs: the eight Studio sections", M.STUDIO_TABS.map((t) => t.label).join() === "Overview,Calendar,Library,Review,Media,Distribution,Analytics,Settings");
  const policy = readFileSync(path.join(root, "../api-server/src/lib/studio/policy.ts"), "utf8");
  const serverRoles = (name) => new RegExp(`${name} = \\[([\\s\\S]*?)\\]`).exec(policy)[1].match(/"[a-z_]+"/g).map((s) => s.slice(1, -1)).sort().join();
  ok("roles: client view/audit role lists match the server's", [...M.STUDIO_VIEW_ROLES].sort().join() === serverRoles("STUDIO_VIEW_ROLES") && [...M.STUDIO_AUDIT_ROLES].sort().join() === serverRoles("AUDIT_VIEW_ROLES"));
}

// ── 3. Action flows (fake API) ─────────────────────────────────────────────
{
  const E = Api.StudioApiError;
  const fake = (o) => ({ changeReviewState: async () => { throw new E("x", "server", 500); }, createSchedule: async () => { throw new E("x", "server", 500); }, cancelSchedule: async () => ({ cancelled: true }), setStoryStatus: async () => ({}), ...o });
  const item = story("a", { studio: studio({ reviewState: "in_review", version: 5 }) });
  let sentVersion;
  const okR = await A.runReviewChange(item, "approved", "", fake({ changeReviewState: async (_i, _to, v) => { sentVersion = v; return { reviewState: "approved", version: 6, cancelledPublishSchedules: 0 }; } }));
  ok("action: approve success + sends current version", okR.ok && /now approved/.test(okR.text) && sentVersion === 5);
  const conflict = await A.runReviewChange(item, "approved", "", fake({ changeReviewState: async () => { throw new E("This item was changed by someone else. Reload and try again.", "conflict", 409); } }));
  ok("action: concurrent edit → conflict outcome, nothing overwritten", !conflict.ok && conflict.conflict);
  const pubOk = await A.runStatusChange(item, "published", fake());
  ok("action: publish now success", pubOk.ok && /now published/.test(pubOk.text));
  const pubBlocked = await A.runStatusChange(item, "published", fake({ setStoryStatus: async () => { throw new E("This story changed after it was approved. It remains unpublished until it is reviewed again.", "conflict", 409, "studio_approval_stale"); } }));
  ok("action: publish refused by the gate → clear 'remains unpublished' message", !pubBlocked.ok && /remains unpublished/.test(pubBlocked.text));
  const replay = await A.runCreateSchedule(item, { action: "publish", localTime: "2026-11-01T09:00", timezone: "UTC" }, "k-12345678", fake({ createSchedule: async () => ({ replayed: true, schedule: {} }) }));
  ok("action: replayed request reported as no duplicate", replay.ok && /no duplicate/.test(replay.text));
  const partial = await A.runReschedule(item, sched(), { action: "publish", localTime: "2026-11-02T09:00", timezone: "UTC" }, "k-abcdefgh", fake({ createSchedule: async () => { throw new E("bad", "validation", 400); } }));
  ok("action: reschedule half-failure says nothing is scheduled now", !partial.ok && /Nothing is scheduled/.test(partial.text));
}

// ── 4. Shared components ───────────────────────────────────────────────────
{
  const U = load("components/studio/StudioUI.tsx");
  const perm = expand(React.createElement(U.StateView, { error: new Api.StudioApiError("No.", "permission", 403), onRetry: () => {} }));
  ok("state: permission denied, no retry button", /No access/.test(textOf(perm)) && !button(perm, "Try again"));
  ok("state: server error offers retry", !!button(expand(React.createElement(U.StateView, { error: new Api.StudioApiError("x", "server", 500), onRetry: () => {} })), "Try again"));
  ok("state: loading and empty", findAll(expand(React.createElement(U.StateView, { loading: true })), (n) => n.type === RN.ActivityIndicator).length === 1
    && /Nothing to see/.test(textOf(expand(React.createElement(U.StateView, { empty: true, emptyText: "Nothing to see" })))));
  const dis = expand(React.createElement(U.Button, { label: "Approve", onPress: () => {}, disabled: true }));
  ok("button: disabled state exposed, 44px target", dis.props.accessibilityState.disabled === true && dis.props.style.some((s) => s && s.minHeight === 44));
  const pill = expand(React.createElement(U.Pill, { label: "Any", selected: true, onPress: () => {} }));
  ok("pill: selected state reaches the browser (aria-selected), 44px target", pill.props["aria-selected"] === true && pill.props.style.some((s) => s && s.minHeight === 44));
  const dlg = expand(React.createElement(U.ConfirmDialog, { visible: true, title: "Request changes?", message: "m", confirmLabel: "Request changes", notePrompt: "What needs to change?", noteRequired: true, onConfirm: () => {}, onCancel: () => {} }));
  ok("confirm: required note blocks confirmation", button(dlg, "Request changes").props.disabled === true);
  const pager = expand(React.createElement(U.Pager, { page: 0, pageSize: 20, total: 45, onPage: () => {} }));
  ok("pager: label and disabled Previous on the first page", /1–20 of 45/.test(textOf(pager)) && button(pager, "Previous").props.disabled === true && !button(pager, "Next").props.disabled);
}

// ── 5. Screens ─────────────────────────────────────────────────────────────
{
  // Layout: eight tabs + Create; non-Studio role → no access.
  env.profile = { id: "u-me", role: "admin_content" };
  env.pathname = "/admin/studio/review";
  let tree = render("app/admin/studio/_layout.tsx");
  const tabs = findAll(tree, (n) => n.props?.accessibilityRole === "tab");
  ok("layout: eight Studio tabs with selected state", tabs.length === 8 && tabs.find((t) => t.props.accessibilityLabel === "Review").props["aria-selected"] === true);
  ok("layout: Create content entry point", !!button(tree, "Create content"));
  env.profile = { id: "u-pg", role: "peer_guide" };
  ok("layout: role outside the Studio → No access", /No access/.test(textOf(render("app/admin/studio/_layout.tsx"))));
  env.profile = { id: "u-me", role: "admin_content" };

  // Overview.
  env.query = q({ timezone: "UTC", generatedAt: iso(Date.now()), stories: { draft: 3, review: 1, published: 4, archived: 0 }, review: { in_review: 2, changes_requested: 1, approved: 1 },
    schedules: { scheduled: 2, dueToday: 1, overdue: 0, failed: 1 }, recentlyPublished: [], wins: { awaitingModeration: 5, published: 9 }, activity: null });
  tree = render("app/admin/studio/index.tsx");
  ok("overview: tiles carry real counts with labels", !!buttons(tree).find((b) => b.props.accessibilityLabel.startsWith("In review: 2.")) && !!buttons(tree).find((b) => b.props.accessibilityLabel.startsWith("Failed / overdue: 1.")));
  ok("overview: non-auditor told where activity lives, Wins read-only", /visible to editors, supervisors/.test(textOf(tree)) && /Read-only in Studio/.test(textOf(tree)));
  env.query = q(null, { error: new Api.StudioApiError("The Publishing Studio is not set up yet (migration 188 has not been applied).", "not_installed", 503) });
  ok("overview: migration missing → clear state", /not set up yet/.test(textOf(render("app/admin/studio/index.tsx"))));
  env.query = q(null, { loading: true });
  ok("overview: loading state", findAll(render("app/admin/studio/index.tsx"), (n) => n.type === RN.ActivityIndicator).length === 1);

  // Library (stories).
  const approved = story("ok", { title: "Ready", studio: studio({ reviewState: "approved" }) });
  const stale = story("st", { title: "Stale", studio: studio({ reviewState: "approved", approvalStale: true }) });
  const live = story("lv", { title: "Live", nativeStatus: "published", studio: studio({ reviewState: "approved" }) });
  env.query = q({ ...page([approved, stale, live]), sourceType: "kingdom_story", label: "Kingdom Stories", editable: true, readOnlyReason: null, manage: { label: "", path: "/admin/kingdom-stories" } });
  tree = render("app/admin/studio/library.tsx");
  const publishNow = buttons(tree).filter((b) => b.props.accessibilityLabel === "Publish now");
  ok("library: Publish now offered only for approved, unchanged, unpublished stories", publishNow.length === 1);
  ok("library: stale approval flagged", /Changed since approval/.test(textOf(tree)));
  ok("library: Unpublish offered for the live story", buttons(tree).filter((b) => b.props.accessibilityLabel === "Unpublish").length === 1);
  ok("library: History link for an audit reader", buttons(tree).some((b) => b.props.accessibilityLabel === "History"));
  env.profile = { id: "u-mod", role: "admin_moderation" };
  env.query = q({ ...page([approved]), sourceType: "kingdom_story", label: "", editable: false, readOnlyReason: null, manage: { label: "", path: null } });
  tree = render("app/admin/studio/library.tsx");
  ok("library: viewer gets no Publish/Unpublish and no History", !button(tree, "Publish now") && !button(tree, "Unpublish") && !button(tree, "History"));
  env.profile = { id: "u-me", role: "admin_content" };
  // Library (read-only types).
  env.query = q({ ...page([{ ...story("w1", { title: "A win", nativeStatus: "submitted" }) }]), sourceType: "kingdom_win", label: "Kingdom Wins", editable: false,
    readOnlyReason: "Kingdom Wins are moderated in the existing moderation queue. The Studio shows them read-only.", manage: { label: "Open the Kingdom Wins moderation queue", path: "/admin/kingdom-wins-review" } });
  env.stateSwap = { kingdom_story: "kingdom_win" };
  tree = render("app/admin/studio/library.tsx");
  ok("library: Kingdom Wins read-only, no story actions, link to moderation", !button(tree, "Schedule") && !button(tree, "Open editor") && !button(tree, "Publish now") && !!button(tree, "Open the Kingdom Wins moderation queue") && /read-only/.test(textOf(tree)));
  env.query = q({ ...page([]), sourceType: "prayer_topic", label: "", editable: false, readOnlyReason: "Pray the Word topics keep their own status...", manage: { label: "No admin screen yet", path: null } });
  env.stateSwap = { kingdom_story: "prayer_topic" };
  tree = render("app/admin/studio/library.tsx");
  ok("library: Pray the Word honest about no admin screen (no fake link)", /No admin screen yet/.test(textOf(tree)) && !button(tree, "No admin screen yet"));
  env.stateSwap = null;

  // Review.
  env.query = q({ ...page([story("mine", { title: "Mine", studio: studio({ reviewState: "in_review", submittedBy: "u-me" }) }), story("theirs", { title: "Theirs", studio: studio({ reviewState: "in_review", submittedBy: "u-other" }) })]), state: "in_review", editable: true });
  tree = render("app/admin/studio/review.tsx");
  const approves = buttons(tree).filter((b) => b.props.accessibilityLabel === "Approve");
  ok("review: Approve disabled on own submission, enabled on another's", approves.length === 2 && approves.filter((b) => b.props.disabled).length === 1);
  ok("review: explains approval binds to content", /Any later change to its text, media or sources/.test(textOf(tree)));
  env.stateSwap = { in_review: "approved" };
  env.query = q({ ...page([approved, stale]), state: "approved", editable: true });
  tree = render("app/admin/studio/review.tsx");
  ok("review: approved queue offers Publish now only for the unchanged story", buttons(tree).filter((b) => b.props.accessibilityLabel === "Publish now").length === 1 && /review again/.test(textOf(tree)));
  env.stateSwap = null;
  env.query = q({ ...page([story("x", { studio: studio({ reviewState: "in_review", submittedBy: "u-other" }) })]), state: "in_review", editable: false });
  tree = render("app/admin/studio/review.tsx");
  ok("review: viewer sees no review actions", !button(tree, "Approve") && /cannot submit, approve/.test(textOf(tree)));
  env.stateSwap = { in_review: "draft" };
  env.query = q({ ...page([story("d1", { title: "Draft one", nativeStatus: "review", studio: null })]), state: "draft", editable: true });
  tree = render("app/admin/studio/review.tsx");
  ok("review: unsubmitted story (even one marked 'review' by the old button) offers Submit for review", !!button(tree, "Submit for review") && !button(tree, "Publish now"));
  env.stateSwap = null;
  const reviewSrc = readFileSync(path.join(root, "app/admin/studio/review.tsx"), "utf8");
  ok("review: title is not a link; the editor opens only from its own guarded button", !!button(tree, "Open editor") && !/accessibilityRole="link"/.test(reviewSrc)
    && /onPress=\{guardTap\(\(\) => router\.push\(`\/admin\/kingdom-stories\/\$\{item\.sourceId\}`/.test(reviewSrc));
  ok("review: a story acted on stays in place with its fresh state until the tab changes", /kept\.items\[id\] \?\? byId\.get\(id\)/.test(reviewSrc) && /function switchQueue[^\n]*setKept\(\{ order: \[\], items: \{\}, outcomes: \{\} \}\)/.test(reviewSrc));
  const stepsSrc = readFileSync(path.join(root, "components/studio/StudioSteps.tsx"), "utf8");
  ok("steps: reload the story's Studio state after every step (next step uses the new version)", /fresh = \(await getStudioItem\(item\.sourceId\)\)\.item/.test(stepsSrc) && /onDone\(outcome, fresh\)/.test(stepsSrc));
  ok("steps: taps just after a dialog closes are ignored", /const TAP_GUARD_MS = 600;/.test(stepsSrc) && /function close\(\) \{ lastDialogClose = Date\.now\(\);/.test(stepsSrc)
    && (stepsSrc.match(/onPress=\{guardTap\(/g) ?? []).length === 3);
  ok("steps: Publish now offered whenever the approval allows it (not only on the Approved tab)", /editable && !publishBlock \? <Button label="Publish now"/.test(stepsSrc));

  // Schedule editor.
  env.params = { sourceId: "s1" };
  env.query = q({ editable: true, item: story("s1", { studio: studio({ reviewState: "in_review" }) }) });
  tree = render("app/admin/studio/schedule.tsx");
  ok("schedule: unapproved story blocked, submit disabled", /must be approved before it can be scheduled/.test(textOf(tree)) && button(tree, "Review and schedule").props.disabled === true);
  env.query = q({ editable: true, item: story("s1", { studio: studio({ reviewState: "approved", approvalStale: true }) }) });
  ok("schedule: stale approval blocked", /changed after it was approved/.test(textOf(render("app/admin/studio/schedule.tsx"))));
  env.query = q({ editable: false, item: story("s1", { studio: studio({ reviewState: "approved" }), schedules: [sched()] }) });
  tree = render("app/admin/studio/schedule.tsx");
  ok("schedule: viewer cannot cancel or schedule", !button(tree, "Cancel") && /cannot schedule content/.test(textOf(tree)));
  env.query = q(null, { error: new Api.StudioApiError("Kingdom Wins are moderated in the existing moderation queue.", "permission", 403) });
  ok("schedule: refused item → no-access state", /No access/.test(textOf(render("app/admin/studio/schedule.tsx"))));
  const schedSrc = readFileSync(path.join(root, "app/admin/studio/schedule.tsx"), "utf8");
  ok("schedule: ambiguous time requires an explicit choice before submit", /const needsFold = !!preview\?\.ambiguous && fold === null;/.test(schedSrc) && /!needsFold/.test(schedSrc) && /useState<"earlier" \| "later" \| null>\(null\)/.test(schedSrc));
  env.params = {};

  // Calendar.
  env.query = q({ from: "", to: "", events: [{ kind: "schedule", id: "e1", sourceId: "s", title: "Due story", action: "publish", at: iso(Date.now() + HOUR), localTime: "", timezone: "", status: "pending", attempts: 0, lastError: null }] });
  env.window = { width: 1200, height: 800 };
  tree = render("app/admin/studio/calendar.tsx");
  ok("calendar: month grid with labelled day cells (44px+)", buttons(tree).filter((b) => /^\d{4}-\d{2}-\d{2}/.test(b.props.accessibilityLabel)).length >= 28);
  env.window = { width: 380, height: 800 };
  tree = render("app/admin/studio/calendar.tsx");
  ok("calendar: phone width defaults to agenda", !buttons(tree).some((b) => /^\d{4}-\d{2}-\d{2}/.test(b.props.accessibilityLabel)));
  env.window = { width: 1200, height: 800 };

  // Audit.
  env.params = { sourceId: "s1", title: "S" };
  env.query = q({ page: 0, pageSize: 25, total: 1, entries: [{ id: 1, at: iso(Date.now()), actor_id: "u-x", actor_role: "admin_content", action: "review.approved", details: { from: "in_review", to: "approved" } }] });
  tree = render("app/admin/studio/audit.tsx");
  ok("audit: entries with filters, no mutation controls", /Approved/.test(textOf(tree)) && !!button(tree, "Reviews") && !buttons(tree).some((b) => /delete|edit|remove|clear/i.test(b.props.accessibilityLabel ?? "")));
  env.query = q(null, { error: new Api.StudioApiError("Your role cannot view the audit history.", "permission", 403) });
  ok("audit: non-reader → No access", /No access/.test(textOf(render("app/admin/studio/audit.tsx"))));
  env.params = {};

  // Media / Distribution / Analytics / Settings / Create.
  env.query = q({ page: 0, pageSize: 25, total: 1, items: [{ id: "m1", sourceId: "s1", storyTitle: "Story", storyStatus: "published", mediaType: "image", fileName: "a.jpg", caption: "Cover", isCover: true, durationSeconds: null, createdAt: iso(Date.now()) }] });
  tree = render("app/admin/studio/media.tsx");
  ok("media: lists with story context, only 'Open story' actions (no upload/delete here)", !!buttons(tree).find((b) => /Open story/.test(b.props.accessibilityLabel)) && !buttons(tree).some((b) => /upload|delete|remove|replace/i.test(b.props.accessibilityLabel ?? "")));
  tree = render("app/admin/studio/distribution.tsx");
  ok("distribution: honest 'not available' states, only real links", /Not available yet/.test(textOf(tree)) && /Not measured/.test(textOf(tree)) && buttons(tree).every((b) => b.props.accessibilityRole === "link"));
  env.query = q({ generatedAt: iso(Date.now()), publishedByMonth: [{ month: "2026-09", count: 3 }], publishedByCategory: [{ category: "Revival", count: 3 }], scheduledJobsLast30Days: { succeeded: 2, failed: 1, cancelled: 0 }, reviewActivityLast30Days: { submitted: 4, approved: 2, changesRequested: 1 }, notMeasured: ["Story views and reads"] });
  tree = render("app/admin/studio/analytics.tsx");
  ok("analytics: shows only server-provided counts and the 'not measured' list", /Revival: 3/.test(textOf(tree)) && /Story views and reads/.test(textOf(tree)) && /Succeeded: 2/.test(textOf(tree)));
  env.query = q({ schedulerEnabled: false, scheduling: { minLeadMinutes: 1, maxLeadDays: 366, maxAttempts: 5, retryBaseSeconds: 60, retryMaxMinutes: 60, staleClaimMinutes: 10 }, roles: { view: ["admin_content"], edit: ["admin_content", "super_admin"], audit: ["super_admin"] }, approval: { independentReviewer: true, superAdminMaySelfApprove: true, bindsToContent: true, liveStoriesFrozen: true }, yourRole: "admin_content" });
  tree = render("app/admin/studio/settings.tsx");
  ok("settings: read-only, scheduler shown off", /Scheduler off/.test(textOf(tree)) && findAll(tree, (n) => n.type === RN.TextInput).length === 0 && buttons(tree).length === 0);
  tree = render("app/admin/studio/create.tsx");
  ok("create: editor can start a Kingdom Story; unsupported types clearly unavailable", !!button(tree, "Create Kingdom Story") && /No admin screen yet/.test(textOf(tree)) && /Managed in the church portal/.test(textOf(tree)) && !button(tree, "Create Kingdom Win"));
  env.profile = { id: "u-mod", role: "admin_moderation" };
  ok("create: moderator cannot start a Kingdom Story", !button(render("app/admin/studio/create.tsx"), "Create Kingdom Story"));
  env.profile = { id: "u-me", role: "admin_content" };
}

// ── 6. Story editor approval notice + static guarantees ────────────────────
{
  const editor = readFileSync(path.join(root, "app/admin/kingdom-stories/[id].tsx"), "utf8");
  const ksApi = readFileSync(path.join(root, "lib/kingdomStoriesApi.ts"), "utf8");
  ok("editor: API errors carry studioRequired from the server", /studioRequired: b\.studioRequired === true/.test(ksApi));
  ok("editor: approval refusals shown in-screen (not a bare error), next to the Publish button", /if \(e\?\.studioRequired\) setStudioNotice\(\{ message: e\.message, where \}\)/.test(editor)
    && /reportError\("Couldn't update status", e, "lifecycle"\)/.test(editor) && /studioNotice\?\.where === "lifecycle"/.test(editor));
  ok("editor: Studio link only for Studio roles", /canOpenStudio = !!profile && STUDIO_VIEW_ROLES\.includes\(profile\.role\)/.test(editor) && /\{canOpenStudio \? \(/.test(editor));
  ok("editor: live-story edits and media/source changes report via the notice", ["Couldn't remove media", "Couldn't add source", "Couldn't remove source", "Couldn't add photo"].every((t) => editor.includes(`reportError("${t}", e)`)));
  ok("editor: Unpublish to edit offered for live stories", /handleStatusChange\("draft"\)} accessibilityRole="button" accessibilityLabel="Unpublish to edit"/.test(editor));
  ok("editor: one review process — no old Move to Review / direct Publish, the Studio's steps instead", !editor.includes("Move to Review") && !/handleStatusChange\("(review|published)"\)/.test(editor)
    && /<StudioSteps item=\{studioItem\}/.test(editor) && /Submit, approve and publish in the Publishing Studio/.test(editor));
  const dir = path.join(root, "app/admin/studio");
  const files = readdirSync(dir).map((f) => path.join(dir, f)).concat([path.join(root, "components/studio/StudioUI.tsx"), path.join(root, "components/studio/useStudioQuery.ts"), path.join(root, "lib/studioActions.ts"), path.join(root, "lib/studioModel.ts")]);
  const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
  ok("static: Studio UI never queries Supabase directly", !/supabase\s*\.\s*(from|rpc)\(/.test(all) && !/p2p_studio_/.test(all));
  ok("static: no direct writes to native content from the Studio UI", !/p2p_kingdom_(stories|wins)/.test(all));
  const layout = readFileSync(path.join(root, "app/admin/_layout.tsx"), "utf8");
  ok("nav: Publishing Studio entry filtered by Studio roles", /label: "Publishing Studio", path: "\/admin\/studio"[^\n]*roles: STUDIO_VIEW_ROLES/.test(layout));
  ok("unchanged: ordinary users keep in-app sharing of Kingdom Stories and Wins", /Share\.share/.test(readFileSync(path.join(root, "app/kingdom-stories/[id].tsx"), "utf8")) && /Share\.share/.test(readFileSync(path.join(root, "app/kingdom-wins/[id].tsx"), "utf8")));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
