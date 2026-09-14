import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import {
  WHAT_IS_P2P,
  WHY_P2P_EXISTS,
  WHY_PEER_TO_PEER,
  WHAT_IS_DISCIPLESHIP,
} from "@/lib/content/p2p-foundation";
import { WHAT_P2P_IS_NOT, WHAT_P2P_IS_NOT_HEADLINE } from "@/lib/content/p2p-not";

export const metadata: Metadata = {
  title: "Why P2P",
  description:
    "What P2P is, why it exists, and why peer-to-peer — without pretending teaching doesn't matter, and without claiming to replace the local church.",
  alternates: { canonical: "/why-p2p" },
};

export default function WhyP2PPage() {
  return (
    <>
      <PageHero
        eyebrow="Why P2P"
        title={
          <>
            Everyone who learns something true <em>becomes qualified to share it.</em>
          </>
        }
        lede="Not a degree. Not a pulpit. Not permission. Just Christ, His Word, and a willing heart."
      />

      {/* What is P2P */}
      <section className="scene light short" aria-labelledby="what-is-heading">
        <div className="scene-content prose">
          <Reveal>
            <h2 id="what-is-heading" className="serif display-xl" style={{ fontSize: "clamp(22px,3.2vw,34px)" }}>
              {WHAT_IS_P2P.headline}
            </h2>
            <p className="lede" style={{ color: "#4c463a" }}>{WHAT_IS_P2P.core}</p>
            <ul style={{ margin: "0 0 16px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {WHAT_IS_P2P.isNot.map((line) => (
                <li key={line} style={{ fontSize: 14.5, color: "#6b6152" }}>
                  {line}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 16, color: "#0b1613", fontWeight: 600 }}>{WHAT_IS_P2P.is}</p>
          </Reveal>
        </div>
      </section>

      {/* Why P2P exists */}
      <section className="scene short" aria-labelledby="why-exists-heading">
        <div className="scene-content prose">
          <Reveal>
            <h2 id="why-exists-heading" className="serif display-xl" style={{ fontSize: "clamp(22px,3.2vw,34px)" }}>
              {WHY_P2P_EXISTS.headline}
            </h2>
            {WHY_P2P_EXISTS.body.map((p) => (
              <p key={p} style={{ fontSize: 14.5, maxWidth: 620 }}>
                {p}
              </p>
            ))}
          </Reveal>
        </div>
      </section>

      {/* Why peer-to-peer — the morph diagram */}
      <section className="scene short" aria-labelledby="morph-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <h2 id="morph-heading" className="visually-hidden">
            From hierarchy to mutuality
          </h2>
          <Reveal>
            <div className="morph-wrap done">
              <div className="morph-figure" />
              <span className="morph-arrow" aria-hidden="true">
                ⇄
              </span>
              <div className="morph-figure" />
            </div>
            <p className="serif display-xl" style={{ margin: "32px auto 0", fontSize: "clamp(22px,3.2vw,34px)" }}>
              {WHY_PEER_TO_PEER.shift.from} <em>becomes</em> {WHY_PEER_TO_PEER.shift.to}
            </p>
            <p className="lede" style={{ margin: "16px auto 8px" }}>{WHY_PEER_TO_PEER.teachingStillMatters}</p>
            <p className="lede" style={{ margin: "0 auto" }}>{WHY_PEER_TO_PEER.clarification}</p>
          </Reveal>
        </div>
      </section>

      {/* Discipleship, is/is-not, generational chain */}
      <section className="scene light short" aria-labelledby="discipleship-heading">
        <div className="scene-content prose">
          <Reveal>
            <h2 id="discipleship-heading" className="serif display-xl" style={{ fontSize: "clamp(22px,3vw,32px)" }}>
              {WHAT_IS_DISCIPLESHIP.headline}
            </h2>
            <p style={{ fontSize: 13, color: "#6b6152", marginBottom: 4 }}>Discipleship is not merely:</p>
            <p style={{ fontSize: 14, color: "#6b6152", marginBottom: 16 }}>{WHAT_IS_DISCIPLESHIP.isNot.join(" · ")}</p>
            <p style={{ fontSize: 13, color: "#6b6152", marginBottom: 4 }}>It includes:</p>
            <p style={{ fontSize: 14, color: "#4c463a", marginBottom: 20 }}>{WHAT_IS_DISCIPLESHIP.is.join(" · ")}</p>
            <p className="serif" style={{ fontStyle: "italic", fontSize: 20, color: "#0b1613" }}>
              {WHAT_IS_DISCIPLESHIP.statement}
            </p>
            <p style={{ fontSize: 14.5, color: "#4c463a", marginTop: 16, maxWidth: 620 }}>
              Disciple → disciple → disciple → generations. When one person disciples another, the impact doubles —{" "}
              <em>2 Timothy 2:2.</em>
            </p>
          </Reveal>
        </div>
      </section>

      {/* Peer Guide guardrail */}
      <section className="scene short" aria-labelledby="guardrail-heading">
        <div className="scene-content prose">
          <h2 id="guardrail-heading" className="visually-hidden">
            What peer-to-peer does not mean
          </h2>
          <Reveal>
            <div className="scripture-panel">
              <p className="scripture-mark serif">
                &ldquo;A Peer Guide is not a pastor, expert, or authority figure — a fellow traveler who walked
                this path a little earlier.&rdquo;
              </p>
            </div>
            <p style={{ marginTop: 24, fontSize: 14.5, maxWidth: 620 }}>
              Peer-to-peer discipleship does not eliminate spiritual leadership, and P2P is not a replacement for
              the local church. It is a way for ordinary believers to walk the path together — always under
              Scripture, always guided by the Spirit, always pointing back to the church God has already placed
              each person in.
            </p>
          </Reveal>
        </div>
      </section>

      {/* What P2P is not */}
      <section className="scene light short" aria-labelledby="not-heading">
        <div className="scene-content">
          <Reveal>
            <h2 id="not-heading" className="serif display-xl" style={{ fontSize: "clamp(20px,2.8vw,28px)" }}>
              What P2P is not.
            </h2>
            <ul style={{ margin: "20px 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              {WHAT_P2P_IS_NOT.map((line) => (
                <li key={line} style={{ fontSize: 15, color: "#4c463a", fontWeight: 500 }}>
                  {line}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 13.5, color: "#6b6152", fontStyle: "italic" }}>{WHAT_P2P_IS_NOT_HEADLINE}</p>
          </Reveal>
        </div>
      </section>

      <section className="scene short" aria-labelledby="close-heading">
        <div className="scene-content">
          <h2 id="close-heading" className="visually-hidden">
            Continue
          </h2>
          <Reveal>
            <a href="/how-it-works" className="btn btn-ghost" style={{ marginTop: 8 }}>
              How P2P works →
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
