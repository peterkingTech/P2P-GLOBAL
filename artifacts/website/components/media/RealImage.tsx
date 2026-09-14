import Image from "next/image";
import { getMediaSlot } from "@/lib/media";
import { MediaPlaceholder } from "./MediaPlaceholder";

/**
 * Renders a real image once one exists for the given media id (status
 * "available" | "p2p-owned" | "licensed" and a filename present) — falls
 * back to <MediaPlaceholder> automatically otherwise, so a page never needs
 * to be edited twice: once to add the slot, once to wire in the real file.
 */
export function RealImage({
  id,
  sizes = "100vw",
  priority = false,
  className,
}: {
  id: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  const slot = getMediaSlot(id);
  if (!slot) return null;

  const hasRealAsset = slot.filename && (slot.status === "available" || slot.status === "p2p-owned" || slot.status === "licensed");

  if (!hasRealAsset) {
    return <MediaPlaceholder id={id} className={className} />;
  }

  return (
    <figure className={`real-media-frame${className ? ` ${className}` : ""}`} style={{ aspectRatio: slot.aspectRatio.replace("/", " / ") }}>
      <Image src={`/media/${slot.filename}`} alt={slot.alt} fill sizes={sizes} priority={priority} />
      {slot.caption && <figcaption>{slot.caption}</figcaption>}
    </figure>
  );
}

/** Cinematic variant — full-bleed, no rounded frame, for hero-scale moments. */
export function CinematicImage(props: Parameters<typeof RealImage>[0]) {
  return <RealImage {...props} className={`cinematic${props.className ? ` ${props.className}` : ""}`} />;
}
