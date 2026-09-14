import { DemoPhoto } from "@/components/media/DemoPhoto";

export function Scene01Arrival() {
  return (
    <section className="hero-cinematic" aria-labelledby="scene01-heading">
      <div className="hero-art">
        <DemoPhoto id="P2P_HOME_SCRIPTURE_001" priority />
        <div className="hero-scrim" aria-hidden="true" />
      </div>
      <div className="scene-content">
        <h1 id="scene01-heading" className="serif display-xl">
          Everyone is learning from someone.
          <br />
          <em>Everyone can help someone grow.</em>
        </h1>
        <p className="eyebrow" style={{ marginBottom: 32 }}>
          Peer to Peer Global Discipleship Network
        </p>
        <div className="btn-row">
          <a href="/why-p2p" className="btn btn-primary">
            Explore P2P
          </a>
          <a href="/get-the-app" className="btn btn-secondary">
            Experience P2P
          </a>
        </div>
      </div>
      <div className="scroll-cue" aria-hidden="true">
        <span />
        Scroll
      </div>
    </section>
  );
}
