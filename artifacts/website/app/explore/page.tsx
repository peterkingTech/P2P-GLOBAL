import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Explore",
  description: "Kingdom Stories, Missions, Kingdom Wins, and Curriculum — a premium editorial gateway into the P2P world.",
  alternates: { canonical: "/explore" },
};

const CATEGORIES = [
  {
    href: "/explore/stories",
    title: "Kingdom Stories",
    body: "Editorial stories from the global church — revival, history, persecution, and the people God has used.",
  },
  {
    href: "/explore/missions",
    title: "Missions",
    body: "A global vision, organized by focus — from digital missions to the persecuted church.",
  },
  {
    href: "/explore/wins",
    title: "Kingdom Wins",
    body: "Personal testimonies shared with consent. One story encourages another.",
  },
  {
    href: "/explore/curriculum",
    title: "Curriculum",
    body: "A preview of Kingdom School — the discipleship path at the center of the app.",
  },
];

export default function ExplorePage() {
  return (
    <>
      <PageHero
        eyebrow="Explore"
        title={<>Story. Truth. Scripture. <em>People.</em></>}
        lede="A discovery gateway into P2P's public content — no likes, no follower counts, nothing to perform for."
      />
      <section className="scene light short" aria-labelledby="cats-heading">
        <div className="scene-content">
          <h2 id="cats-heading" className="visually-hidden">
            Categories
          </h2>
          <Reveal>
            <div className="card-grid">
              {CATEGORIES.map((c) => (
                <a key={c.href} href={c.href} className="p2p-card story">
                  <span className="cd-title serif" style={{ fontSize: 22 }}>
                    {c.title}
                  </span>
                  <span className="cd-meta" style={{ fontSize: 13.5 }}>
                    {c.body}
                  </span>
                </a>
              ))}
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
