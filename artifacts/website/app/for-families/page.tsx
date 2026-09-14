import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { DemoPhoto } from "@/components/media/DemoPhoto";
import { DemoBadge } from "@/components/media/DemoBadge";
import { FamilyScreen } from "@/components/appui/AppScreens";
import { DEMO_FAMILY } from "@/lib/content/demo-universe";

export const metadata: Metadata = {
  title: "For Families",
  description: "A real, guided way for a household to gather around Scripture together — Family Gatherings, led by a Shepherd.",
  alternates: { canonical: "/for-families" },
};

export default function ForFamiliesPage() {
  return (
    <>
      <section className="hero-cinematic" aria-labelledby="families-heading" style={{ alignItems: "center" }}>
        <div className="hero-art">
          <DemoPhoto id="P2P_FAMILY_001" priority />
          <div className="hero-scrim" aria-hidden="true" />
        </div>
        <div className="scene-content">
          <p className="eyebrow">For Families</p>
          <h1 id="families-heading" className="serif display-xl">
            A household, gathered around <em>Scripture together.</em>
          </h1>
          <p className="lede">P2P supports relationships. It does not replace them.</p>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="shepherd-heading">
        <div className="scene-content">
          <div className="split-scene">
            <Reveal>
              <h2 id="shepherd-heading" className="serif display-xl" style={{ fontSize: "clamp(22px,3vw,32px)" }}>
                Every family has a Shepherd.
              </h2>
              <p className="lede" style={{ color: "#4c463a" }}>
                A parent or household leader who guides a real, real-time gathering — shared Scripture, shared
                prayer, shared media — for however many people call that household home.
              </p>
              <div className="chip-row">
                <span className="chip">Family Gathering</span>
                <span className="chip">Shepherd &amp; Co-Shepherd</span>
                <span className="chip">Shared Prayer</span>
                <span className="chip">Family Studies</span>
                <span className="chip">Study Workspace</span>
                <span className="chip">Shared Notes</span>
                <span className="chip">Voice</span>
              </div>
              <p style={{ fontSize: 12.5, color: "#6b6152", marginTop: 4 }}>
                A real, synchronized room — everyone sees the same Scripture, the same notes, and can speak or mute
                themselves, the way an actual gathering works.
              </p>
            </Reveal>
            <Reveal>
              <div className="demo-panel" style={{ margin: "0 auto" }}>
                <DemoBadge label="Sample family" />
                <div className="demo-panel-row">
                  <strong>{DEMO_FAMILY.name}</strong>
                  <span className="demo-panel-sub">{DEMO_FAMILY.memberCount} people</span>
                </div>
                <div className="demo-panel-row">
                  <span className="demo-panel-sub">Shepherd</span>
                  <span className="demo-panel-sub">{DEMO_FAMILY.shepherd}</span>
                </div>
                <div className="demo-panel-row">
                  <span className="demo-panel-sub">Next Gathering</span>
                  <span className="demo-panel-sub">{DEMO_FAMILY.nextGathering}</span>
                </div>
                <div className="demo-panel-row">
                  <span className="demo-panel-sub">Current Study</span>
                  <span className="demo-panel-sub">{DEMO_FAMILY.currentStudy}</span>
                </div>
                <p className="demo-panel-sub" style={{ margin: 0 }}>
                  {DEMO_FAMILY.lessonProgress}
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="scene short" aria-labelledby="family-ui-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <h2 id="family-ui-heading" className="visually-hidden">
            The Family Gathering, inside the app
          </h2>
          <Reveal>
            <p className="eyebrow">Inside the app</p>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div className="phone-frame" style={{ width: 210 }}>
                <div className="phone-notch" aria-hidden="true" />
                <div className="phone-screen">
                  <FamilyScreen />
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="scene short" aria-labelledby="journey-heading">
        <div className="scene-content">
          <h2 id="journey-heading" className="visually-hidden">
            Family Journey
          </h2>
          <Reveal>
            <div className="scripture-panel">
              <p className="scripture-mark serif">
                &ldquo;No rankings, no spiritual points, no AI-generated narrative — just what actually
                happened.&rdquo;
              </p>
              <p className="scripture-ref">The Family Journey philosophy</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="cta-heading">
        <div className="scene-content prose">
          <h2 id="cta-heading" className="visually-hidden">
            Experience P2P
          </h2>
          <Reveal>
            <p style={{ fontSize: 14.5, color: "#4c463a" }}>
              P2P supports discipleship in the home. It does not replace real-life family relationships, and it
              does not replace the local church your family belongs to.
            </p>
            <a href="/get-the-app" className="btn btn-primary">
              Experience P2P
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
