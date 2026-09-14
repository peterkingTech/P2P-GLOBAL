import { Scene01Arrival } from "@/components/scenes/Scene01Arrival";
import { Scene02Center } from "@/components/scenes/Scene02Center";
import { Scene03WhyP2P } from "@/components/scenes/Scene03WhyP2P";
import { FlowRibbon } from "@/components/scroll/FlowRibbon";
import { Scene05Scripture } from "@/components/scenes/Scene05Scripture";
import { StatementScene } from "@/components/scenes/StatementScene";
import { SceneJourney } from "@/components/scenes/SceneJourney";
import { SceneExperienceOverview } from "@/components/scenes/SceneExperienceOverview";
import { WorldScene } from "@/components/scenes/WorldScene";
import { Scene11Stories } from "@/components/scenes/Scene11Stories";
import { Scene12Wins } from "@/components/scenes/Scene12Wins";
import { MultiplicationTree } from "@/components/scroll/MultiplicationTree";
import { Scene14Invitation } from "@/components/scenes/Scene14Invitation";
import { HUMILITY_STATEMENT } from "@/lib/content/p2p-foundation";

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "P2P Global Discipleship Network",
  alternateName: "P2P Global Bible Study Network",
  url: "https://p2pglobal.org",
  description:
    "Everyone is learning from someone. Everyone can help someone grow. A global peer-to-peer discipleship network with Jesus at the center.",
  slogan: "Everyone is learning from someone. Everyone can help someone grow.",
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
      />

      {/* 01 — Arrival */}
      <Scene01Arrival />

      {/* 02 — Question */}
      <StatementScene
        id="scene-question-heading"
        eyebrow="A Question"
        title={<>What if discipleship became something <em>everyone could participate in?</em></>}
        body="Not just something you consume — something you carry forward."
        center
      />

      {/* 03 — Jesus */}
      <Scene02Center />

      {/* 04 — Scripture */}
      <Scene05Scripture />

      {/* 05 — Holy Spirit */}
      <StatementScene
        id="scene-holyspirit-heading"
        eyebrow="The Holy Spirit"
        title={<>The Holy Spirit is <em>our guide.</em></>}
        body="Technology can facilitate connection. Technology can organize information. Technology can provide tools. But spiritual transformation belongs to God — not to a platform, and not to an algorithm."
        mediaId="P2P_GROW_001"
      />

      {/* 06 — People */}
      <StatementScene
        id="scene06-heading"
        eyebrow="People"
        title="Real connection, not a counted statistic."
        body="Every light here stands for a relationship — someone learning from someone, someone helping someone grow. Technology can create the space. People create the relationship."
        ctaLabel="See how Connect works →"
        ctaHref="/experience"
        mediaId="P2P_HOME_PEOPLE_001"
      />

      {/* 07 — Why Peer-to-Peer */}
      <Scene03WhyP2P />

      {/* 08 — Learn → Grow → Help → Multiply */}
      <FlowRibbon />

      {/* 09 — The P2P Journey */}
      <SceneJourney />

      {/* 10 — The P2P Experience (ecosystem overview) */}
      <SceneExperienceOverview />

      {/* 11 — Families */}
      <StatementScene
        id="scene07-heading"
        eyebrow="Families"
        title="A household, gathered around Scripture together."
        quote="No rankings, no spiritual points — just what actually happened."
        ctaLabel="For Families →"
        ctaHref="/for-families"
        mediaId="P2P_HOME_FAMILY_001"
      />

      {/* 12 — Churches */}
      <StatementScene
        id="scene08-heading"
        eyebrow="Churches"
        title="P2P serves the local church. It was never meant to replace it."
        quote="Completely free. Always. No subscription. No payment. No catch."
        ctaLabel="For Churches →"
        ctaHref="/for-churches"
        mediaId="P2P_HOME_CHURCH_001"
      />

      {/* 13 — Missions */}
      <WorldScene
        id="scene09-heading"
        eyebrow="Missions"
        title="From your street to the unreached."
        body="Real mission fields and stories, organized by focus — never a fabricated activity map or invented statistic."
        mediaId="P2P_HOME_MISSION_001"
        cta={{ label: "Explore Missions →", href: "/explore/missions" }}
      />

      {/* 14 — Kingdom Stories */}
      <Scene11Stories />

      {/* 15 — Kingdom Wins */}
      <Scene12Wins />

      {/* 16 — 2 Timothy 2:2 / Multiplication */}
      <MultiplicationTree />

      {/* 17 — Habakkuk 2:14 / Global Vision */}
      <WorldScene
        id="scene-global-heading"
        eyebrow="Habakkuk 2:14 · Global Vision"
        title="God's glory. Not P2P's glory."
        body="For the earth will be filled with the knowledge of the glory of the Lord, as the waters cover the sea. P2P does not claim to have reached countries or populations it has not verified — the vision is His, and so is the glory."
        mediaId="P2P_GLOBAL_001"
      />

      {/* 18 — Humility */}
      <section className="scene short" aria-labelledby="scene-humility-heading" style={{ textAlign: "center" }}>
        <div className="scene-content">
          <h2 id="scene-humility-heading" className="visually-hidden">
            Not our work, His work
          </h2>
          <p className="serif display-xl" style={{ margin: "0 auto", fontSize: "clamp(24px,4vw,44px)" }}>
            {HUMILITY_STATEMENT.lines[0]}
            <br />
            <em>{HUMILITY_STATEMENT.lines[1]}</em>
            <br />
            {HUMILITY_STATEMENT.lines[2]}
            <br />
            <em>{HUMILITY_STATEMENT.lines[3]}</em>
          </p>
        </div>
      </section>

      {/* 19 — Invitation */}
      <Scene14Invitation />
    </>
  );
}
