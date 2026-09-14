import type { MetadataRoute } from "next";

const BASE_URL = "https://p2pglobal.org";

const ROUTES = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/why-p2p", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/experience", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/explore", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/explore/stories", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/explore/missions", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/explore/wins", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/explore/curriculum", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/for-individuals", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/for-families", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/for-churches", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/about", priority: 0.5, changeFrequency: "yearly" as const },
  { path: "/faq", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/get-the-app", priority: 0.9, changeFrequency: "monthly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map((r) => ({
    url: `${BASE_URL}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
