import { DemoBadge } from "@/components/media/DemoBadge";
import { DEMO_MISSIONS, DEMO_WIN } from "@/lib/content/demo-universe";

export function CompareColumns() {
  const before = ["Watch", "Read", "Listen", "Attend", "Consume"];
  const after = ["Learn", "Grow", "Practice", "Encourage", "Help", "Multiply"];
  return (
    <div className="compare-grid">
      <div className="compare-col before">
        <span className="compare-label">Before</span>
        <ul>
          {before.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
      <span className="compare-arrow" aria-hidden="true">
        →
      </span>
      <div className="compare-col after">
        <span className="compare-label">P2P</span>
        <ul>
          {after.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MissionCards() {
  return (
    <div className="mission-grid">
      {DEMO_MISSIONS.map((m) => (
        <div className="mission-card" key={m.title}>
          <span className="mission-kind">{m.kind}</span>
          <span className="mission-title serif">{m.title}</span>
          <span className="mission-place">{m.place}</span>
          <DemoBadge label="Sample mission" />
        </div>
      ))}
    </div>
  );
}

export function WinCardDemo({ quote = DEMO_WIN.quote, attribution = DEMO_WIN.attribution }: { quote?: string; attribution?: string }) {
  return (
    <div className="win-card-demo">
      <DemoBadge label="Demo story" />
      <p className="serif win-quote">&ldquo;{quote}&rdquo;</p>
      <span className="win-attribution">— {attribution}</span>
    </div>
  );
}

export function VideoCard({
  label,
  title,
  duration,
  tone = "forest",
}: {
  label: string;
  title: string;
  duration: string;
  tone?: "forest" | "ember" | "water";
}) {
  return (
    <div className={`video-card tone-${tone}`}>
      <div className="video-card-art" aria-hidden="true">
        <span className="video-play">▶</span>
        <span className="video-duration">{duration}</span>
      </div>
      <span className="video-card-label">{label}</span>
      <span className="video-card-title">{title}</span>
    </div>
  );
}

export function StageFlow({
  stages,
}: {
  stages: { label: string; body: string; tone: "forest" | "ember" | "water" | "parchment" }[];
}) {
  return (
    <div className="stage-flow">
      {stages.map((s, i) => (
        <div className="stage-flow-item" key={s.label}>
          <div className={`stage-flow-art tone-${s.tone}`} aria-hidden="true" />
          <span className="stage-flow-label serif">{s.label}</span>
          <p>{s.body}</p>
          {i < stages.length - 1 && (
            <span className="stage-flow-arrow" aria-hidden="true">
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
