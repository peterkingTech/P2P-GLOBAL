import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import { MediaPlaceholder } from "@/components/media/MediaPlaceholder";

export const metadata: Metadata = {
  title: "For Individuals",
  description: "What P2P means for you — learning, growing, helping, and multiplying, one relationship at a time.",
  alternates: { canonical: "/for-individuals" },
};

const JOURNEY = [
  { label: "I am learning.", body: "From someone a step ahead — through Kingdom School, through a Peer Guide, through Scripture itself." },
  { label: "I am growing.", body: "Character before credentials. Growth that shows up in how you live, not just what you know." },
  { label: "I am helping.", body: "You don't need a title to encourage someone. Everyone can help someone grow." },
  { label: "I am multiplying.", body: "One day, someone will say the same four lines because of you." },
];

export default function ForIndividualsPage() {
  return (
    <>
      <PageHero
        eyebrow="For Individuals"
        title={<>What does P2P mean <em>for you?</em></>}
        lede="Not a feature list. A journey — the same one every disciple walks."
      />
      <section className="scene short" aria-labelledby="portrait-heading">
        <div className="scene-content">
          <h2 id="portrait-heading" className="visually-hidden">
            A person on this journey
          </h2>
          <Reveal>
            <div style={{ maxWidth: 340 }}>
              <MediaPlaceholder id="P2P_INDIVIDUAL_001" />
            </div>
          </Reveal>
        </div>
      </section>
      <section className="scene short" aria-labelledby="journey-heading">
        <div className="scene-content">
          <h2 id="journey-heading" className="visually-hidden">
            Your journey
          </h2>
          <div className="journey-steps">
            {JOURNEY.map((j) => (
              <Reveal key={j.label}>
                <div className="journey-step">
                  <div>
                    <span className="jstep-label serif">{j.label}</span>
                    <p style={{ margin: 0, fontSize: 14, color: "var(--mist-dim)" }}>{j.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      <section className="scene light short" aria-labelledby="cta-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <h2 id="cta-heading" className="serif display-xl" style={{ margin: "0 auto 20px", fontSize: "clamp(22px,3vw,32px)" }}>
            Already part of a church? <em>Bring them with you.</em>
          </h2>
          <Reveal>
            <div className="btn-row" style={{ justifyContent: "center" }}>
              <a href="/for-churches" className="btn btn-secondary">
                For Churches
              </a>
              <a href="/get-the-app" className="btn btn-primary">
                Experience P2P
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
