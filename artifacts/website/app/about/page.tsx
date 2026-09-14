import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import {
  WHAT_IS_P2P,
  WHY_P2P_EXISTS,
  JESUS_CENTER,
  SCRIPTURE_FOUNDATION,
  HOLY_SPIRIT_GUIDE,
  PEOPLE_HELP_PEOPLE,
  LOCAL_CHURCH,
  P2P_AND_AI,
  MULTIPLICATION_2TIM2,
  GLOBAL_VISION_HAB214,
  HUMILITY_STATEMENT,
} from "@/lib/content/p2p-foundation";

export const metadata: Metadata = {
  title: "About",
  description: "The vision and philosophy behind P2P Global Discipleship Network — not our work, His work.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title={<>Not our work. <em>His work.</em></>}
        lede={WHAT_IS_P2P.core}
      />

      {/* Who we are / why we exist */}
      <section className="scene light short" aria-labelledby="who-heading">
        <div className="scene-content prose">
          <Reveal>
            <h2 id="who-heading" className="serif display-xl" style={{ fontSize: "clamp(20px,2.8vw,28px)" }}>
              {WHY_P2P_EXISTS.headline}
            </h2>
            {WHY_P2P_EXISTS.body.map((p) => (
              <p key={p} style={{ fontSize: 14.5, color: "#4c463a", maxWidth: 620 }}>
                {p}
              </p>
            ))}
          </Reveal>
        </div>
      </section>

      {/* Foundation: Jesus, Scripture, Holy Spirit, People, Church */}
      <section className="scene short" aria-labelledby="foundation-heading">
        <div className="scene-content prose">
          <h2 id="foundation-heading" className="eyebrow" style={{ fontSize: 12 }}>
            Foundation
          </h2>
          <Reveal>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {[JESUS_CENTER, SCRIPTURE_FOUNDATION, HOLY_SPIRIT_GUIDE, PEOPLE_HELP_PEOPLE, LOCAL_CHURCH].map((f) => (
                <div key={f.headline}>
                  <p className="serif" style={{ fontStyle: "italic", fontSize: 19, color: "var(--ember-bright)", margin: "0 0 6px" }}>
                    {f.headline}
                  </p>
                  <p style={{ fontSize: 14, color: "var(--mist-dim)", margin: 0, maxWidth: 600 }}>{f.body}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Technology & P2P + AI */}
      <section className="scene light short" aria-labelledby="tech-heading">
        <div className="scene-content prose">
          <Reveal>
            <h2 id="tech-heading" className="serif display-xl" style={{ fontSize: "clamp(20px,2.8vw,28px)" }}>
              {P2P_AND_AI.headline}
            </h2>
            <p style={{ fontSize: 14.5, color: "#4c463a", maxWidth: 620 }}>
              Technology in P2P facilitates {P2P_AND_AI.facilitates.join(", ").toLowerCase()}. It does not replace{" "}
              {P2P_AND_AI.doesNotReplace.join(", ")}.
            </p>
            <p className="serif" style={{ fontStyle: "italic", fontSize: 18, color: "#0b1613" }}>
              &ldquo;{P2P_AND_AI.statement}&rdquo;
            </p>
          </Reveal>
        </div>
      </section>

      {/* Multiplication + Global vision */}
      <section className="scene short" aria-labelledby="scripture-heading">
        <div className="scene-content">
          <h2 id="scripture-heading" className="visually-hidden">
            Core Scriptures
          </h2>
          <Reveal>
            <div className="scripture-panel">
              <p className="scripture-mark serif">&ldquo;{MULTIPLICATION_2TIM2.verse}&rdquo;</p>
              <p className="scripture-ref">{MULTIPLICATION_2TIM2.reference}</p>
            </div>
            <div className="scripture-panel" style={{ marginTop: 1 }}>
              <p className="scripture-mark serif">&ldquo;{GLOBAL_VISION_HAB214.verse}&rdquo;</p>
              <p className="scripture-ref">{GLOBAL_VISION_HAB214.reference}</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Philosophy */}
      <section className="scene light short" aria-labelledby="philosophy-heading">
        <div className="scene-content prose">
          <Reveal>
            <h2 id="philosophy-heading" className="serif display-xl" style={{ fontSize: "clamp(22px,3.4vw,36px)" }}>
              Everyone is learning from someone.
              <br />
              <em>Everyone can help someone grow.</em>
            </h2>
            <p style={{ fontSize: 15, color: "#4c463a", maxWidth: 620 }}>
              This is how the early church multiplied — not through institutions, but through relationships. Jesus
              himself did not write a book. He invested in twelve. Those twelve turned the world upside down. P2P
              follows the same pattern: ordinary people, walking together, passing on what they have received.
            </p>
            <p style={{ fontSize: 13.5, color: "#6b6152", maxWidth: 620 }}>
              This is still an early, growing work — the vision is bigger than what exists today, and we&rsquo;d
              rather say that plainly than overstate where things stand.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Humility close */}
      <section className="scene short" aria-labelledby="close-heading" style={{ textAlign: "center" }}>
        <div className="scene-content">
          <Reveal>
            <h2 id="close-heading" className="serif display-xl" style={{ margin: "0 auto", fontSize: "clamp(22px,3.4vw,34px)" }}>
              {HUMILITY_STATEMENT.lines[0]} <em>{HUMILITY_STATEMENT.lines[1]}</em>
              <br />
              {HUMILITY_STATEMENT.lines[2]} <em>{HUMILITY_STATEMENT.lines[3]}</em>
            </h2>
            <a href="/why-p2p" className="btn btn-ghost" style={{ marginTop: 24 }}>
              Why P2P →
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
