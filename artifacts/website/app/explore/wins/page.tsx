import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import { WinCardDemo } from "@/components/cards/Cards";
import { KINGDOM_WINS, KINGDOM_WINS_EMPTY_STATE } from "@/lib/content/testimonies";

export const metadata: Metadata = {
  title: "Kingdom Wins",
  description: "Personal testimonies shared with consent. One story encourages another, and another person grows.",
  alternates: { canonical: "/explore/wins" },
};

const GUIDED_STEPS = KINGDOM_WINS[0]?.guidedSteps ?? [];

export default function WinsPage() {
  return (
    <>
      <PageHero
        eyebrow="Explore · Kingdom Wins"
        title={<>One story encourages another. <em>Another person grows.</em></>}
        lede="A Kingdom Win is a peer-authored testimony, shared with explicit consent — never for personal recognition."
      />

      <section className="scene short" aria-labelledby="structure-heading">
        <div className="scene-content">
          <h2 id="structure-heading" className="eyebrow" style={{ fontSize: 12 }}>
            How a Kingdom Win comes together
          </h2>
          <Reveal>
            <div className="chip-row">
              {GUIDED_STEPS.map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
            </div>
            <p className="lede" style={{ marginTop: 8 }}>
              A guided flow, not a blank text box — every submission is reviewed before it&rsquo;s shared with the
              wider P2P community, with the author&rsquo;s explicit consent required at every step.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="example-heading">
        <div className="scene-content">
          <h2 id="example-heading" className="visually-hidden">
            Example
          </h2>
          <Reveal>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {KINGDOM_WINS.map((win) => (
                <WinCardDemo key={win.id} quote={win.quote} attribution="Illustrative example — not a submitted story" />
              ))}
            </div>
            <p style={{ fontSize: 12.5, color: "#6b6152", marginTop: 16, maxWidth: 480 }}>{KINGDOM_WINS_EMPTY_STATE}</p>
          </Reveal>
        </div>
      </section>

      <section className="scene short" aria-labelledby="chain-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <h2 id="chain-heading" className="serif display-xl" style={{ margin: "0 auto 24px", fontSize: "clamp(22px,3.4vw,34px)" }}>
            One story
            <br />
            <em>→ encourages another</em>
            <br />
            → another person grows
            <br />
            → another person helps someone else.
          </h2>
          <Reveal>
            <p className="consent-note" style={{ margin: "0 auto" }}>
              No likes. No followers. No ranking. Just story, faith, growth, and obedience.
            </p>
            <a href="/get-the-app" className="btn btn-primary" style={{ marginTop: 24 }}>
              Share your story in the app
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
