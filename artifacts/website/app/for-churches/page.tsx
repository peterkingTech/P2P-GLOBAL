import type { Metadata } from "next";
import { ParticleField } from "@/components/particles/ParticleField";
import { Reveal } from "@/components/Reveal";
import { MediaPlaceholder } from "@/components/media/MediaPlaceholder";

export const metadata: Metadata = {
  title: "For Churches",
  description: "P2P does not replace the local church. Completely free, always — cohorts, announcements, and Church Grove.",
  alternates: { canonical: "/for-churches" },
};

const FEATURES = [
  { title: "Cohorts", body: "The real small-group concept — tied to a curriculum module, with a leader and a clear start and end." },
  { title: "Announcements", body: "Pinned, typed, scheduled — reaching your congregation without a separate group text." },
  { title: "Shared Learning Goals", body: "See how your church is learning together, at the lesson, module, or curriculum level." },
  { title: "Church Grove", body: "A congregation-wide growth view — seeds to nations — with no individual ranking exposed." },
];

export default function ForChurchesPage() {
  return (
    <>
      <section className="scene short" aria-labelledby="churches-heading">
        <ParticleField distribution="cluster" />
        <div className="scene-content">
          <p className="eyebrow">For Churches</p>
          <h1 id="churches-heading" className="serif display-xl">
            P2P does not replace <em>the local church.</em>
          </h1>
          <p className="lede">It was never meant to. It exists to support the discipleship culture you already lead.</p>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="free-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <h2 id="free-heading" className="serif display-xl" style={{ margin: "0 auto", fontSize: "clamp(24px,4vw,40px)" }}>
            &ldquo;Completely free. Always.
            <br />
            No subscription. No payment. No catch.&rdquo;
          </h2>
        </div>
      </section>

      <section className="scene short" aria-labelledby="features-heading">
        <div className="scene-content">
          <h2 id="features-heading" className="visually-hidden">
            What the Church Portal offers
          </h2>
          <Reveal>
            <div className="card-grid">
              {FEATURES.map((f) => (
                <div key={f.title} className="p2p-card win" style={{ cursor: "default" }}>
                  <span className="cd-title serif">{f.title}</span>
                  <span className="cd-meta">{f.body}</span>
                </div>
              ))}
            </div>
            <div style={{ maxWidth: 420, marginTop: 24 }}>
              <MediaPlaceholder id="P2P_CHURCH_001" />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="cta-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <h2 id="cta-heading" className="serif display-xl" style={{ margin: "0 auto 20px", fontSize: "clamp(22px,3vw,32px)" }}>
            Bring your people into a <em>discipleship culture.</em>
          </h2>
          <Reveal>
            <a href="/get-the-app" className="btn btn-primary">
              Get the App
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
