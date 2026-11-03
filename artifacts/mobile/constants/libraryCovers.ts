import type { AppColors } from "@/constants/themes";
import { BIBLE_COVER } from "@/constants/artwork";

// Covers for Scripture playlists and collections (migration 227 cover_kind /
// cover_ref). Built from the app's own artwork and the person's THEME colours
// by name — never raw colours — so every cover suits light, dark, sepia and
// midnight. The official P2P logo is NOT a playlist cover: it stays the
// lock-screen / Now Playing artwork (docs/scripture-listening-library.md).

type Tone = "accentGreen" | "primaryGreen" | "amber" | "textMid" | "navBg";
export interface CoverDesign { id: string; label: string; icon: string; tone: Tone; image?: number }

/** Built-in Scripture artwork. */
export const COVER_ARTWORK: CoverDesign[] = [
  { id: "holy-bible", label: "Holy Bible", icon: "book", tone: "navBg", image: BIBLE_COVER },
  { id: "morning-light", label: "Morning light", icon: "sunny", tone: "amber" },
  { id: "still-waters", label: "Still waters", icon: "water", tone: "primaryGreen" },
  { id: "green-pastures", label: "Green pastures", icon: "leaf", tone: "accentGreen" },
  { id: "promises", label: "Promises", icon: "star", tone: "amber" },
  { id: "prayer", label: "Prayer", icon: "flame", tone: "textMid" },
  { id: "night-watch", label: "Night watch", icon: "moon", tone: "navBg" },
  { id: "gods-love", label: "God's love", icon: "heart", tone: "primaryGreen" },
];
/** Plain theme colours. */
export const COVER_COLOURS: { id: string; label: string; tone: Tone }[] = [
  { id: "green", label: "Green", tone: "accentGreen" },
  { id: "deep-green", label: "Deep green", tone: "primaryGreen" },
  { id: "amber", label: "Amber", tone: "amber" },
  { id: "earth", label: "Earth", tone: "textMid" },
  { id: "night", label: "Night", tone: "navBg" },
];

export interface ResolvedCover { background: string; icon: string; image?: number; label: string }
/** What a cover looks like in this theme. Unknown or missing → the default for its kind. */
export function resolveCover(cover: { kind: string; ref: string } | null | undefined, kind: "collection" | "playlist", c: Pick<AppColors, Tone>): ResolvedCover {
  if (cover?.kind === "artwork") {
    const a = COVER_ARTWORK.find((x) => x.id === cover.ref);
    if (a) return { background: c[a.tone], icon: a.icon, image: a.image, label: a.label };
  }
  if (cover?.kind === "colour") {
    const col = COVER_COLOURS.find((x) => x.id === cover.ref);
    if (col) return { background: c[col.tone], icon: kind === "playlist" ? "musical-notes" : "albums", label: col.label };
  }
  return kind === "playlist"
    ? { background: c.accentGreen, icon: "musical-notes", label: "Playlist" }
    : { background: c.amber, icon: "albums", label: "Collection" };
}
