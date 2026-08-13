import { Share } from "react-native";

// The app's real registered scheme (app.json "scheme") and Android package —
// deep links use these, not invented placeholders. expo-router maps
// `<scheme>://plan/abc` straight to app/plan/[id].tsx with no extra native
// config beyond the scheme already being set in app.json.
const APP_SCHEME = "p2pglobalbiblestudy";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.amentech.p2pglobalbiblestudy";

// Raw custom-scheme links (p2pglobalbiblestudy://...) aren't reliably
// clickable inside chat apps, so shared messages point at an HTTPS landing
// page (web/share-landing.html) that redirects into the app if installed,
// or to the Play Store if not.
//
// This is the real, deterministic GitHub Pages URL for this repo
// (https://<owner>.github.io/<repo>/<path>) — it is NOT live yet. GitHub
// Pages has to be enabled for peterkingTech/P2P-GLOBAL (Settings > Pages)
// and web/share-landing.html deployed to the branch/folder Pages serves
// from before this URL actually resolves. See web/share-landing.html for
// the file to deploy.
const SHARE_LANDING_BASE_URL = "https://peterkingtech.github.io/P2P-GLOBAL";

function buildWebShareUrl(params: { type: "lesson" | "plan" | "category" | "profile"; title: string; desc: string; deepLink: string }): string {
  const q = new URLSearchParams({
    type: params.type,
    title: params.title,
    desc: params.desc,
    link: params.deepLink,
  });
  return `${SHARE_LANDING_BASE_URL}/share-landing.html?${q.toString()}`;
}

export async function shareLesson(lesson: { id: string; title: string; moduleTitle?: string | null; planTitle?: string | null }, sharedByUsername?: string | null) {
  const deepLink = `${APP_SCHEME}://lesson/${lesson.id}`;
  const desc = [lesson.moduleTitle, lesson.planTitle].filter(Boolean).join(" · ");
  const webUrl = buildWebShareUrl({ type: "lesson", title: lesson.title, desc, deepLink });
  const byLine = sharedByUsername ? `Shared by @${sharedByUsername}\n\n` : "";

  await Share.share({
    title: lesson.title,
    message: `📖 "${lesson.title}"${desc ? ` — ${desc}` : ""}\n${byLine}\nI'm studying this on P2P Global Bible Study Network. Join me:\n${webUrl}`,
  });
}

export async function sharePlan(plan: { id: string; title: string; categoryTitle?: string | null }, sharedByUsername?: string | null) {
  const deepLink = `${APP_SCHEME}://plan/${plan.id}`;
  const webUrl = buildWebShareUrl({ type: "plan", title: plan.title, desc: plan.categoryTitle ?? "", deepLink });
  const byLine = sharedByUsername ? `@${sharedByUsername} thinks you should study this.\n\n` : "";

  await Share.share({
    title: plan.title,
    message: `🎯 "${plan.title}"${plan.categoryTitle ? ` — ${plan.categoryTitle}` : ""}\n${byLine}\nJoin me on this discipleship plan on P2P Global:\n${webUrl}`,
  });
}

// Public @username profile — see profile/[username].tsx's "Share Profile" menu item.
export async function shareProfile(username: string) {
  const deepLink = `${APP_SCHEME}://profile/${username}`;
  const webUrl = buildWebShareUrl({ type: "profile", title: `@${username}`, desc: "", deepLink });

  await Share.share({
    title: `@${username} on P2P Global`,
    message: `Connect with @${username} on P2P Global Bible Study Network:\n${webUrl}`,
  });
}

export async function shareCategory(category: { id: string; title: string; planCount?: number }) {
  const deepLink = `${APP_SCHEME}://plans/category/${category.id}`;
  const desc = category.planCount != null ? `${category.planCount} plan${category.planCount === 1 ? "" : "s"}` : "";
  const webUrl = buildWebShareUrl({ type: "category", title: category.title, desc, deepLink });

  await Share.share({
    title: category.title,
    message: `📚 "${category.title}"${desc ? ` — ${desc}` : ""}\n\nExplore these discipleship plans on P2P Global:\n${webUrl}`,
  });
}

export async function shareApp() {
  await Share.share({
    title: "P2P Global Bible Study Network",
    message: `🌳 P2P Global — a peer-to-peer Bible discipleship network.\n\nGo through the Kingdom School curriculum with a personal peer guide. Connect with believers worldwide.\n\nDownload free: ${PLAY_STORE_URL}`,
  });
}