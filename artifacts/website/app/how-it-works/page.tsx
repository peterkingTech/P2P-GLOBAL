import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import { MediaPlaceholder } from "@/components/media/MediaPlaceholder";

export const metadata: Metadata = {
  title: "How It Works",
  description: "Learn. Grow. Help. Multiply. Not a linear course — a living cycle at the center of P2P discipleship.",
  alternates: { canonical: "/how-it-works" },
};

const STAGES = [
  {
    word: "Learn",
    items: ["Scripture", "Discipleship", "Wisdom", "Learning from others"],
    body: "You start by learning from someone a step ahead of you — through Scripture, through Kingdom School, through a Peer Guide who walked this road before you did.",
    mediaId: "P2P_LEARN_001",
  },
  {
    word: "Grow",
    items: ["Character", "Faith", "Obedience", "Spiritual maturity"],
    body: "Knowledge that doesn't change how you live isn't discipleship yet. Growth shows up in character, not just in what you can recite.",
    mediaId: "P2P_GROW_001",
  },
  {
    word: "Help",
    items: ["Encourage", "Walk with others", "Share what you've learned", "Serve"],
    body: "The moment you learn something true, you're qualified to pass it on — not as an expert, but as someone willing to walk alongside another person.",
    mediaId: "P2P_HELP_001",
  },
  {
    word: "Multiply",
    items: ["Disciple others", "Teach others", "Serve others", "Continue the cycle"],
    body: "Multiply isn't a finish line — it's the cycle starting again in someone else, and then in whoever they disciple after that.",
    mediaId: "P2P_MULTIPLY_001",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="How It Works"
        title={
          <>
            Learn. Grow. Help. <em>Multiply.</em>
          </>
        }
        lede="Not a linear course you complete once — a living cycle. Each stage feeds the next, without end."
      />

      <section className="scene short" aria-labelledby="cycle-heading">
        <div className="scene-content prose">
          <Reveal>
            <h2 id="cycle-heading" className="visually-hidden">
              This is a cycle, not a course
            </h2>
            <p className="lede">
              Someone can be learning while helping another. Someone can be growing while encouraging someone
              else. Someone can receive while also giving. This is the heart of peer-to-peer discipleship.
            </p>
          </Reveal>
        </div>
      </section>

      {STAGES.map((s, i) => (
        <section key={s.word} className={`scene short${i % 2 === 1 ? " light" : ""}`} aria-labelledby={`stage-${i}`}>
          <div className="scene-content">
            <Reveal>
              <p className="eyebrow">Stage {i + 1} of 4</p>
              <h2 id={`stage-${i}`} className="serif display-xl" style={{ fontSize: "clamp(30px,5vw,52px)" }}>
                {s.word}
              </h2>
              <p className="lede" style={i % 2 === 1 ? { color: "#4c463a" } : undefined}>
                {s.body}
              </p>
              <div className="chip-row">
                {s.items.map((item) => (
                  <span key={item} className="chip">
                    {item}
                  </span>
                ))}
              </div>
              <div style={{ maxWidth: 420, marginTop: 20 }}>
                <MediaPlaceholder id={s.mediaId} />
              </div>
            </Reveal>
          </div>
        </section>
      ))}

      <section className="scene short" aria-labelledby="tagline-heading">
        <div className="scene-content" style={{ textAlign: "center" }}>
          <Reveal>
            <h2 id="tagline-heading" className="serif display-xl" style={{ margin: "0 auto 32px" }}>
              Everyone is learning from someone.
              <br />
              <em>Everyone can help someone grow.</em>
            </h2>
            <a href="/experience" className="btn btn-primary">
              See the P2P Experience
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
