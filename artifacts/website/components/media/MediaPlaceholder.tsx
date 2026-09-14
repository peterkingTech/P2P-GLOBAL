import { getMediaSlot } from "@/lib/media";

/**
 * A media slot awaiting real photography/video. Deliberately does NOT try
 * to look like a finished photograph — it reads as a considered, labeled
 * frame (closer to a museum wall label before a piece is hung) so nobody
 * mistakes it for real P2P media. Swapping in a real asset later is a
 * matter of pointing <RealImage>/<RealVideo> at the same media id — no
 * layout change required.
 */
export function MediaPlaceholder({ id, className }: { id: string; className?: string }) {
  const slot = getMediaSlot(id);
  if (!slot) return null;

  return (
    <figure
      className={`media-placeholder${className ? ` ${className}` : ""}`}
      style={{ aspectRatio: slot.aspectRatio.replace("/", " / ") }}
    >
      <div className="mp-mark" aria-hidden="true">
        <span />
      </div>
      <figcaption>
        <span className="mp-subject">{slot.subject}</span>
        <span className="mp-meta">
          {slot.mood} · {slot.aspectRatio}
        </span>
        <span className="mp-status">{slot.status === "pending" ? "Real media pending" : "Media placeholder"} · {slot.id}</span>
      </figcaption>
    </figure>
  );
}
