import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { AppShowcase } from "@/components/media/AppShowcase";
import { MediaPlaceholder } from "@/components/media/MediaPlaceholder";
import { HomeScreen } from "@/components/appui/AppScreens";
import { APP_SHOWCASE_SCREEN_IDS } from "@/lib/media";
import { ECOSYSTEM_DOMAINS } from "@/lib/content/ecosystem";

export const metadata: Metadata = {
  title: "Get the App",
  description: "Understanding the vision is only the beginning. Experience P2P in the real app.",
  alternates: { canonical: "/get-the-app" },
};

export default function GetTheAppPage() {
  return (
    <>
      <section className="scene short" aria-labelledby="app-heading">
        <div className="scene-content">
          <div className="split-scene">
            <div>
              <p className="eyebrow">Get the App</p>
              <h1 id="app-heading" className="serif display-xl" style={{ margin: "0 0 12px" }}>
                Experience P2P.
              </h1>
              <p className="lede" style={{ margin: "0 0 8px" }}>
                Understanding the vision is only the beginning.
              </p>
              <p style={{ fontSize: 13, color: "var(--silver-dim)", marginBottom: 8 }}>
                P2P Global Discipleship Network — published as &ldquo;P2P Global Bible Study Network&rdquo; on the
                app stores.
              </p>

              <div className="store-full">
                <div className="btn-row">
                  <span className="btn btn-secondary" aria-disabled="true" style={{ cursor: "default" }}>
                    App Store — coming soon
                  </span>
                  <span className="btn btn-secondary" aria-disabled="true" style={{ cursor: "default" }}>
                    Google Play — coming soon
                  </span>
                </div>
                <div className="qr-box" aria-hidden="true">
                  QR
                </div>
              </div>
              <p style={{ fontSize: 11.5, color: "var(--silver-dim)", marginTop: 16, maxWidth: 420 }}>
                Real store links and a scannable QR code will replace these once the listings go live — never
                fabricated in the meantime.
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div className="phone-frame" style={{ width: 220 }}>
                <div className="phone-notch" aria-hidden="true" />
                <div className="phone-screen">
                  <HomeScreen />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why the app exists */}
      <section className="scene light short" aria-labelledby="why-app-heading">
        <div className="scene-content prose">
          <Reveal>
            <h2 id="why-app-heading" className="serif display-xl" style={{ fontSize: "clamp(20px,2.8vw,28px)" }}>
              Why the app, and not just the website.
            </h2>
            <p style={{ fontSize: 14.5, color: "#4c463a", maxWidth: 620 }}>
              This website explains P2P. It does not <em>do</em> discipleship — real relationships, real Scripture
              study, real prayer, and real gatherings only happen in the app, with real people. Everything below is
              what&rsquo;s waiting there.
            </p>
          </Reveal>
        </div>
      </section>

      {/* What happens inside — reuse the ecosystem domains */}
      <section className="scene short" aria-labelledby="inside-heading">
        <div className="scene-content">
          <h2 id="inside-heading" className="eyebrow" style={{ fontSize: 12 }}>
            What happens inside
          </h2>
          <Reveal>
            <div className="chip-row">
              {ECOSYSTEM_DOMAINS.map((d) => (
                <span key={d.slug} className="chip">
                  {d.name}
                </span>
              ))}
            </div>
            <p className="lede" style={{ marginTop: 8 }}>
              Ten domains, one discipleship network — Scripture, Discipleship, Prayer, People, Families, Churches,
              Missions, Kingdom Stories, Kingdom Wins, and Gatherings, all under the same foundation explained on
              this website.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Real app showcase */}
      <section className="scene light short" aria-labelledby="showcase-heading">
        <div className="scene-content">
          <h2 id="showcase-heading" className="serif display-xl" style={{ fontSize: "clamp(20px,2.8vw,28px)" }}>
            A look inside.
          </h2>
          <Reveal>
            <AppShowcase screenIds={APP_SHOWCASE_SCREEN_IDS} />
            <p style={{ fontSize: 12, color: "#6b6152", fontStyle: "italic" }}>
              Presentation mockups built from the app&rsquo;s real terminology and navigation — not screenshots.
              Real screenshots will replace these once captured from the running app.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Walkthrough video */}
      <section className="scene short" aria-labelledby="walkthrough-heading">
        <div className="scene-content">
          <h2 id="walkthrough-heading" className="visually-hidden">
            App walkthrough
          </h2>
          <Reveal>
            <div style={{ maxWidth: 300 }}>
              <MediaPlaceholder id="P2P_APP_VIDEO_001" />
            </div>
          </Reveal>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="privacy-heading">
        <div className="scene-content prose">
          <h2 id="privacy-heading" className="serif display-xl" style={{ fontSize: "clamp(20px,2.8vw,28px)" }}>
            What happens next
          </h2>
          <Reveal>
            <p style={{ fontSize: 14.5, color: "#4c463a" }}>
              You&rsquo;ll create an account, choose your language, and begin with Peer-to-Peer Orientation — the
              first stage of Kingdom School. From there, a Peer Guide, a group, or a family gathering is one tap
              away.
            </p>
            <p style={{ fontSize: 13, color: "#6b6152" }}>
              Your data is never sold. Prayer requests, messages, and family gatherings stay private to the people
              you share them with.
            </p>
          </Reveal>
        </div>
      </section>
    </>
  );
}
