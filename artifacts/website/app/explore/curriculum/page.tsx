import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import { KINGDOM_SCHOOL, PLAN_CATEGORIES, PEER_SESSION_FLOW } from "@/lib/content/curriculum";

export const metadata: Metadata = {
  title: "Curriculum",
  description: "A public preview of Kingdom School — the sequential discipleship path at the center of the P2P app.",
  alternates: { canonical: "/explore/curriculum" },
};

export default function CurriculumPage() {
  return (
    <>
      <PageHero
        eyebrow="Explore · Curriculum"
        title={<>Kingdom School — <em>one journey, three stages.</em></>}
        lede="Complete a category to unlock the next. This is a preview of the structure — not the authenticated learning system."
      />

      <section className="scene short" aria-labelledby="timeline-heading">
        <div className="scene-content">
          <h2 id="timeline-heading" className="visually-hidden">
            Kingdom School sequence
          </h2>
          <Reveal>
            <div className="timeline">
              {KINGDOM_SCHOOL.map((c, i) => (
                <div key={c.slug} className="timeline-item">
                  <div className="period">Stage {i + 1}</div>
                  <div>
                    <h3 className="serif" style={{ fontSize: 20, margin: "0 0 6px" }}>
                      {c.title}
                    </h3>
                    <p style={{ fontSize: 14, color: "var(--mist-dim)", margin: 0, maxWidth: 560 }}>
                      {c.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12.5, color: "var(--silver-dim)", fontStyle: "italic", marginTop: 18, maxWidth: 560 }}>
              Module-by-module and lesson-by-lesson detail for each stage isn&rsquo;t published here yet — this
              page shows the real, current structure of Kingdom School, not invented content standing in for it.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="flow-heading">
        <div className="scene-content">
          <h2 id="flow-heading" className="serif display-xl" style={{ fontSize: "clamp(22px,3vw,32px)" }}>
            Every lesson follows the same session.
          </h2>
          <Reveal>
            <ol style={{ margin: "20px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              {PEER_SESSION_FLOW.map((step, i) => (
                <li key={step} style={{ display: "flex", gap: 14, fontSize: 14.5, color: "#4c463a" }}>
                  <span style={{ fontFamily: "var(--font-fraunces)", fontStyle: "italic", color: "#8a6420" }}>
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      <section className="scene short" aria-labelledby="plans-heading">
        <div className="scene-content">
          <h2 id="plans-heading" className="eyebrow" style={{ fontSize: 12 }}>
            Plans — a topical library alongside Kingdom School
          </h2>
          <Reveal>
            <p className="lede">
              Not sequential like Kingdom School — an open library you browse and save, organized across ten life
              areas.
            </p>
            <div className="chip-row">
              {PLAN_CATEGORIES.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="cta-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <h2 id="cta-heading" className="serif display-xl" style={{ margin: "0 auto 20px", fontSize: "clamp(20px,2.8vw,28px)" }}>
            Understand the approach here. Experience the full curriculum in the app.
          </h2>
          <Reveal>
            <a href="/get-the-app" className="btn btn-primary">
              Experience the Full Curriculum
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
