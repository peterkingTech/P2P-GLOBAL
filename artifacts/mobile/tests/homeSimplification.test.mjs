// Tests for the simplified Home screen:
//  1. Home keeps only the welcome (greeting + Daily Word), the updates that
//     need the person (shown only when present) and one next step.
//  2. Every feature that left Home is still reachable from its own place:
//     Profile (My growth / My space / admin), Discover (My Community),
//     Learning (My Evaluations), Plans (Recommended for You), the Messages tab.
//  3. Native home-screen widgets are untouched (synced from the root layout).
// Run: node tests/homeSimplification.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const routeExists = (r) => [path.join(root, "app", `${r.slice(1)}.tsx`), path.join(root, "app", r.slice(1), "index.tsx")].some(existsSync);

const home = src("app/(tabs)/index.tsx");
const profile = src("app/(tabs)/profile.tsx");
const discover = src("components/more/DiscoverHome.tsx");
const learn = src("app/(tabs)/learn.tsx");

// 1. Home
ok("home: greeting + Daily Word kept", home.includes("<HomeHero") && home.includes("verse={dailyVerse}"));
ok("home: one next step (Continue Journey)", home.split("<ContinueJourneyCard").length === 2);
ok("home: essential updates kept, each only when present",
  home.includes("{pendingElijahCheckIn && (") && home.includes('router.push("/elijah-response" as any)')
  && home.includes("{pendingGuideAlertCount > 0 && (") && home.includes('router.push("/pastoral-alert" as any)')
  && home.includes("{showGuideInvitation && (") && home.includes('router.push("/connect/smart-match" as any)')
  && home.includes("{pendingEvaluations.length > 0 && ("));
for (const gone of ["<MyP2PDashboard", "<GetStartedCard", "<InviteEncouragementCard", "RecommendedCard", "UnreadMessagesCard",
  "GroveHomeCard", "RegisterChurchPromptCard", "MemberChurchCard", "JourneyTile", 'from "@/components/LivingTree"', "/plans/recommended",
  "getGroveData", "getAnnouncements"]) {
  ok(`home: ${gone} removed`, !home.includes(gone));
}

// Owner decision 2026-11-06: the growth stage is back on Home — the still of the stage's 3D model
// (growth milestone), the next milestone as requirement counts (never points), opening the Living Tree.
ok("home: growth-stage card back, showing the person's living 3D tree (real Meshy model of their milestone)", home.includes("{/* 2. Current growth stage") && home.includes('<LivingTreeView stageIndex={stageIndex} mode="tree" compact') && home.includes("useGrowthStage()"));
ok("home: growth card opens the Living Tree and the growth journey", home.includes('onPress={go("/living-tree")}') && home.includes('onPress={go("/stages")}'));
ok("home: next milestone shown as requirements met, never points", home.includes("requirements met for") && !home.includes("morePoints"));

// 2. Where each feature lives now
const growth = ["/stages", "/forest", "/living-tree", "/my-discipleship", "/relationships", "/lineage", "/progress"];
const space = ["/my-p2p", "/my-discipleship/journal", "/library", "/notes", "/highlights"];
for (const r of [...growth, ...space]) ok(`profile: ${r} reachable and the screen exists`, profile.includes(`route: "${r}"`) && routeExists(r));
ok("profile: My growth and My space sections", profile.includes(">My growth</Text>") && profile.includes(">My space</Text>"));
ok("profile: invite encouragement and How to use P2P moved here", profile.includes("<InviteEncouragementCard modulesCompleted={modulesCompleted} />") && profile.includes("<GetStartedCard />"));
ok("profile: every non-student role still has an admin entry",
  profile.includes('profile?.role === "peer_guide"') && profile.includes("ADMIN_ROLES.has(profile.role)")
  && profile.includes('profile.role !== "student" && profile.role !== "peer_guide" && !ADMIN_ROLES.has(profile.role)') && profile.includes('router.push("/admin/curriculum" as any)'));
ok("discover: My Community entry", discover.includes(">My Community</Text>") && discover.includes('router.push("/community" as any)'));
ok("plans: Recommended for You stays on the Plans screen, opened from Kingdom School", src("app/plans/index.tsx").includes("Recommended for You") && src("app/kingdom-school.tsx").includes('router.push("/plans?tab=find" as any)'));
ok("learning centre: still no Recommended for You (owner's earlier request)", !/Recommended for You|recommended/.test(learn));
ok("learning: My Evaluations tile", learn.includes("<LearningHub") && src("components/LearningHub.tsx").includes('route: "/evaluation"'));
ok("messages: unread count stays on the Messages tab", /tabBarBadge|unread/i.test(src("app/(tabs)/_layout.tsx")));

// 3. Native widgets untouched
ok("native widgets: still synced from the root layout", src("app/_layout.tsx").includes("WidgetSyncHost"));

console.log(`homeSimplification: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
