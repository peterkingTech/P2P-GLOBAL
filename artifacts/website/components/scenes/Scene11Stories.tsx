import { Reveal } from "@/components/Reveal";
import { DemoPhoto } from "@/components/media/DemoPhoto";

export function Scene11Stories() {
  return (
    <section className="scene light short" aria-labelledby="scene11-heading">
      <div className="scene-content">
        <Reveal>
          <p className="eyebrow">Kingdom Stories</p>
          <h2 id="scene11-heading" className="serif display-xl" style={{ fontSize: "clamp(22px,3vw,32px)" }}>
            Editorial stories from the global church — revival, history, and the people God has used.
          </h2>
          <a href="/explore/stories" className="p2p-card story" style={{ maxWidth: 420, marginTop: 20 }}>
            <DemoPhoto id="P2P_STORIES_001" className="cd-frame" />
            <span className="cd-tag">REVIVAL</span>
            <span className="cd-title serif">When the Fire Spread</span>
            <span className="cd-meta">Kingdom Story · 6 min read</span>
          </a>
          <div style={{ marginTop: 20 }}>
            <a href="/explore/stories" className="btn btn-ghost">
              Explore Kingdom Stories →
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
