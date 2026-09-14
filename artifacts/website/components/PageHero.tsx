import { DemoPhoto } from "@/components/media/DemoPhoto";

export function PageHero({
  eyebrow,
  title,
  lede,
  light,
  mediaId,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede?: string;
  light?: boolean;
  mediaId?: string;
}) {
  if (mediaId) {
    return (
      <section className="hero-cinematic" style={{ alignItems: "center" }}>
        <div className="hero-art">
          <DemoPhoto id={mediaId} priority />
          <div className="hero-scrim" aria-hidden="true" />
        </div>
        <div className="scene-content">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="serif display-xl">{title}</h1>
          {lede && <p className="lede">{lede}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className={`scene short page-hero${light ? " light" : ""}`}>
      <div className="scene-content">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="serif display-xl">{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
    </section>
  );
}
