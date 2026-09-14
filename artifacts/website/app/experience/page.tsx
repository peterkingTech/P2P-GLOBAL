import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import { AppShowcase } from "@/components/media/AppShowcase";
import { APP_SHOWCASE_SCREEN_IDS } from "@/lib/media";
import { ECOSYSTEM_DOMAINS } from "@/lib/content/ecosystem";

export const metadata: Metadata = {
  title: "The P2P Experience",
  description: "What you can experience inside the P2P app — Scripture, Discipleship, Prayer, People, Families, Churches, Missions, and more.",
  alternates: { canonical: "/experience" },
};

export default function ExperiencePage() {
  return (
    <>
      <PageHero
        eyebrow="The P2P Experience"
        title={<>What&rsquo;s actually inside.</>}
        lede="This page explains it — the website is not where you live it out. The real experience is in the app."
      />

      <section className="scene light short" aria-labelledby="foundation-heading">
        <div className="scene-content prose">
          <Reveal>
            <h2 id="foundation-heading" className="serif display-xl" style={{ fontSize: "clamp(20px,2.8vw,28px)" }}>
              Before the features: the foundation.
            </h2>
            <p style={{ fontSize: 14.5, color: "#4c463a", maxWidth: 620 }}>
              Every domain below sits on the same foundation — Jesus is the center, Scripture is what everything is
              tested against, and the Holy Spirit is the guide none of this technology replaces. The ten domains
              are how that foundation gets lived out day to day.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="scene short" aria-labelledby="domains-heading">
        <div className="scene-content">
          <h2 id="domains-heading" className="visually-hidden">
            App domains
          </h2>
          <div className="domain-list">
            {ECOSYSTEM_DOMAINS.map((d, i) => (
              <Reveal key={d.slug}>
                <div className="domain-item">
                  <span className="num serif">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="serif">{d.name}</h3>
                    <p style={{ fontSize: 13, color: "var(--ember-bright)", marginBottom: 6 }}>{d.purpose}</p>
                    <p>{d.body}</p>
                    <a href={d.ctaHref} className="btn btn-ghost">
                      {d.ctaLabel} →
                    </a>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="app-showcase-heading">
        <div className="scene-content">
          <h2 id="app-showcase-heading" className="serif display-xl" style={{ fontSize: "clamp(20px,2.8vw,28px)" }}>
            What it actually looks like.
          </h2>
          <Reveal>
            <AppShowcase screenIds={APP_SHOWCASE_SCREEN_IDS} />
          </Reveal>
        </div>
      </section>

      <section className="scene short" aria-labelledby="close-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <Reveal>
            <h2 id="close-heading" className="serif display-xl" style={{ margin: "0 auto 12px" }}>
              Now go <em>experience it.</em>
            </h2>
            <div className="btn-row" style={{ justifyContent: "center", marginTop: 20 }}>
              <a href="/get-the-app" className="btn btn-primary">
                Get the App
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
