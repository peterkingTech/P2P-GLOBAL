import { Reveal } from "@/components/Reveal";
import { DemoPhoto } from "@/components/media/DemoPhoto";
import { HomeScreen } from "@/components/appui/AppScreens";

export function Scene14Invitation() {
  return (
    <section className="hero-cinematic" aria-labelledby="scene14-heading" style={{ alignItems: "center" }}>
      <div className="hero-art">
        <DemoPhoto id="P2P_HOME_PEOPLE_001" />
        <div className="hero-scrim" aria-hidden="true" />
      </div>
      <div className="scene-content">
        <div className="split-scene">
          <Reveal>
            <p className="eyebrow">The Invitation</p>
            <h2 id="scene14-heading" className="serif display-xl" style={{ margin: "0 0 8px" }}>
              Understand the vision.
            </h2>
            <p className="serif display-xl" style={{ fontStyle: "italic", color: "var(--ember-bright)", margin: "0 0 32px" }}>
              Experience the journey.
            </p>
            <a href="/get-the-app" className="btn btn-primary" style={{ fontSize: 13, padding: "16px 34px" }}>
              Get the P2P App
            </a>
            <div className="store-badges">
              <a href="/get-the-app" className="store-badge" aria-label="Download on the App Store">
                App Store
              </a>
              <a href="/get-the-app" className="store-badge" aria-label="Get it on Google Play">
                Google Play
              </a>
            </div>
          </Reveal>
          <div className="split-media" style={{ display: "flex", justifyContent: "center" }}>
            <div className="phone-frame" style={{ width: 190 }}>
              <div className="phone-notch" aria-hidden="true" />
              <div className="phone-screen">
                <HomeScreen />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
