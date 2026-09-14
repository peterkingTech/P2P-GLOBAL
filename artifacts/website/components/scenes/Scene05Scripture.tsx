import { Reveal } from "@/components/Reveal";
import { DemoPhoto } from "@/components/media/DemoPhoto";
import { SCRIPTURE_FOUNDATION } from "@/lib/content/p2p-foundation";

export function Scene05Scripture() {
  return (
    <section className="scene light short" aria-labelledby="scene05-heading">
      <div className="scene-content">
        <div className="split-scene">
          <Reveal>
            <p className="eyebrow" style={{ color: "#8a6420" }}>
              Scripture
            </p>
            <h2 id="scene05-heading" className="serif display-xl" style={{ fontSize: "clamp(24px,3.6vw,38px)", color: "var(--ink)" }}>
              {SCRIPTURE_FOUNDATION.headline}
            </h2>
            <p className="lede" style={{ color: "#4c463a", maxWidth: 620 }}>
              {SCRIPTURE_FOUNDATION.body}
            </p>
            <div className="chip-row">
              {["Study", "Learn", "Reflect", "Practice", "Share"].map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </div>
          </Reveal>
          <div className="split-media">
            <DemoPhoto id="P2P_HOME_SCRIPTURE_001" />
          </div>
        </div>
      </div>
    </section>
  );
}
