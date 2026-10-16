// iOS sender photos (plugins/withNotificationServiceExtension.js +
// plugins/notification-service/): config-level guarantees and source checks
// on the extension. The Xcode-project changes were validated against Expo's
// SDK 57 bare template with Expo's own mod compiler; the Swift itself can only
// be compiled by an iOS build (EAS) and verified on an iPhone.
// Run: node tests/iosSenderPhotos.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const plugin = require(path.join(root, "plugins/withNotificationServiceExtension.js"));
const appJson = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8")).expo;
ok("plugin registered in app.json", appJson.plugins.includes("./plugins/withNotificationServiceExtension.js"));

delete process.env.P2P_IOS_SENDER_PHOTOS;
const prod = plugin({ name: "P2P", ios: { bundleIdentifier: "com.amentech.p2pglobaldiscipleshipnetwork" }, extra: { eas: { projectId: "p" } } });
const ext = prod.extra.eas.build.experimental.ios.appExtensions;
ok("EAS learns about the extension (so it can sign it)", ext.length === 1 && ext[0].targetName === "NotificationService" && ext[0].bundleIdentifier === "com.amentech.p2pglobaldiscipleshipnetwork.NotificationService");
ok("existing EAS settings kept", prod.extra.eas.projectId === "p");
const staging = plugin({ name: "P2P", ios: { bundleIdentifier: "com.amentech.p2pglobaldiscipleshipnetwork.staging" }, extra: {} });
ok("staging builds get a staging extension id", staging.extra.eas.build.experimental.ios.appExtensions[0].bundleIdentifier === "com.amentech.p2pglobaldiscipleshipnetwork.staging.NotificationService");
ok("plugin registers iOS mods", !!prod.mods?.ios);
process.env.P2P_IOS_SENDER_PHOTOS = "0";
const off = plugin({ name: "P2P", ios: { bundleIdentifier: "x" }, extra: {} });
ok("P2P_IOS_SENDER_PHOTOS=0 turns it off completely", !off.mods && !off.extra.eas);
delete process.env.P2P_IOS_SENDER_PHOTOS;

const swift = readFileSync(path.join(root, "plugins/notification-service/NotificationService.swift"), "utf8");
ok("reads the photo where Expo puts it (body._richContent.image)", /userInfo\["body"\]/.test(swift) && /"_richContent"/.test(swift) && /rich\["image"\]/.test(swift));
ok("https photos only", /url\.scheme == "https"/.test(swift));
ok("no photo → original notification", /contentHandler\(content\)\s*\n\s*return/.test(swift));
ok("timeout → best attempt delivered", /serviceExtensionTimeWillExpire/.test(swift) && /finish\(bestAttemptContent\)/.test(swift));
ok("communication style uses the server's title/body only (no added content)", /displayName: content\.title/.test(swift) && /content: content\.body/.test(swift) && !/\.body\s*=/.test(swift) && !/\.title\s*=/.test(swift));
ok("falls back to an image attachment", /UNNotificationAttachment\(identifier: "sender-photo"/.test(swift));
ok("size-limited download", /data\.count < 5_000_000/.test(swift));
const info = readFileSync(path.join(root, "plugins/notification-service/NotificationService-Info.plist"), "utf8");
ok("extension Info.plist: notification service extension point", /com\.apple\.usernotifications\.service/.test(info) && /\$\(PRODUCT_MODULE_NAME\)\.NotificationService/.test(info));
const src = readFileSync(path.join(root, "plugins/withNotificationServiceExtension.js"), "utf8");
ok("main app gets Communication Notifications + INSendMessageIntent", /com\.apple\.developer\.usernotifications\.communication/.test(src) && /INSendMessageIntent/.test(src));
ok("re-running prebuild never adds a second target", /if \(Object\.values\(targets\)\.some/.test(src));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
