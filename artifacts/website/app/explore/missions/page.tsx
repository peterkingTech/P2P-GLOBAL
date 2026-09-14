import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { PageHero } from "@/components/PageHero";
import { MissionCards } from "@/components/cards/Cards";
import { MISSION_FOCUS_AREAS, MISSION_STORIES } from "@/lib/content/missions";
import { GLOBAL_VISION_HAB214 } from "@/lib/content/p2p-foundation";

export const metadata: Metadata = {
  title: "Missions",
  description: "A global vision, organized by focus — from digital missions to the persecuted church.",
  alternates: { canonical: "/explore/missions" },
};

export default function MissionsPage() {
  return (
    <>
      <PageHero
        eyebrow="Explore · Missions"
        title={<>From your street to <em>the unreached.</em></>}
        lede="A vision, not a live activity map — every card stands for a calling, not a statistic."
        mediaId="P2P_MISSION_001"
      />

      <section className="scene short" aria-labelledby="scripture-heading">
        <div className="scene-content">
          <h2 id="scripture-heading" className="visually-hidden">
            Scripture
          </h2>
          <Reveal>
            <div className="scripture-panel">
              <p className="scripture-mark serif">&ldquo;{GLOBAL_VISION_HAB214.verse}&rdquo;</p>
              <p className="scripture-ref">{GLOBAL_VISION_HAB214.reference}</p>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--silver-dim)", marginTop: 16, maxWidth: 560 }}>
              {GLOBAL_VISION_HAB214.body}
            </p>
          </Reveal>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="focus-heading">
        <div className="scene-content">
          <h2 id="focus-heading" className="visually-hidden">
            Real focus areas
          </h2>
          <Reveal>
            <p className="serif display-xl" style={{ fontSize: "clamp(22px,3vw,32px)" }}>
              Real focus areas, not fabricated field reports.
            </p>
            <p className="lede" style={{ color: "#4c463a" }}>
              Mission stories and prayer points inside the app are organized around these focus areas. As real,
              verified stories are published, they&rsquo;ll appear here too — never invented in the meantime.
            </p>
            <div className="chip-row">
              {MISSION_FOCUS_AREAS.map((f) => (
                <span key={f} className="chip">
                  {f}
                </span>
              ))}
            </div>
            <p className="eyebrow" style={{ color: "#8a6420", marginTop: 28 }}>
              What a mission listing could look like
            </p>
            <MissionCards />
            {MISSION_STORIES.length === 0 && (
              <p style={{ fontSize: 12.5, color: "#6b6152", fontStyle: "italic", marginTop: 16 }}>
                No verified mission stories are published yet — real stories will appear here as they&rsquo;re
                confirmed, never invented in the meantime.
              </p>
            )}
          </Reveal>
        </div>
      </section>

      <section className="scene short" aria-labelledby="links-heading">
        <div className="scene-content">
          <h2 id="links-heading" className="visually-hidden">
            Related
          </h2>
          <Reveal>
            <div className="btn-row">
              <a href="/explore/stories" className="btn btn-secondary">
                Kingdom Stories
              </a>
              <a href="/explore/wins" className="btn btn-secondary">
                Kingdom Wins
              </a>
              <a href="/for-churches" className="btn btn-secondary">
                For Churches
              </a>
              <a href="/get-the-app" className="btn btn-primary">
                Get the App
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
