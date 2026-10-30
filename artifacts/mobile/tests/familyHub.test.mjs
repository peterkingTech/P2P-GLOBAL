// Simplified Family Circle home + related wiring (source checks; screens
// need a device to render):
//   app/family/[familyId].tsx  — one state-driven primary action, a short
//     list instead of six equal header icons, nothing lost;
//   app/family/members.tsx + components/family/FamilyMemberList.tsx — calls
//     moved onto People rows through the existing call flow;
//   app/family/history.tsx — Highlights reachable;
//   label fixes; Messages "Family & Church" tab; church switcher.
// Run: node tests/familyHub.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const hub = src("app/family/[familyId].tsx");
// ── Primary action ───────────────────────────────────────────────────────
ok("primary action by state: live → Join, next lesson → Continue Learning, else Start", /const primary: "join" \| "continue" \| "start" = live \? "join" : next \? "continue" : "start";/.test(hub)
  && /primary === "join" \? "Join Gathering" : primary === "continue" \? "Continue Learning" : "Start Gathering"/.test(hub));
ok("Continue Learning opens the existing Study Workspace (lesson screen)", /pathname: "\/lesson\/\[id\]", params: \{ id: next\.nextLessonId \}/.test(hub) && /onPress=\{primary === "continue" \? openLesson : handleStartGathering\}/.test(hub));
ok("Start Gathering still offered beside Continue Learning", /\{primary === "continue" && \(\s*\n\s*<AppButton label="Start Gathering" onPress=\{handleStartGathering\} variant="secondary"/.test(hub));
ok("Gathering start/join logic unchanged (existing session joined, else started)", /if \(data\.activeSessionId\) \{\s*\n\s*router\.push\(\{ pathname: "\/family\/worship\/\[sessionId\]", params: \{ sessionId: data\.activeSessionId \} \}/.test(hub)
  && /const session = await startFamilyWorship\(data\.family\.id\);/.test(hub));
ok("live Gathering announced for screen readers", /A Gathering is happening now/.test(hub) && /accessibilityLiveRegion="polite"/.test(hub));

// ── No duplicate entry points; nothing lost ──────────────────────────────
ok("six equal header icons removed", !/headerIconBtn/.test(hub));
for (const [label, route] of [["Learning", "/learning/[scope]/[groupId]"], ["Prayer", "/family/prayer"], ["People", "/family/members"], ["History & highlights", "/family/history"]]) {
  const at = hub.indexOf(`label: "${label}"`);
  const row = at < 0 ? "" : hub.slice(at, hub.indexOf("\n    },", at));
  ok(`list row "${label}" → ${route}`, hub.includes(`label: "${label}"`) && (row.includes(`pathname: "${route}"`) || (route === "/family/members" && row.includes("onPress: openPeople"))), row.slice(0, 200));
}
ok("openPeople (People row + header) → /family/members", /const openPeople = \(\) => router\.push\(\{ pathname: "\/family\/members", params: \{ familyId \} \}/.test(hub));
ok("Family chat row only when the caller is in the family conversation", /\.\.\.\(data\.conversationId \? \[\{/.test(hub) && /pathname: "\/messages\/\[id\]", params: \{ id: data\.conversationId! \}/.test(hub));
ok("each destination linked once from the hub (no duplicate links)", ["/learning/[scope]/[groupId]", "/family/prayer", "/family/history"].every((r) => hub.split(`pathname: "${r}"`).length - 1 === 1)
  && hub.split('pathname: "/lesson/[id]"').length - 1 === 1);
ok("Calls and Highlights no longer hub icons — still reachable (People rows; History)", !/pathname: "\/family\/calls"/.test(hub) && !/pathname: "\/family\/journey"/.test(hub)
  && existsSync(path.join(root, "app/family/calls.tsx")) && existsSync(path.join(root, "app/family/journey.tsx")));
ok("Continue Study card only when the button isn't already Continue Learning", /\{live && next && \(/.test(hub));
ok("Last Gathering, Discipleship Journey, Leave kept", /Last Gathering/.test(hub) && /Discipleship Journey/.test(hub) && /Leave this Family Circle/.test(hub) && /\{!isShepherd && \(/.test(hub));
ok("real members' avatars (no placeholders invented)", /data\.members\.slice\(0, 5\)/.test(hub) && /<Avatar photoUrl=\{m\.avatarUrl\} name=\{m\.name\} size=\{30\} \/>/.test(hub));
ok("loading / not-a-member / error states kept", /<ActivityIndicator color=\{c\.primaryGreen\} \/>/.test(hub) && /You're not part of this Family Circle\./.test(hub) && /Couldn't load this Family Circle/.test(hub));
ok("touch targets ≥ 44pt on new controls", /<AppButton label=\{primary === "join"[^\n]*size="lg"/.test(hub) /* 52pt shared button */ && /<AppButton label="Start Gathering"/.test(hub) /* 44pt shared button */ && /listRow: \{[^}]*minHeight: 56/.test(hub) && /identityRow: \{[^}]*minHeight: 44/.test(hub));
ok("no Share in the hub's primary area", !/Share/.test(hub));

// ── Calls on People ─────────────────────────────────────────────────────
const people = src("app/family/members.tsx");
const list = src("components/family/FamilyMemberList.tsx");
ok("People: calls through the existing flow (startPeerCall → /call/audio|video)", /import \{ startPeerCall, buildCallRouteParams \} from "@\/lib\/callStart";/.test(people)
  && /pathname: callType === "video" \? "\/call\/video" : "\/call\/audio"/.test(people) && /onCall=\{handleCall\}/.test(people));
ok("People: one call at a time; button shows progress", /if \(!profile\?\.id \|\| callingUserId\) return;/.test(people) && /callingUserId === m\.userId \? \(/.test(list) && /disabled=\{!!callingUserId\}/.test(list));
ok("member list: voice + video buttons, never on your own row", /\{onCall && !isMe \? \(/.test(list) && /accessibilityLabel=\{`Voice call \$\{m\.name\}`\}/.test(list) && /accessibilityLabel=\{`Video call \$\{m\.name\}`\}/.test(list));
ok("member list: call props optional (other users unaffected)", /onCall\?: \(m: FamilyMember, callType: "audio" \| "video"\) => void;/.test(list));
ok("People keeps invitations, remove, profile", /handleInvite/.test(people) && /FamilyInvitePanel/.test(people) && /onRemove=\{handleRemoveMember\}/.test(people));

// ── History → Highlights ──────────────────────────────────────────────
const history = src("app/family/history.tsx");
ok("History links to Family Circle Highlights", /pathname: "\/family\/journey", params: \{ familyId \}/.test(history));

// ── Labels ───────────────────────────────────────────────────────────────
ok("prayer submit says 'Add request' (was a misleading 'Share')", /label="Add request"/.test(src("app/family/prayer.tsx")) && !/>Share<|label="Share"/.test(src("app/family/prayer.tsx"))
  && />Add request</.test(src("components/family/PrayerSpacePanel.tsx")) && !/>Share</.test(src("components/family/PrayerSpacePanel.tsx")));
ok("summary section is 'Discussion' (it's a message count)", /<Text style=\{styles\.sectionTitle\}>Discussion<\/Text>/.test(src("app/family/gathering-summary.tsx")));
ok("real sharing kept: Gathering room invite + family invite links/QR", /<ShareRoomPanel/.test(src("app/family/worship/[sessionId].tsx")) && /QrShareSheet/.test(src("components/family/FamilyInvitePanel.tsx")));

// ── Messages + Church ─────────────────────────────────────────────────
const inbox = src("app/(tabs)/messages.tsx");
ok("Messages: 'Family & Church' tab filters the two new conversation types", /\{ key: "family_church", label: "Family & Church" \}/.test(inbox)
  && /c\.conversationType === "family" \|\| c\.conversationType === "church"/.test(inbox) && /family_church: \{ title:/.test(inbox));
ok("ConversationType includes family + church", /"circle" \| "family" \| "church";/.test(src("contexts/DataContext.tsx")));
const ctx = src("contexts/DataContext.tsx"), church = src("app/church/index.tsx");
ok("church: all churches + conversation loaded from my-church", /setUserChurches\(Array\.isArray\(body\?\.churches\) \? body\.churches : \[\]\);/.test(ctx) && /setChurchConversationId\(body\?\.conversationId \?\? null\);/.test(ctx));
ok("church: switch via PUT /churches/current, then reload", /authedFetch\("\/churches\/current", \{\s*\n\s*method: "PUT"/.test(ctx) && /await loadUserChurch\(\);\s*\n\s*return null;/.test(ctx));
ok("church hub: switcher only with 2+ churches; Church chat only when in it", /\{userChurches\.length > 1 && \(/.test(church) && /\{churchConversationId && \(/.test(church));

// Child/teen safeguards: a refused message shows the reason, never the internal marker.
const thread = src("app/messages/[id].tsx"), safe = src("lib/safeguardMessage.ts");
ok("message thread: refusals shown in plain words (text + voice)", (thread.match(/readableSendError\(error\.message\)/g) ?? []).length === 2 && safe.includes('text.includes("P2P_MINOR_SAFEGUARD")'));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
