// iOS notification extensions + message-preview privacy (app side):
//   plugins/withNotificationServiceExtension.js + notification-service/
//   plugins/withNotificationContentExtension.js + notification-content/
//   plugins/appExtensionTarget.js, lib/notificationCategories.ts,
//   lib/messagePreviewSetting.ts, app/settings/notifications.tsx
// Config-level guarantees + source checks. The Xcode-project changes are
// validated against Expo's SDK 57 bare template with Expo's own mod compiler
// (scratchpad ext_validate.mjs); the Swift can only be compiled by an iOS
// build (EAS) and verified on an iPhone.
// Run: node tests/iosSenderPhotos.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const nse = require(path.join(root, "plugins/withNotificationServiceExtension.js"));
const nce = require(path.join(root, "plugins/withNotificationContentExtension.js"));
const appJson = JSON.parse(src("app.json")).expo;
ok("both plugins registered in app.json", appJson.plugins.includes("./plugins/withNotificationServiceExtension.js") && appJson.plugins.includes("./plugins/withNotificationContentExtension.js"));

delete process.env.P2P_IOS_SENDER_PHOTOS; delete process.env.P2P_IOS_PREVIEW_VIEW;
const BUNDLE = "com.amentech.p2pglobaldiscipleshipnetwork";
const prod = nce(nse({ name: "P2P", ios: { bundleIdentifier: BUNDLE }, extra: { eas: { projectId: "p" } } }));
const ext = prod.extra.eas.build.experimental.ios.appExtensions;
ok("EAS learns about both extensions (so it can sign them)", ext.length === 2
  && ext.some((e) => e.targetName === "NotificationService" && e.bundleIdentifier === `${BUNDLE}.NotificationService`)
  && ext.some((e) => e.targetName === "NotificationContent" && e.bundleIdentifier === `${BUNDLE}.NotificationContent`));
ok("existing EAS settings kept", prod.extra.eas.projectId === "p");
const staging = nce(nse({ name: "P2P", ios: { bundleIdentifier: `${BUNDLE}.staging` }, extra: {} }));
ok("staging builds get staging extension ids", staging.extra.eas.build.experimental.ios.appExtensions.every((e) => e.bundleIdentifier.startsWith(`${BUNDLE}.staging.`)));
process.env.P2P_IOS_SENDER_PHOTOS = "0"; process.env.P2P_IOS_PREVIEW_VIEW = "0";
const off = nce(nse({ name: "P2P", ios: { bundleIdentifier: "x" }, extra: {} }));
ok("each extension can be switched off for a build", !off.mods && !off.extra.eas);
delete process.env.P2P_IOS_SENDER_PHOTOS; delete process.env.P2P_IOS_PREVIEW_VIEW;
const ep = nse.previewEndpoints({ EXPO_PUBLIC_API_URL: "https://api.example.com/api/" });
ok("API base for previews: https, no trailing slash", ep.apiUrl === "https://api.example.com/api" || ep.apiUrl.startsWith("https://"), JSON.stringify(ep));
ok("helper: extensions follow the app's iOS minimum (16.4 unless app.json says otherwise)", /DEFAULT_IOS_DEPLOYMENT_TARGET = "16\.4"/.test(src("plugins/appExtensionTarget.js")) && /config\.ios\?\.deploymentTarget/.test(src("plugins/appExtensionTarget.js")));
ok("helper: a prebuild re-run never adds a second target", /if \(hasTarget\(project, name\)\) return;/.test(src("plugins/appExtensionTarget.js")));
// Build 58 regression: the long-press view showed an empty box because the
// linker dropped UserNotificationsUI (only used via protocol/ObjC messages).
ok("long-press view links UserNotificationsUI explicitly (build 58 blank-box fix)", /frameworks: \["UserNotificationsUI\.framework", "UserNotifications\.framework"\]/.test(src("plugins/withNotificationContentExtension.js")));
ok("service extension links UserNotifications + Intents explicitly", /frameworks: \["UserNotifications\.framework", "Intents\.framework"\]/.test(src("plugins/withNotificationServiceExtension.js")));
ok("helper adds frameworks to the extension's own Frameworks phase", /linkSystemFrameworks\(project, frameworksPhase\.uuid, group\.uuid, frameworks\)/.test(src("plugins/appExtensionTarget.js")) && /sourceTree: "SDKROOT"/.test(src("plugins/appExtensionTarget.js")));

// ── Service extension ─────────────────────────────────────────────────────
const s = src("plugins/notification-service/NotificationService.swift");
ok("reads photo + token where Expo puts them (userInfo.body)", /userInfo\["body"\]/.test(s) && /"_richContent"/.test(s) && /body\["previewToken"\]/.test(s));
ok("preview fetched with the token in a header, POST, over https", /setValue\(token, forHTTPHeaderField: "X-P2P-Preview-Token"\)/.test(s) && /httpMethod = "POST"/.test(s) && /url\.scheme == "https"/.test(s));
ok("ephemeral session: no cache, no cookies, bounded timeouts", /URLSessionConfiguration\.ephemeral/.test(s) && /urlCache = nil/.test(s) && /httpCookieStorage = nil/.test(s) && /timeoutIntervalForRequest = 8/.test(s));
ok("only a 200 with a well-formed body counts; size-capped", /http\.statusCode == 200/.test(s) && /data\.count <= 64 \* 1024/.test(s) && /prefix\(Self\.maxPreviewText\)/.test(s));
ok("voice only from our storage's voice-messages path", /url\.host == host/.test(s) && /hasPrefix\("\/storage\/v1\/object\/public\/voice-messages\/"\)/.test(s) && /!url\.path\.contains\("\.\."\)/.test(s));
ok("voice attachment only up to 5 MB (Apple's audio limit), as m4a", /audioLimitBytes = 5 \* 1024 \* 1024/.test(s) && /expectedContentLength > Int64\(Self\.audioLimitBytes\)/.test(s) && /size <= Self\.audioLimitBytes/.test(s) && /public\.mpeg-4-audio/.test(s));
ok("too-long voice → told to open the app (no streaming)", /voiceTooLong/.test(s) && !/AVPlayer\(url:/.test(s));
ok("timeout → the ORIGINAL notification (never half-built)", /serviceExtensionTimeWillExpire[\s\S]{0,200}if let original = original \{ finish\(original\) \}/.test(s));
ok("delivers once; temp files cleaned", /contentHandler = nil/.test(s) && /removeItem\(at: d\)/.test(s));
ok("routing data untouched: only adds userInfo[\"p2pPreview\"]", /info\["p2pPreview"\] = p2p/.test(s) && !/info\["body"\]\s*=/.test(s) && !/\.badge\s*=/.test(s) && !/\.sound\s*=/.test(s));
ok("body replaced only with server-authorised preview text", (s.match(/content\.body = /g) ?? []).length === 1 && /if pv\.kind == "text", let text = pv\.text \{/.test(s));
ok("no force-unwraps or force-tries in the extension", !/[^!=]!\s*\)/.test(s.replace(/!=/g, "")) && !/try!/.test(s));
const nsePlist = src("plugins/notification-service/NotificationService-Info.plist");
ok("Info.plist placeholders for API + trusted host (filled at prebuild)", /__P2P_API_BASE_URL__/.test(nsePlist) && /__P2P_TRUSTED_MEDIA_HOST__/.test(nsePlist));

// ── Content extension ─────────────────────────────────────────────────────
const v = src("plugins/notification-content/NotificationViewController.swift");
ok("layout: photo left, text middle, P2P mark right", /UIStackView\(arrangedSubviews: \[avatar, textStack, logo\]\)/.test(v));
ok("shows only what the service extension delivered (no network)", !/URLSession|dataTask|URL\(string/.test(v));
ok("Name only → generic body, no audio", /bodyLabel\.text = content\.body/.test(v) && /if kind == "voice"/.test(v));
ok("plays only the attached voice note", /attachments\.first\(where: \{ \$0\.identifier == "voice" \}\)/.test(v) && /startAccessingSecurityScopedResource/.test(v));
ok("audio stops when the view goes away, on interruption, on open", /viewWillDisappear[\s\S]{0,120}stopAudio\(\)/.test(v) && /interruptionNotification/.test(v) && /func openApp\(\)[\s\S]{0,80}stopAudio\(\)/.test(v));
ok("other taps open the app the normal way (existing routing/read/badge)", /performNotificationDefaultAction\(\)/.test(v));
ok("accessibility + Dynamic Type + dark mode", /accessibilityLabel/.test(v) && /adjustsFontForContentSizeCategory = true/.test(v) && /\.label\b/.test(v) && /\.secondaryLabel/.test(v));
ok("44 pt play target", /playButton\.widthAnchor\.constraint\(greaterThanOrEqualToConstant: 44\)/.test(v));
const ncePlist = src("plugins/notification-content/NotificationContent-Info.plist");
ok("content extension handles only p2p_message", /<key>UNNotificationExtensionCategory<\/key>\s*<string>p2p_message<\/string>/.test(ncePlist) && /com\.apple\.usernotifications\.content-extension/.test(ncePlist));

// ── App: categories + settings ───────────────────────────────────────────
const cats = src("lib/notificationCategories.ts");
ok("categories registered one after another, call category first and unchanged", /await registerIncomingCallCategory\(\);\s*\n\s*if \(Platform\.OS !== "ios"\) return;/.test(cats) && /setNotificationCategoryAsync\(MESSAGE_CATEGORY, \[\]\)/.test(cats));
ok("message category iPhone-only (Android unchanged)", /if \(Platform\.OS !== "ios"\) return;/.test(cats));
ok("push.ts uses the combined registration", /void registerNotificationCategories\(\);/.test(src("lib/push.ts")) && !/void registerIncomingCallCategory\(\);/.test(src("lib/push.ts")));
const setting = src("lib/messagePreviewSetting.ts");
ok("four levels with the approved names", /"Name and message"/.test(setting) && /"Name, reveal message on hold"/.test(setting) && /"Name only"/.test(setting) && /"Nothing"/.test(setting));
ok("reveal-on-hold readable and saved like the others", /v === "hold"/.test(setting) && /value: "hold"/.test(setting));
ok("before 194, message-content levels aren't offered or saved", /if \(state\.level === "full" \|\| state\.level === "hold"\) return false;/.test(setting) && /l\.value !== "full" && l\.value !== "hold"/.test(src("app/settings/notifications.tsx")));
ok("service extension: text goes in the banner ONLY when the server says banner", /if pv\.display == "banner" \{\s*\n\s*content\.body = text/.test(s));
ok("service extension: missing/unknown display → hold (banner stays private)", /\(json\["display"\] as\? String\) == "banner" \? "banner" : "hold"/.test(s));
ok("press-and-hold view still gets the text for hold", /p2p\["text"\] = text \/\/ shown in the press-and-hold view/.test(s));
ok("missing/unknown level reads as Name only", /isLevel\(v\) \? v : "name"/.test(setting));
ok("before 194: old switch on → Name only, off → Nothing; Name and message not offered", /notify_show_sender_name \? "name" : "none"/.test(setting) && /if \(state\.level === "full" \|\| state\.level === "hold"\) return false;/.test(setting));
ok("saves only the caller's own row", /\.update\(\{ notify_message_preview: state\.level \}\)\.eq\("id", userId\)/.test(setting));
ok("not part of the main profile load", !/notify_message_preview/.test(src("contexts/AuthContext.tsx")));
const screen = src("app/settings/notifications.tsx");
ok("settings: radio group, failed save restores the previous choice", /accessibilityRole="radiogroup"/.test(screen) && /accessibilityRole="radio"/.test(screen) && /setPreview\(previous\)/.test(screen));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
