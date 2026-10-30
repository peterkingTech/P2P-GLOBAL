// Shared app artwork, so every screen that shows a feature uses the same image.

/** Bible Study and the Bible reader ("Holy Bible — multi language, multi version"). */
export const BIBLE_COVER = require("@/assets/images/bible-cover.jpg");
/** The cover's own navy, behind it so any spare space blends in. */
export const BIBLE_COVER_BG = "#0A1324";
export const BIBLE_COVER_LABEL = "Holy Bible — multi language, multi version";

/**
 * Makes a bundled image fill its frame exactly. On web an image bundled with the
 * app otherwise keeps its natural pixel size and the frame shows only a
 * zoomed-in part of it (absoluteFill alone is not enough).
 */
export const ARTWORK_FILL = { position: "absolute" as const, top: 0, left: 0, width: "100%" as const, height: "100%" as const };
