import Image from "next/image";
import { getMediaSlot, DEMO_MEDIA } from "@/lib/media";
import { DemoBadge } from "./DemoBadge";

/**
 * The Phase 4 photography primitive. If the slot's status is "demo", a
 * real (temporary, properly licensed, non-P2P) photo renders with credit
 * in the caption. Otherwise it falls back to a styled <PhotoPanel> — a
 * textured, brand-toned composition — instead of a flat gray box, so the
 * page still reads as photography-dense while nothing is misrepresented
 * as a finished asset. Swapping in real P2P photography later means only
 * flipping the slot's status in lib/media.ts.
 */
export function DemoPhoto({
  id,
  className,
  priority,
  sizes = "(max-width: 760px) 100vw, 50vw",
}: {
  id: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  const slot = getMediaSlot(id);
  if (!slot) return null;

  const demo = slot.status === "demo" ? DEMO_MEDIA[id] : undefined;

  if (demo) {
    return (
      <figure className={`demo-photo${className ? ` ${className}` : ""}`} style={{ aspectRatio: slot.aspectRatio.replace("/", " / ") }}>
        <Image
          src={demo.url}
          alt={slot.alt}
          fill
          priority={priority}
          sizes={sizes}
          style={{ objectFit: "cover" }}
        />
        <div className="demo-photo-scrim" aria-hidden="true" />
        <figcaption>
          <DemoBadge label="Demo photo" />
          <span className="dp-credit">
            {demo.creator} · {demo.license}
          </span>
        </figcaption>
      </figure>
    );
  }

  return <PhotoPanel tone={slot.tone ?? "forest"} subject={slot.subject} aspectRatio={slot.aspectRatio} className={className} />;
}

const TONE_GRADIENTS: Record<string, string> = {
  forest: "radial-gradient(120% 90% at 25% 15%, #2fc492 0%, #1d9e75 32%, #15654d 62%, #0c1c17 100%)",
  ember: "radial-gradient(120% 90% at 25% 15%, #f2c878 0%, #e0b45f 32%, #c9973e 62%, #3a2c14 100%)",
  water: "radial-gradient(120% 90% at 25% 15%, #3d6a5c 0%, #2a4a41 32%, #17332b 62%, #081310 100%)",
  parchment: "radial-gradient(120% 90% at 25% 15%, #fffaf0 0%, #f5f1e6 32%, #e8ddc0 62%, #cdbd93 100%)",
};

/**
 * A photographic-feeling stand-in used wherever no demo/real photo exists
 * yet for a slot — textured and toned to the brand palette rather than a
 * plain gray rectangle, so visual density doesn't collapse back to empty
 * boxes on the majority of slots that still await real photography.
 */
export function PhotoPanel({
  tone = "forest",
  subject,
  aspectRatio = "4/5",
  className,
}: {
  tone?: "forest" | "ember" | "water" | "parchment";
  subject: string;
  aspectRatio?: string;
  className?: string;
}) {
  return (
    <figure
      className={`photo-panel tone-${tone}${className ? ` ${className}` : ""}`}
      style={{ aspectRatio: aspectRatio.replace("/", " / "), background: TONE_GRADIENTS[tone] }}
    >
      <div className="photo-panel-grain" aria-hidden="true" />
      <figcaption>
        <DemoBadge label="Photography pending" />
        <span className="pp-subject">{subject}</span>
      </figcaption>
    </figure>
  );
}
