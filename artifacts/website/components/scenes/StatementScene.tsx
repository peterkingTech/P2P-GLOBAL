import { Reveal } from "@/components/Reveal";
import { DemoPhoto } from "@/components/media/DemoPhoto";

export function StatementScene({
  id,
  eyebrow,
  title,
  body,
  quote,
  ctaLabel,
  ctaHref,
  mediaId,
  center,
}: {
  id: string;
  eyebrow: string;
  title: React.ReactNode;
  body?: string;
  quote?: string;
  ctaLabel?: string;
  ctaHref?: string;
  /** @deprecated Phase 4 removed the ParticleField background; kept so older call sites still type-check. */
  distribution?: string;
  mediaId?: string;
  center?: boolean;
}) {
  const text = (
    <Reveal>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="serif display-xl" style={{ fontSize: "clamp(24px,3.6vw,40px)" }}>
        {title}
      </h2>
      {body && <p className="lede">{body}</p>}
      {quote && (
        <blockquote
          className="serif"
          style={{
            fontStyle: "italic",
            fontSize: 17,
            color: "var(--mist)",
            borderLeft: "2px solid var(--ember)",
            paddingLeft: 18,
            margin: center ? "0 auto 28px" : "0 0 28px",
            maxWidth: 520,
          }}
        >
          {quote}
        </blockquote>
      )}
      {ctaLabel && ctaHref && (
        <a href={ctaHref} className="btn btn-ghost">
          {ctaLabel}
        </a>
      )}
    </Reveal>
  );

  if (mediaId && !center) {
    return (
      <section className="scene short" aria-labelledby={id}>
        <div className="scene-content">
          <div className="split-scene">
            <div>{text}</div>
            <div className="split-media">
              <DemoPhoto id={mediaId} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="scene short" aria-labelledby={id}>
      <div className="scene-content" style={center ? { textAlign: "center" } : undefined}>
        {text}
        {mediaId && (
          <div style={{ maxWidth: 420, margin: "8px auto 0" }}>
            <DemoPhoto id={mediaId} />
          </div>
        )}
      </div>
    </section>
  );
}
