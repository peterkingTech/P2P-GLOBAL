import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/Reveal";
import { DemoPhoto } from "@/components/media/DemoPhoto";
import { KINGDOM_STORIES } from "@/lib/content/stories";

export const metadata: Metadata = {
  title: "Kingdom Stories",
  description: "Editorial stories from the global church — revival, history, persecution, and the people God has used.",
  alternates: { canonical: "/explore/stories" },
};

function articleJsonLd(story: (typeof KINGDOM_STORIES)[number]) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: story.title,
    alternativeHeadline: story.subtitle,
    articleSection: story.category,
    about: story.period,
    url: `https://p2pglobal.org/explore/stories#${story.slug}`,
    publisher: {
      "@type": "Organization",
      name: "P2P Global Discipleship Network",
    },
    articleBody: story.body.join(" "),
  };
}

export default function StoriesPage() {
  const [featured, ...rest] = KINGDOM_STORIES;

  return (
    <>
      {KINGDOM_STORIES.map((s) => (
        <script
          key={s.slug}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd(s)) }}
        />
      ))}
      <PageHero
        eyebrow="Explore · Kingdom Stories"
        title={<>Stories of faith, mission, and the work of God <em>across generations.</em></>}
        mediaId="P2P_STORIES_001"
      />

      <section className="scene light short" aria-labelledby="featured-heading">
        <div className="scene-content">
          <div className="split-scene">
            <article id={featured.slug} className="article-body">
              <p className="chip" style={{ marginBottom: 16 }}>
                {featured.category}
              </p>
              <h2 id="featured-heading" className="serif display-xl" style={{ fontSize: "clamp(24px,3.6vw,40px)" }}>
                {featured.title}
              </h2>
              <p className="lede" style={{ color: "#4c463a" }}>
                {featured.subtitle} · {featured.period}
              </p>
              {featured.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </article>
            <div className="split-media">
              <DemoPhoto id="P2P_STORIES_001" />
            </div>
          </div>
        </div>
      </section>

      <section className="scene light short" aria-labelledby="more-heading">
        <div className="scene-content">
          <h2 id="more-heading" className="eyebrow" style={{ fontSize: 12, color: "#8a6420" }}>
            More Kingdom Stories
          </h2>
          {rest.map((s) => (
            <Reveal key={s.slug}>
              <article id={s.slug} className="story-card-lg">
                <div>
                  <p className="sc-period">
                    {s.category} · {s.period}
                  </p>
                  <h3 className="serif sc-title">{s.title}</h3>
                  <p className="sc-excerpt">{s.subtitle}</p>
                  {s.body.map((p, i) => (
                    <p key={i} style={{ fontSize: 13.5, color: "#4c463a" }}>
                      {p}
                    </p>
                  ))}
                </div>
                <DemoPhoto id="P2P_STORIES_001" />
              </article>
            </Reveal>
          ))}
          <a href="/explore" className="btn btn-ghost" style={{ marginTop: 20, color: "#4c463a" }}>
            ← Back to Explore
          </a>
        </div>
      </section>
    </>
  );
}
