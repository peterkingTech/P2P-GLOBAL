// Tests for QR codes: lib/qrLinks.ts (what codes contain, what scans may
// open, permission gating), components/qr/QrShareSheet.tsx (rendering, copy,
// share) and source checks on the scanner screen, the profile tab and the
// Circle detail screen. Real files transpiled with TypeScript; no device.
// Camera scanning itself, the OS share sheet and deep links from outside the
// app need a real phone and are NOT proven here.
// Run: node tests/qr.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
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

let slots = [], slot = 0;
const reactMock = {
  ...React,
  useState: (init) => { const i = slot++; if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init; return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
  useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useRef: (v) => ({ current: v }),
};
const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const shares = [], copies = [];
const RN = {
  View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), Modal: host("Modal"),
  StyleSheet: { create: (s) => s, absoluteFill: {} },
  Share: { share: async (o) => { shares.push(o); return { action: "sharedAction" }; }, sharedAction: "sharedAction" },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
};
const colors = { accentGreen: "#0b0", lightCream: "#fff", card: "#fff", borderBeige: "#ddd", textDark: "#111", textMid: "#333", textMuted: "#777" };
const QRCode = host("QRCode");
const mocks = {
  react: reactMock, "react-native": RN,
  "@expo/vector-icons": { Ionicons: host("Ionicons") },
  "expo-clipboard": { setStringAsync: async (s) => { copies.push(s); return true; } },
  "react-native-qrcode-svg": { default: QRCode, __esModule: true },
  "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
  "@/contexts/ThemeContext": { useTheme: () => ({ colors }) },
  "@/hooks/useLayout": { useSheetWidth: () => ({}) },
};
const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${spec}`);
}
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Math, JSON, String, Number, Array, Object, Set, Map, Date, Promise, Error, RegExp, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout,
    require: (n) => (n in mocks ? mocks[n] : loadFile(resolveFile(n, path.dirname(file)))) });
  return mod.exports;
}
const load = (rel) => loadFile(path.join(root, rel));
const src = (rel) => readFileSync(path.join(root, rel), "utf8");

const Q = load("lib/qrLinks.ts");
const S = load("lib/sharing.ts");
const SITE = S.WEB_APP_URL;
const CIRCLE = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";
const circleLower = CIRCLE.toLowerCase();

// ── What a code contains ────────────────────────────────────────────────────
const prof = Q.profileQr("@grace.ade");
ok("profile QR: built from the public @username", prof && prof.kind === "profile");
ok("profile QR: HTTPS landing URL on the official site", prof.url.startsWith(`${SITE}/share-landing.html?`));
const profParams = Object.fromEntries(prof.url.split("?")[1].split("&").map((p) => p.split("=")).map(([k, v]) => [k, decodeURIComponent(v)]));
ok("profile QR: only type, title (@username) and app link", JSON.stringify(Object.keys(profParams).sort()) === JSON.stringify(["link", "title", "type"]), JSON.stringify(profParams));
ok("profile QR: app link targets that profile", profParams.link === "p2pglobalbiblestudy://profile/grace.ade" && profParams.title === "@grace.ade");
ok("profile QR: no username → no code", Q.profileQr(null) === null && Q.profileQr("") === null && Q.profileQr("   ") === null);
ok("profile QR: unsafe username → no code", Q.profileQr("a/b") === null && Q.profileQr("x y") === null && Q.profileQr("<script>") === null);

const circ = Q.circleQr({ id: CIRCLE, name: "Romans Study (private notes)" });
const circParams = Object.fromEntries(circ.url.split("?")[1].split("&").map((p) => p.split("=")).map(([k, v]) => [k, decodeURIComponent(v)]));
ok("circle QR: only type and app link (no name in the code)", JSON.stringify(Object.keys(circParams).sort()) === JSON.stringify(["link", "type"]) && !circ.url.includes("Romans"));
ok("circle QR: app link targets the Circle id", circParams.link === `p2pglobalbiblestudy://circles/${circleLower}`);
ok("circle QR: says scanning doesn't join", /doesn't join/.test(circ.note) && /leader approves/.test(circ.note));
ok("circle QR: non-UUID id → no code", Q.circleQr({ id: "123", name: "x" }) === null && Q.circleQr({ id: `${CIRCLE}/x`, name: "x" }) === null);

const app = Q.appQr();
ok("app QR: the official website, nothing else", app.url === SITE && app.url === "https://peer-to-peer-globalbiblestudynetwork.netlify.app");
ok("app QR: labelled separately from the profile QR", app.title !== prof.title && app.caption === "Scan to get P2P Global" && prof.caption === "Scan to view my profile" && /not your profile/.test(app.note));
ok("share messages carry exactly the encoded URL", prof.shareMessage.includes(prof.url) && circ.shareMessage.includes(circ.url) && app.shareMessage.includes(app.url));
for (const spec of [prof, circ, app]) {
  ok(`${spec.kind} QR: no tokens, ids of the viewer, or emails`, !/token|access|secret|@[a-z]+\.[a-z]+|userId|user_id/i.test(spec.url.replace("@grace.ade", "")));
  ok(`${spec.kind} QR: short enough to scan easily (< 200 chars)`, spec.url.length < 200, String(spec.url.length));
}

// ── No store listing is invented ───────────────────────────────────────────
const sharingSrc = src("lib/sharing.ts");
ok("sharing.ts: no Play Store / App Store URL left (none confirmed for the current package)", !/play\.google\.com|apps\.apple\.com/.test(sharingSrc));
ok("qrLinks.ts: no store URL", !/play\.google\.com|apps\.apple\.com/.test(src("lib/qrLinks.ts")));

// ── Landing page compatibility: the page will open the app links we encode ──
const landing = src("web/share-landing.html");
const lm = landing.match(/var deepLink = (\/\^p2pglobalbiblestudy.*?\$\/)\.test\(rawLink\)/);
ok("landing page: allow-list regex found", !!lm);
if (lm) {
  const re = vm.runInNewContext(lm[1]);
  ok("landing page accepts the profile app link", re.test(profParams.link));
  ok("landing page accepts the Circle app link", re.test(circParams.link));
}

// ── Scanning: round trips ──────────────────────────────────────────────────
const P = Q.parseP2PCode;
const eq = (name, got, kind, pathStr) => ok(name, got.ok === true && got.kind === kind && got.path === pathStr, JSON.stringify(got));
eq("scan profile QR → profile screen", P(prof.url), "profile", "/profile/grace.ade");
eq("scan Circle QR → Circle screen", P(circ.url), "circle", `/circles/${circleLower}`);
eq("scan app QR → nothing to open beyond the app", P(app.url), "app", "/");
eq("scan app QR with trailing slash", P(`${SITE}/`), "app", "/");
eq("app link: profile", P("p2pglobalbiblestudy://profile/grace.ade"), "profile", "/profile/grace.ade");
eq("app link: Circle (uppercase id normalised)", P(`p2pglobalbiblestudy://circles/${CIRCLE}`), "circle", `/circles/${circleLower}`);
const roomTok = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
eq("app link: room invitation (existing screen validates the token)", P(`p2pglobalbiblestudy://rooms/join/${roomTok}`), "room", `/rooms/join/${roomTok}`);
eq("app link: lesson", P("p2pglobalbiblestudy://lesson/abc-123"), "lesson", "/lesson/abc-123");
eq("app link: plan", P("p2pglobalbiblestudy://plan/p_1"), "plan", "/plan/p_1");
eq("app link: plan category", P("p2pglobalbiblestudy://plans/category/c1"), "category", "/plans/category/c1");
eq("existing church invite QR → join screen with the code filled in", P(`${SITE}/join/church/grace-chapel-lagos-ab12cd`), "church", "/church/join?code=grace-chapel-lagos-ab12cd");
eq("existing personal invite link → that person's profile", P(`${SITE}/join/@grace.ade`), "profile", "/profile/grace.ade");
eq("existing shared lesson link (share-landing) → lesson", P(`${SITE}/share-landing.html?type=lesson&title=Hi&desc=&link=${encodeURIComponent("p2pglobalbiblestudy://lesson/l1")}`), "lesson", "/lesson/l1");
eq("whitespace around a pasted link is ignored", P(`  ${prof.url}\n`), "profile", "/profile/grace.ade");
eq("trailing slash / query on an app link is ignored", P("p2pglobalbiblestudy://profile/grace.ade/?utm=x"), "profile", "/profile/grace.ade");
eq("host matched case-insensitively", P(prof.url.replace("peer-to-peer", "PEER-TO-PEER")), "profile", "/profile/grace.ade");

// ── Scanning: refusals ─────────────────────────────────────────────────────
const no = (name, got, reason) => ok(name, got.ok === false && got.reason === reason, JSON.stringify(got));
no("empty", P(""), "empty"); no("whitespace", P("   "), "empty"); no("not a string", P(undefined), "empty"); no("object", P({ data: 1 }), "empty");
no("too long", P(`${SITE}/?${"a".repeat(3000)}`), "not_p2p");
no("other website", P("https://example.com/profile/grace"), "not_p2p");
no("look-alike host", P("https://peer-to-peer-globalbiblestudynetwork.netlify.app.evil.com/join/@grace"), "not_p2p");
no("userinfo trick", P("https://peer-to-peer-globalbiblestudynetwork.netlify.app@evil.com/"), "not_p2p");
no("plain http", P("http://peer-to-peer-globalbiblestudynetwork.netlify.app/join/@grace"), "not_p2p");
no("javascript: URL", P("javascript:alert(1)"), "not_p2p");
no("Wi-Fi / contact codes", P("WIFI:T:WPA;S:home;P:secret;;"), "not_p2p");
no("unknown app screen", P("p2pglobalbiblestudy://admin/registrations"), "unsupported");
no("app root", P("p2pglobalbiblestudy://"), "unsupported");
no("path traversal", P("p2pglobalbiblestudy://profile/../admin"), "unsupported");
no("Circle with a non-UUID id", P("p2pglobalbiblestudy://circles/not-a-uuid"), "unsupported");
no("room token too short", P("p2pglobalbiblestudy://rooms/join/abc"), "unsupported");
no("room token with bad characters", P(`p2pglobalbiblestudy://rooms/join/${roomTok}%2F..`), "unsupported");
no("landing link to another site", P(`${SITE}/share-landing.html?type=profile&link=${encodeURIComponent("https://evil.com")}`), "unsupported");
no("landing link with javascript:", P(`${SITE}/share-landing.html?link=${encodeURIComponent("javascript:alert(1)")}`), "unsupported");
no("landing page with no link", P(`${SITE}/share-landing.html?type=app`), "unsupported");
no("malformed percent-encoding", P(`${SITE}/share-landing.html?link=%E0%A4%A`), "unsupported");
no("unknown site path", P(`${SITE}/admin`), "unsupported");
no("church code with odd characters", P(`${SITE}/join/church/${encodeURIComponent("<x>")}`), "unsupported");
let threw = false;
for (const s of ["%", "p2pglobalbiblestudy://%%%", `${SITE}/join/%`, `${SITE}/join/church/%`, "\u0000", "p2pglobalbiblestudy://profile/‮"]) { try { P(s); } catch { threw = true; } }
ok("parser never throws on garbage", !threw);

// ── Errors never echo the scanned content ──────────────────────────────────
const secret = "p2pglobalbiblestudy://rooms/join/SECRETTOKEN";
const msgs = ["empty", "not_p2p", "unsupported"].map(Q.scanErrorMessage);
ok("error messages are fixed text (no scanned content)", msgs.every((m) => typeof m === "string" && m.length > 10 && !m.includes("SECRET") && !m.includes("http")));

// ── One scan per code ──────────────────────────────────────────────────────
const opened = [], invalid = [];
const h = Q.createScanHandler({ open: (p) => opened.push(p), onInvalid: (m) => invalid.push(m) });
h.handle(prof.url); h.handle(prof.url); h.handle(circ.url);
ok("repeat camera callbacks open only once", opened.length === 1 && opened[0] === "/profile/grace.ade" && h.locked);
h.reset(); h.handle("https://example.com"); h.handle(prof.url);
ok("invalid code reports once and stays locked until 'Scan again'", invalid.length === 1 && opened.length === 1);
h.reset(); h.handle(circ.url);
ok("after reset the next code opens", opened.length === 2 && opened[1] === `/circles/${circleLower}`);
ok("handler reports success / failure", Q.createScanHandler({ open() {}, onInvalid() {} }).handle(prof.url) === true && Q.createScanHandler({ open() {}, onInvalid() {} }).handle(secret.replace("SECRETTOKEN", "x")) === false);

// ── Camera permission ──────────────────────────────────────────────────────
ok("permission: unknown yet → checking", Q.scannerGate(null) === "checking");
ok("permission: granted → camera", Q.scannerGate({ granted: true, canAskAgain: true }) === "ready");
ok("permission: not yet asked → explain first", Q.scannerGate({ granted: false, canAskAgain: true }) === "explain");
ok("permission: denied for good → Settings + paste fallback", Q.scannerGate({ granted: false, canAskAgain: false }) === "blocked");

// ── Scanner screen (source checks) ─────────────────────────────────────────
const scan = src("app/qr/scan.tsx");
const reqCalls = scan.match(/requestPermission\(\)/g) ?? [];
ok("scanner: permission requested only from the button press", reqCalls.length === 1 && /onPress=\{\(\) => \(gate === "explain" \? void requestPermission\(\)/.test(scan) && !/useEffect/.test(scan));
ok("scanner: explains why before asking", /uses the camera only while this screen is open/.test(scan));
ok("scanner: denied → Open Settings", /Linking\.openSettings\(\)/.test(scan));
ok("scanner: paste-a-link fallback uses the same parser", /scanner\.handle\(pasted\)/.test(scan) && /Or paste a P2P Global link/.test(scan));
ok("scanner: QR codes only", /barcodeTypes: \["qr"\]/.test(scan));
ok("scanner: camera paused while an error is shown", /onBarcodeScanned=\{error \? undefined :/.test(scan));
ok("scanner: opens with replace (back returns to where you were)", /router\.replace\(path as any\)/.test(scan));
ok("scanner: never opens external URLs", !/Linking\.openURL|WebBrowser/.test(scan));
for (const f of ["app/qr/scan.tsx", "lib/qrLinks.ts", "components/qr/QrShareSheet.tsx"]) ok(`${f}: no logging of scanned/shared content`, !/console\./.test(src(f)));

// ── QR sheet rendering ─────────────────────────────────────────────────────
function expand(node, out = []) {
  if (node == null || typeof node === "boolean") return out;
  if (Array.isArray(node)) { for (const n of node) expand(n, out); return out; }
  if (typeof node !== "object") return out;
  if (typeof node.type === "function" && !node.type.__host) return expand(node.type(node.props), out);
  out.push(node);
  expand(node.props?.children, out);
  return out;
}
const { QrShareSheet } = load("components/qr/QrShareSheet.tsx");
slots = []; slot = 0;
const nodes = expand(QrShareSheet({ spec: prof, visible: true, onClose() {} }));
const qr = nodes.find((n) => n.type === QRCode);
ok("sheet: renders the QR with exactly the spec URL", qr && qr.props.value === prof.url);
ok("sheet: black on white, quiet zone, error correction, no logo over the code", qr && qr.props.color === "#000000" && qr.props.backgroundColor === "#FFFFFF" && qr.props.quietZone >= 8 && ["M", "Q", "H"].includes(qr.props.ecl) && !("logo" in qr.props));
ok("sheet: readable size on a phone", qr && qr.props.size >= 200, String(qr?.props.size));
const texts = nodes.filter((n) => n.type === RN.Text).map((n) => [].concat(n.props.children).join(""));
ok("sheet: shows the caption and what scanning does", texts.includes("Scan to view my profile") && texts.some((t) => /doesn't connect you/.test(t)));
ok("sheet: shows the link as text fallback", texts.includes(prof.url));
const byLabel = (l) => nodes.find((n) => n.props?.accessibilityLabel === l);
await byLabel("Copy link").props.onPress();
ok("sheet: Copy link copies exactly the encoded URL", copies.length === 1 && copies[0] === prof.url);
await byLabel("Share link").props.onPress();
ok("sheet: Share opens the OS share sheet with the URL", shares.length === 1 && shares[0].message.includes(prof.url));
ok("sheet: Enlarge and Close are labelled buttons", nodes.filter((n) => n.props?.accessibilityLabel === "Enlarge QR code").length >= 1 && !!byLabel("Close"));
const buttons = ["Copy link", "Share link", "Close"].map(byLabel);
ok("sheet: 44pt touch targets", src("components/qr/QrShareSheet.tsx").match(/minHeight: 44/g).length >= 3);
slots = []; slot = 0;
ok("sheet: nothing rendered without a spec", QrShareSheet({ spec: null, visible: true, onClose() {} }) === null);
// Enlarged view: flip the enlarged state slot and re-render.
slots = []; slot = 0;
QrShareSheet({ spec: circ, visible: true, onClose() {} });
const enlargedSlot = slots.findIndex((v) => v === false);
slots[enlargedSlot] = true; slot = 0;
const big = expand(QrShareSheet({ spec: circ, visible: true, onClose() {} })).find((n) => n.type === QRCode);
ok("sheet: enlarged code is bigger", big && big.props.size > qr.props.size, `${big?.props.size} vs ${qr?.props.size}`);

// ── Entry points (source checks) ───────────────────────────────────────────
const tab = src("app/(tabs)/profile.tsx");
ok("profile tab: My QR code uses profileQr(@username)", /profileQr\(profile\?\.username\)/.test(tab) && /My QR code/.test(tab));
ok("profile tab: no username → explains instead of a broken code", /Set a username first", "Your QR code links/.test(tab));
ok("profile tab: Scan opens the scanner", /router\.push\("\/qr\/scan"/.test(tab));
ok("profile tab: Share P2P Global is a separate app QR", /setQrSpec\(appQr\(\)\)/.test(tab) && /Share P2P Global/.test(tab));

const cd = src("app/circles/[id].tsx");
ok("circle: QR button only for active members", /isMember \? \(\s*<TouchableOpacity onPress=\{\(\) => setQrOpen\(true\)\}/.test(cd) && /circle\?\.members\?\.some\(\(m\) => m\.userId === profile\.id\)/.test(cd));
ok("circle: Request to Join only for signed-in non-members", /profile\?\.id && !isMember \?/.test(cd));
ok("circle: joining is a request (same endpoint as Find a Circle), never automatic", /\/circles\/\$\{circleId\}\/join`/.test(cd) && (cd.match(/requestToJoin\b/g) ?? []).length === 2 && /onPress=\{requestToJoin\}/.test(cd));
ok("circle: request failure is reported, success isn't assumed", /if \(!res\.ok\) throw/.test(cd) && /Request sent\. The Circle leader will review it\./.test(cd));
ok("circle: missing Circle → 'not available' screen with a way back", /if \(!res\.ok\) \{ setCircle\(null\); return; \}/.test(cd) && /This Circle isn't available\./.test(cd) && /Go back/.test(cd));
ok("discover: original Request to Join unchanged", /requestToJoin\(c\.id\)/.test(src("app/circles/discover.tsx")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
