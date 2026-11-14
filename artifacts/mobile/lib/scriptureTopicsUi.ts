// Explore Scripture by Topic — grouping and search for the topic list (Bible Study). Pure; the data is the
// server's published topics (GET /prayer/topics), never a second copy. Category keys and their order match
// the editorial collection (artifacts/api-server/data/scripture-topics/index.json).
import type { PrayerTopic } from "@/lib/prayerTopicsApi";

export const TOPIC_CATEGORIES = ["knowing_god", "identity", "spiritual_life", "character", "relationships", "difficult_seasons", "discipleship", "work_society", "hope"] as const;
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number] | "other";

/** Lower-case, accents and punctuation removed — "God's Will" and "gods will" match. */
export const normalise = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Topics matching the query (by title, description or category name), keeping the server's order. */
export function searchTopics(topics: PrayerTopic[], query: string, categoryName: (key: string) => string = (k) => k): PrayerTopic[] {
  const q = normalise(query);
  if (!q) return topics;
  const words = q.split(" ");
  return topics.filter((t) => {
    const hay = normalise(`${t.title} ${t.description ?? ""} ${t.category ? categoryName(t.category) : ""}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Topics grouped by category in the editorial order; unknown or missing categories go to "other", last. */
export function groupTopics(topics: PrayerTopic[]): { category: TopicCategory; topics: PrayerTopic[] }[] {
  const known = new Set<string>(TOPIC_CATEGORIES);
  const groups: { category: TopicCategory; topics: PrayerTopic[] }[] = [];
  for (const c of [...TOPIC_CATEGORIES, "other" as const]) {
    const list = topics.filter((t) => (t.category && known.has(t.category) ? t.category : "other") === c);
    if (list.length) groups.push({ category: c, topics: list });
  }
  return groups;
}

/** A stable translation key for a topic title ("Fear & Anxiety" → "fear-anxiety"); the server title is the fallback. */
export const topicKey = (title: string) => title.toLowerCase().replace(/&/g, " ").replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
