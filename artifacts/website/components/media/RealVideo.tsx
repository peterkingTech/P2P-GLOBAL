"use client";

import { getMediaSlot } from "@/lib/media";
import { MediaPlaceholder } from "./MediaPlaceholder";

/**
 * Renders real video once one exists for the given media id — falls back
 * to <MediaPlaceholder> otherwise. Muted autoplay only (never audio
 * autoplay), poster-first, playsInline for mobile, and a reduced-motion
 * visitor gets the poster frame with no autoplay at all.
 */
export function RealVideo({
  id,
  autoPlay = true,
  controls = false,
  className,
}: {
  id: string;
  autoPlay?: boolean;
  controls?: boolean;
  className?: string;
}) {
  const slot = getMediaSlot(id);
  if (!slot) return null;

  const hasRealAsset = slot.filename && (slot.status === "available" || slot.status === "p2p-owned" || slot.status === "licensed");

  if (!hasRealAsset) {
    return <MediaPlaceholder id={id} className={className} />;
  }

  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <figure className={`real-media-frame${className ? ` ${className}` : ""}`} style={{ aspectRatio: slot.aspectRatio.replace("/", " / ") }}>
      <video
        src={`/media/${slot.filename}`}
        poster={slot.filename ? `/media/${slot.filename.replace(/\.[^.]+$/, "-poster.jpg")}` : undefined}
        muted
        loop
        playsInline
        preload="metadata"
        autoPlay={autoPlay && !reduceMotion}
        controls={controls}
        aria-label={slot.alt}
      />
      {slot.caption && <figcaption>{slot.caption}</figcaption>}
    </figure>
  );
}

/** Cinematic variant — full-bleed, for hero-scale video moments. */
export function CinematicVideo(props: Parameters<typeof RealVideo>[0]) {
  return <RealVideo {...props} className={`cinematic${props.className ? ` ${props.className}` : ""}`} />;
}
