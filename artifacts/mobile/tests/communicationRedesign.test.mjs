// Communication redesign (source checks; screens need a device to render):
//   Messages tab — three spaces (Chats | P2P Mail | Groups) with their own unread badges;
//   P2P Mail — formal letters in app/mail/*, never mixed into a chat timeline;
//   Groups — private groups and Communities in app/groups/*, plus existing Family/Church/Circle/Peer chats;
//   notification taps route to the right place; nothing existing removed.
// Run: node tests/communicationRedesign.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

// ── Messages tab ─────────────────────────────────────────────────────────
const tab = src("app/(tabs)/messages.tsx");
ok("three sections: Chats, P2P Mail, Groups", /key: "chats", label: "Chats"/.test(tab) && /key: "mail", label: "P2P Mail"/.test(tab) && /key: "groups", label: "Groups"/.test(tab));
ok("each section has its own unread badge", /chats: chats\.filter\(\(c\) => c\.unreadCount > 0\)\.length/.test(tab) && /mail: mailUnreadCount/.test(tab) && /groups: groups\.filter\(\(c\) => c\.unreadCount > 0\)\.length/.test(tab));
ok("mail badge comes from /mail/unread and MailHome's inbox", /mailUnread\(\)\.then\(\(r\) => setMailUnreadCount\(r\.unreadThreads\)\)/.test(tab) && /onUnreadChange=\{setMailUnreadCount\}/.test(tab));
ok("Chats lists one-to-one conversations only (not official ones)", /const chats = useMemo\(\(\) => conversations\.filter\(\(c\) => c\.type !== "group" && !c\.otherUserOfficialType\)/.test(tab) && /let rows = chats;/.test(tab));
// 2026-11-10 (owner): official P2P conversations are found in P2P Mail, with their unread counted on its badge.
ok("official P2P chats listed in P2P Mail, counted on its badge", /const officialChats = useMemo\(\(\) => conversations\.filter\(\(c\) => c\.type !== "group" && !!c\.otherUserOfficialType\)/.test(tab)
  && /mail: mailUnreadCount \+ officialChats\.filter\(\(c\) => c\.unreadCount > 0\)\.length/.test(tab)
  && tab.indexOf("officialChats.map(") > tab.indexOf('{section === "mail" ? (<>') && tab.indexOf("officialChats.map(") < tab.indexOf("<MailHome"));
const ghIcons = src("components/messages/GroupsHome.tsx");
ok("Church shows a church icon, Family a family icon", ghIcons.includes('MaterialCommunityIcons name="church"') && ghIcons.includes('MaterialCommunityIcons name="human-male-female-child"')
  && (ghIcons.match(/<GroupKindIcon /g) ?? []).length === 2);
ok("Chats keeps All / Unread / Favourites", /key: "all", label: "All"/.test(tab) && /key: "unread", label: "Unread"/.test(tab) && /key: "favourites", label: "Favourites"/.test(tab));
ok("Chats keeps requests, pins and favourites", tab.includes('"/connections/requests"') && /pinConversation\(item\.id\)/.test(tab) && /addToFavourites\(item\.id\)/.test(tab));
// 2026-11-10 (owner): Contact P2P Global moved into P2P Mail — same screens, above the mail folders.
const mailStart = tab.indexOf('{section === "mail" ? (<>'), mailEnd = tab.indexOf("<MailHome", mailStart), chatsStart = tab.indexOf('{section === "chats" ? (<>');
ok("Contact P2P Global + My Messages to P2P Global sit in P2P Mail, above the folders", mailStart > 0 && mailEnd > mailStart
  && tab.slice(mailStart, mailEnd).includes('"/messages/contact-p2p"') && tab.slice(mailStart, mailEnd).includes('"/messages/my-contact-messages"'));
ok("…and are no longer in Chats (shown once)", (tab.match(/"\/messages\/contact-p2p"/g) ?? []).length === 1 && !tab.slice(chatsStart).includes('"/messages/contact-p2p"'));
ok("call history button kept", tab.includes('"/call/history"'));
ok("?section= opens a section (used by notifications and the join screen)", /params\.section === "mail" \|\| params\.section === "groups"/.test(tab));
ok("sections are accessible tabs", /accessibilityRole="tablist"/.test(tab) && /accessibilityRole="tab" accessibilityState=\{\{ selected: active \}\}/.test(tab));

// ── P2P Mail ─────────────────────────────────────────────────────────────
for (const f of ["app/mail/index.tsx", "app/mail/[id].tsx", "app/mail/compose.tsx", "components/messages/MailHome.tsx", "lib/mailApi.ts"]) ok(`exists: ${f}`, existsSync(path.join(root, f)));
const mailApi = src("lib/mailApi.ts");
ok("mail goes through the API (/mail), never the chat tables", !/p2p_messages|p2p_conversations/.test(mailApi) && /apiRequest|apiFetch/.test(mailApi));
const thread = src("app/messages/[id].tsx");
ok("chat header: P2P Mail with this person (separate from the chat)", /pathname: "\/mail", params: \{ with: otherUserId, name: title \}/.test(thread));
ok("chat header: group info for private groups only", /isPrivateGroup && \(/.test(thread) && /router\.push\(`\/groups\/\$\{id\}`/.test(thread));
ok("calls unchanged in the chat header", /initiateCall\("audio"\)/.test(thread) && /initiateCall\("video"\)/.test(thread));

// ── Groups ───────────────────────────────────────────────────────────────
for (const f of ["app/groups/create.tsx", "app/groups/[id].tsx", "app/groups/community/[id].tsx", "app/groups/invitations.tsx", "app/groups/join.tsx", "components/messages/GroupsHome.tsx", "lib/groupsApi.ts"]) ok(`exists: ${f}`, existsSync(path.join(root, f)));
const gh = src("components/messages/GroupsHome.tsx");
ok("existing group chats always listed, even if /groups is unavailable", /const fromChats: MyGroup\[\]/.test(gh) && /\[\.\.\.\(data\?\.groups \?\? \[\]\), \.\.\.fromChats\]/.test(gh));
ok("Groups filters keep Family & Church, Peer Groups, Circles", /label: "Family & Church"/.test(gh) && /label: "Peer Groups"/.test(gh) && /label: "Circles"/.test(gh));
ok("Family/Church communities open their existing screens", gh.includes("router.push(`/family/${cm.id}`") && gh.includes('router.push("/church"'));
ok("new groups and communities are private (copy says so)", /Private\. Only the people in it can see it/.test(src("app/groups/create.tsx")));
const join = src("app/groups/join.tsx");
ok("invite links are validated on the server (join screen just posts the token)", /joinWithLink\(String\(t\)\)/.test(join) && /status === "requested"/.test(join));
const inv = src("app/groups/invitations.tsx");
ok("invitations: nothing joined until accepted", /answerInvitation\(inv\.id, accept\)/.test(inv) && /label="Decline"/.test(inv) && /label="Accept"/.test(inv));
const comm = src("app/groups/community/[id].tsx");
ok("community: membership doesn't open every group", /Belonging to the community doesn't give access to every group/.test(comm));
ok("community: leaving uses 'me' (server resolves the caller)", /removeCommunityMember\(d\.id, "me"\)/.test(comm));

// ── Notifications ────────────────────────────────────────────────────────
const push = src("lib/push.ts");
ok("mail notifications open the letter", /notificationType === "p2p_mail" \|\| notificationType === "official_mail"/.test(push) && /`\/mail\/\$\{threadId\}`/.test(push));
ok("group_added opens the group chat", /notificationType === "group_added"/.test(push));
ok("invitations open the invitations screen", /notificationType === "group_invitation" \|\| notificationType === "community_invitation"\) return "\/groups\/invitations"/.test(push));
ok("community_added opens the community", /`\/groups\/community\/\$\{cid\}`/.test(push));
ok("ids checked before routing", /const uuidOf = \(v: unknown\)/.test(push));

// ── Routes ───────────────────────────────────────────────────────────────
const layout = src("app/_layout.tsx");
for (const r of ["mail/index", "mail/[id]", "mail/compose", "groups/create", "groups/[id]", "groups/community/[id]", "groups/invitations", "groups/join"]) ok(`own header: ${r}`, layout.includes(`"${r}"`));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
