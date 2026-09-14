import { Reveal } from "@/components/Reveal";
import { DemoPhoto } from "@/components/media/DemoPhoto";
import { P2P_JOURNEY_STEPS, P2P_JOURNEY_HEADLINE } from "@/lib/content/journey";

export function SceneJourney() {
  return (
    <section className="scene short" aria-labelledby="scene-journey-heading">
      <div className="scene-content">
        <div className="split-scene">
          <Reveal>
            <p className="eyebrow">The P2P Journey</p>
            <h2 id="scene-journey-heading" className="serif display-xl" style={{ fontSize: "clamp(24px,3.6vw,38px)" }}>
              {P2P_JOURNEY_HEADLINE}
            </h2>
            <div className="journey-steps" style={{ marginTop: 8 }}>
              {P2P_JOURNEY_STEPS.map((s) => (
                <div key={s.label} className="journey-step">
                  <div>
                    <span className="jstep-label serif">{s.label}</span>
                    <p style={{ margin: 0, fontSize: 14, color: "var(--mist-dim)" }}>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
          <div className="split-media">
            <DemoPhoto id="P2P_LEARN_001" />
          </div>
        </div>
      </div>
    </section>
  );
}
