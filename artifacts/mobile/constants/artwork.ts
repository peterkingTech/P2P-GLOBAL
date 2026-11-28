// Shared app artwork, so every screen that shows a feature uses the same image.

/** Bible Study and the Bible reader ("Holy Bible — multi language, multi version"). */
/** The front cover (owner 2026-11-28): the book itself, cut out of its white background (transparent WebP, 900 × 1304). */
export const BIBLE_COVER = require("@/assets/images/bible-cover.webp");
/** The same book on its own navy, square and solid — for the lock screen and square thumbnails. */
export const BIBLE_ARTWORK = require("@/assets/images/bible-artwork.jpg");   // own name: Android resources ignore the extension (bible-cover.webp would clash)
/** The cover's own navy, behind it so any spare space blends in. */
export const BIBLE_COVER_BG = "#1B2439";   // the cover's own navy leather (cover replaced 2026-11-28)
/** The front cover's own shape (portrait). */
export const BIBLE_COVER_RATIO = 900 / 1304;
/** Where each book's body ends above its ribbon (fraction of the picture's height): front 87.3 %, back 95 %. Used to
 *  show the two books at the same size side by side. */
export const BIBLE_COVER_BODY = 0.873;
export const BIBLE_BACK_BODY = 0.95;
/** The back cover (owner 2026-11-28): the features, Read · Listen · Study · Apply · Grow. Cut out of its white
 *  background (transparent WebP, 900 × 1164), "Greek" corrected, navy and gold matched to the front. Shown beside the front on wide screens; each row is a button. */
export const BIBLE_BACK = require("@/assets/images/bible-back.webp");
export const BIBLE_BACK_RATIO = 900 / 1164;
/** Where each row sits on the back cover image (fractions of its width and height). */
export const BIBLE_BACK_ROWS: { key: "read" | "listen" | "study" | "apply" | "grow"; label: string; route: string; top: number; height: number }[] = [
  { key: "read", label: "Read — many Bible versions in many languages", route: "/bible", top: 0.415, height: 0.063 },
  { key: "listen", label: "Listen — Audio Bible with natural voices", route: "/library", top: 0.48, height: 0.066 },
  { key: "study", label: "Study — Deep Study, original Hebrew and Greek", route: "/deep-study", top: 0.549, height: 0.066 },
  { key: "apply", label: "Apply — Today's Instruction", route: "/daily-word", top: 0.619, height: 0.068 },
  { key: "grow", label: "Grow — reading plans", route: "/plans", top: 0.69, height: 0.066 },
];
export const BIBLE_BACK_ROW_LEFT = 0.13, BIBLE_BACK_ROW_RIGHT = 0.92;
export const BIBLE_COVER_LABEL = "Holy Bible — multi-language, multi-version edition: read, listen, study, apply, grow";

/**
 * Makes a bundled image fill its frame exactly. On web an image bundled with the
 * app otherwise keeps its natural pixel size and the frame shows only a
 * zoomed-in part of it (absoluteFill alone is not enough).
 */
export const ARTWORK_FILL = { position: "absolute" as const, top: 0, left: 0, width: "100%" as const, height: "100%" as const };
