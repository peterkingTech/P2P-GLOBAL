import { Reveal } from "@/components/Reveal";
import { DemoPhoto } from "@/components/media/DemoPhoto";

export function WorldScene({
  id,
  eyebrow,
  title,
  body,
  mediaId,
  cta,
}: {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  /** @deprecated Phase 4 replaced the particle globe/mesh with photography; kept so older call sites still type-check. */
  distribution?: string;
  mediaId: string;
  cta?: { label: string; href: string };
}) {
  return (
    <section className="hero-cinematic" aria-labelledby={id} style={{ alignItems: "center" }}>
      <div className="hero-art">
        <DemoPhoto id={mediaId} />
        <div className="hero-scrim" aria-hidden="true" />
        <svg className="world-dots" viewBox="0 0 400 200" aria-hidden="true" preserveAspectRatio="none">
          <circle cx="60" cy="60" r="1.6" fill="#e0b45f" opacity="0.7" />
          <circle cx="140" cy="40" r="1.2" fill="#c9d6d0" opacity="0.5" />
          <circle cx="230" cy="80" r="1.8" fill="#e0b45f" opacity="0.6" />
          <circle cx="310" cy="50" r="1.2" fill="#c9d6d0" opacity="0.5" />
          <circle cx="360" cy="120" r="1.6" fill="#e0b45f" opacity="0.6" />
          <circle cx="90" cy="140" r="1.2" fill="#c9d6d0" opacity="0.4" />
          <line x1="60" y1="60" x2="230" y2="80" stroke="#c9d6d0" strokeOpacity="0.18" strokeWidth="0.5" />
          <line x1="230" y1="80" x2="310" y2="50" stroke="#c9d6d0" strokeOpacity="0.18" strokeWidth="0.5" />
          <line x1="140" y1="40" x2="230" y2="80" stroke="#c9d6d0" strokeOpacity="0.18" strokeWidth="0.5" />
        </svg>
      </div>
      <div className="scene-content" style={{ textAlign: "center" }}>
        <Reveal>
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={id} className="serif display-xl" style={{ margin: "0 auto 16px", fontSize: "clamp(24px,3.6vw,38px)" }}>
            {title}
          </h2>
          <p className="lede" style={{ margin: "0 auto 24px" }}>
            {body}
          </p>
          {cta && (
            <a href={cta.href} className="btn btn-ghost">
              {cta.label}
            </a>
          )}
        </Reveal>
      </div>
    </section>
  );
}
