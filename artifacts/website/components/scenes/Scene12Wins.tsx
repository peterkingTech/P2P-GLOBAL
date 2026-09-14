import { Reveal } from "@/components/Reveal";
import { WinCardDemo } from "@/components/cards/Cards";

export function Scene12Wins() {
  return (
    <section className="scene short" aria-labelledby="scene12-heading">
      <div className="scene-content">
        <Reveal>
          <p className="eyebrow">Kingdom Wins</p>
          <h2 id="scene12-heading" className="serif display-xl" style={{ fontSize: "clamp(22px,3vw,32px)" }}>
            One story encourages another. Another person grows. Another person helps someone else.
          </h2>
          <div style={{ marginTop: 20 }}>
            <WinCardDemo />
          </div>
          <div style={{ marginTop: 20 }}>
            <a href="/explore/wins" className="btn btn-ghost">
              Explore Kingdom Wins →
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
