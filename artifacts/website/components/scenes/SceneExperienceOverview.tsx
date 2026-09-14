import { Reveal } from "@/components/Reveal";
import { ECOSYSTEM_DOMAINS } from "@/lib/content/ecosystem";
import { LearnScreen } from "@/components/appui/AppScreens";

export function SceneExperienceOverview() {
  return (
    <section className="scene light short" aria-labelledby="scene-experience-heading">
      <div className="scene-content">
        <div className="split-scene">
          <Reveal>
            <p className="eyebrow">The P2P Experience</p>
            <h2 id="scene-experience-heading" className="serif display-xl" style={{ fontSize: "clamp(24px,3.6vw,38px)" }}>
              Ten domains. One discipleship network.
            </h2>
            <p className="lede" style={{ color: "#4c463a" }}>
              This is what&rsquo;s inside the app — explained here, experienced there.
            </p>
            <div className="chip-row">
              {ECOSYSTEM_DOMAINS.map((d) => (
                <span key={d.slug} className="chip">
                  {d.name}
                </span>
              ))}
            </div>
            <a href="/experience" className="btn btn-ghost" style={{ marginTop: 12 }}>
              See the full P2P Experience →
            </a>
          </Reveal>
          <div className="split-media" style={{ display: "flex", justifyContent: "center" }}>
            <div className="phone-frame" style={{ width: 200 }}>
              <div className="phone-notch" aria-hidden="true" />
              <div className="phone-screen">
                <LearnScreen />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
