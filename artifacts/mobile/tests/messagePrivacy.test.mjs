// Privacy reminder in every message composer (owner request 2026-11-11):
// "Do not enter sensitive personal information" — one shared, localised placeholder (lib/messagePrivacy).
// Source checks + the real locale files; screens need a device to render.
// Run: node tests/messagePrivacy.test.mjs
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const EXACT = "Do not enter sensitive personal information";

// ── One central definition, in the existing i18n ────────────────────────
const lib = src("lib/messagePrivacy.ts");
ok("central: key + exact English fallback", lib.includes('export const MESSAGE_PRIVACY_KEY = "messages.privacyPlaceholder";') && lib.includes(`export const MESSAGE_PRIVACY_TEXT = "${EXACT}";`));
ok("central: through react-i18next (no new translation mechanism)", lib.includes('import { useTranslation } from "react-i18next";') && lib.includes("t(MESSAGE_PRIVACY_KEY, { defaultValue: MESSAGE_PRIVACY_TEXT })"));
const en = JSON.parse(src("locales/en.json"));
ok("English: exact wording", en.messages.privacyPlaceholder === EXACT);
const locales = readdirSync(path.join(root, "locales")).filter((f) => f.endsWith(".json"));
const missing = locales.filter((f) => f !== "tw.json" && !JSON.parse(src(`locales/${f}`)).messages?.privacyPlaceholder);
ok("every language has it (Twi falls back to English)", missing.length === 0, missing.join(","));
const de = JSON.parse(src("locales/de.json")), fr = JSON.parse(src("locales/fr.json"));
ok("another language: translated, not English", de.messages.privacyPlaceholder === "Gib keine sensiblen persönlichen Daten ein" && fr.messages.privacyPlaceholder !== EXACT);
ok("only messages.privacyPlaceholder added — nothing else in the locales changed shape", locales.every((f) => { const j = JSON.parse(src(`locales/${f}`)); return !JSON.stringify(j).includes("privacyPlaceholder") || typeof j.messages?.privacyPlaceholder === "string"; }));

// ── Every message composer ──────────────────────────────────────────────
const COMPOSERS = {
  "app/messages/[id].tsx": "chats: one-to-one, group, Family, Church, communities and their groups, circles, peer groups",
  "app/mail/compose.tsx": "P2P Mail: new letter / forward note",
  "app/mail/[id].tsx": "P2P Mail: reply",
  "components/family/ChatPanel.tsx": "Gathering (Family) live chat",
  "app/call/church.tsx": "Church call chat",
  "app/study-together/[id].tsx": "Study Together: responses + new discussion questions",
  "components/study/StudyQuestionsTab.tsx": "study session discussion",
  "components/ComposeMessageModal.tsx": "new message (compose modal)",
  "app/admin/email-message/[messageId].tsx": "admin reply to a P2P Mail sender",
  "app/admin/help-mail/[helpRequestId].tsx": "official reply to a help request",
  "app/church/announcements.tsx": "church announcement",
  "app/church/settings/announcements.tsx": "church announcement (settings)",
  "components/PeerGuideRequestModal.tsx": "Peer Guide request note",
};
for (const [f, what] of Object.entries(COMPOSERS)) {
  const s = src(f);
  ok(`${what}: uses the shared reminder`, s.includes('import { useMessagePlaceholder } from "@/lib/messagePrivacy";') && s.includes("const privacyPlaceholder = useMessagePlaceholder();") && /placeholder=\{(composeAsNote \? "[^"]*" : )?privacyPlaceholder\}/.test(s), f);
  ok(`${what}: placeholder colour kept (legible in light and dark)`, /privacyPlaceholder\}[\s\S]{0,200}placeholderTextColor=/.test(s) || /placeholderTextColor=[\s\S]{0,40}\n?[^\n]*placeholder=\{privacyPlaceholder\}/.test(s), f);
}
ok("study together: both discussion inputs", (src("app/study-together/[id].tsx").match(/placeholder=\{privacyPlaceholder\}/g) ?? []).length === 2);
ok("admin note mode keeps its own hint (an internal note, not a message)", src("app/admin/email-message/[messageId].tsx").includes('placeholder={composeAsNote ? "Note visible to admins only..." : privacyPlaceholder}'));
ok("old message placeholders gone", !src("app/messages/[id].tsx").includes('placeholder="Message..."') && !src("components/family/ChatPanel.tsx").includes("Message the Gathering…") && !src("app/mail/[id].tsx").includes("Reply to “"));

// Owner, 2026-11-11: NOT in Contact P2P Global — people may need to describe their situation to the
// support, help or crisis team. It keeps its own hint.
const contact = src("app/messages/contact-p2p.tsx");
ok("Contact P2P Global: excluded, keeps 'Write your message here...'", !contact.includes("useMessagePlaceholder") && contact.includes('placeholder="Write your message here..."'));

// ── A reminder only: nothing else changes ───────────────────────────────
ok("it never inspects or blocks text (placeholder only)", !/onChangeText|send|validate|block/i.test(lib.replace(/\/\/.*$/gm, "")));
const unrelated = ["app/lesson/[id].tsx", "app/bible/search.tsx", "app/settings/account.tsx", "app/evaluation/[id].tsx", "app/learning/assignment/[assignmentId].tsx", "app/(tabs)/messages.tsx"];
ok("not used in lesson answers, search, profile/settings, assessments or the inbox search", unrelated.every((f) => !src(f).includes("useMessagePlaceholder")), unrelated.filter((f) => src(f).includes("useMessagePlaceholder")).join(","));
// Every file using it is a known composer (new composers must be added above).
const walk = (d, out = []) => { for (const e of readdirSync(path.join(root, d), { withFileTypes: true })) { const r = `${d}/${e.name}`; if (e.isDirectory()) { if (e.name !== "node_modules") walk(r, out); } else if (r.endsWith(".tsx") && src(r).includes("useMessagePlaceholder()")) out.push(r); } return out; };
const users = [...walk("app"), ...walk("components")];
ok("uses match the composer list exactly", users.sort().join() === Object.keys(COMPOSERS).sort().join(), users.join(","));

console.log(`messagePrivacy (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
