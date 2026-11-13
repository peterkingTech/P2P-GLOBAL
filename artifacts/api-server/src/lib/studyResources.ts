// Deep Study resources (AO Lab "Free Use Bible API") — WHICH may be shown, and how each must be credited.
//
// The live catalogue (/api/available_datasets.json, /api/available_commentaries.json) says what EXISTS.
// This registry says what P2P Global has REVIEWED and may show. A resource that is in the catalogue but not
// here is never returned to the app ("pending licence review") — so nothing with an unresolved licence can
// quietly become available. Each resource keeps its own licence: there is no blanket licence for the API.
//
// Rules applied to every resource (licence-safe for public domain, CC BY 4.0 and CC BY-SA 4.0):
//   • shown as published — never translated, summarised, merged or edited by P2P Global;
//   • the provider's own notice is kept ("Changes were made to the data to fit the Free Use Bible API
//     format") and P2P Global's own change is stated: re-formatted for display only, wording unchanged;
//   • CC BY-SA material (Tyndale Open Study Notes, Theographic) is displayed unmodified with its licence and
//     never combined into a new derivative work; every display links to the original source and licence;
//   • English-only resources are labelled as English.
// Last reviewed: 2026-11-12 against the live catalogue.

export type StudyKind = "commentary" | "interlinear" | "lexicon" | "cross_references" | "people_places" | "reference";

export interface StudyResource {
  id: string;
  kind: StudyKind;
  /** Display name and author / source, as the provider names them. */
  name: string;
  author: string;
  licence: { name: string; url: string };
  /** The attribution line shown with every use (the rights holder's own wording where they give one). */
  attribution: string;
  /** The original source, linked wherever the resource is shown (STEPBible REQUIRES its credit be linked). */
  source: { label: string; url: string };
  /** CC BY-SA: share-alike applies to any derivative (P2P makes none; display only). */
  shareAlike: boolean;
  /** Translation of the content is NOT permitted by default — needs a separate review. */
  mayTranslate: false;
  /** Reviewed and allowed to be shown. */
  eligible: boolean;
  /** Where the licence was verified at its PRIMARY source (not only the provider's catalogue), and when. */
  verified: { on: string; at: string; finding: string };
  note?: string;
  /** How it reaches P2P Global when not through AO Lab's API (e.g. a CrossWire SWORD module bundled with the server). */
  via?: { label: string; url: string };
}

const PD = { name: "Public Domain (Public Domain Mark 1.0)", url: "https://creativecommons.org/publicdomain/mark/1.0/" };
const BY = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
const BYSA = { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" };
const REVIEWED = "2026-11-12";
/** Public-domain historical works: authors (and, for translations, translators) long dead; editions before 1900. */
const pdWork = (finding: string, sourceLabel: string, sourceUrl: string) => ({
  source: { label: sourceLabel, url: sourceUrl }, verified: { on: REVIEWED, at: sourceUrl, finding },
});

export const STUDY_RESOURCES: Record<string, StudyResource> = {
  "bsb-interlinear": {
    id: "bsb-interlinear", kind: "interlinear", name: "Berean Standard Bible Interlinear", author: "Berean Bible Translation Committee",
    licence: { name: "Public domain (dedicated 30 April 2023)", url: "https://berean.bible/terms.htm" },
    // Berean's own suggested notice ("appreciated but not required").
    attribution: "The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain.",
    source: { label: "berean.bible", url: "https://berean.bible" }, shareAlike: false, mayTranslate: false, eligible: true,
    verified: { on: REVIEWED, at: "https://berean.bible/terms.htm", finding: "Berean Bible texts, including the Berean Interlinear Bible, dedicated to the public domain on 30 April 2023; all uses freely permitted. Request honoured: the Berean name is used only for the verbatim text (we change formatting, never wording)." },
    note: "Aligned to the Berean Standard Bible. Glosses are brief English renderings, not full translations of the original words.",
  },
  "stepbible-lexicon": {
    id: "stepbible-lexicon", kind: "lexicon", name: "STEPBible Brief Lexicons (TBESH, TBESG)", author: "STEP Bible / Tyndale House, Cambridge",
    licence: BY,
    // Required: credit to "STEP Bible" linked to www.STEPBible.org.
    attribution: "Lexicon data from STEP Bible (www.STEPBible.org): Translators Brief lexicons of Extended Strongs for Hebrew and Greek (TBESH, TBESG), created by Tyndale House, Cambridge. CC BY 4.0.",
    source: { label: "STEP Bible", url: "https://www.STEPBible.org" }, shareAlike: false, mayTranslate: false, eligible: true,
    verified: { on: REVIEWED, at: "https://github.com/STEPBible/STEPBible-Data", finding: "Repository licence CC BY 4.0. Condition: credit it to \"STEP Bible\" linked to www.STEPBible.org (done on every lexicon screen). Changes must be recorded — none are made to the wording." },
    note: "Brief lexicons — short definitions, not a complete critical dictionary.",
  },
  "open-cross-ref": {
    id: "open-cross-ref", kind: "cross_references", name: "Bible Cross References", author: "OpenBible.info",
    licence: BY, attribution: "Cross references from OpenBible.info, licensed CC BY 4.0.",
    source: { label: "OpenBible.info", url: "https://www.openbible.info/labs/cross-references/" }, shareAlike: false, mayTranslate: false, eligible: true,
    verified: { on: REVIEWED, at: "https://www.openbible.info/labs/cross-references/", finding: "Content licensed under Creative Commons Attribution 4.0. Only the verse references are used — never the site's ESV quotations (© Crossway)." },
    note: "Ranked by OpenBible.info's community votes; a higher score means more people found the link helpful.",
  },
  theographic: {
    id: "theographic", kind: "people_places", name: "Theographic Bible Metadata", author: "Robert Rouse",
    licence: BYSA, attribution: "People, places and events from Theographic Bible Metadata by Robert Rouse, licensed CC BY-SA 4.0.",
    source: { label: "Theographic Bible Metadata", url: "https://github.com/robertrouse/theographic-bible-metadata" }, shareAlike: true, mayTranslate: false, eligible: true,
    verified: { on: REVIEWED, at: "https://github.com/robertrouse/theographic-bible-metadata", finding: "Repository licence CC-BY-SA-4.0. Shown as published (names, kinds, verses); no derivative dataset is made or redistributed." },
    note: "Shown as published. Dates in this dataset follow one traditional chronology and are not shown.",
  },
  // Commentaries: public-domain historical works, plus Tyndale's CC BY-SA study notes.
  "adam-clarke": { id: "adam-clarke", kind: "commentary", name: "Adam Clarke Bible Commentary", author: "Adam Clarke (1762–1832)", licence: PD, attribution: "Adam Clarke, Commentary on the Holy Bible (1810–1826) — public domain.", shareAlike: false, mayTranslate: false, eligible: true,
    ...pdWork("Published 1810–1826; author died 1832. Public domain worldwide.", "Adam Clarke (Wikipedia)", "https://en.wikipedia.org/wiki/Adam_Clarke") },
  "jamieson-fausset-brown": { id: "jamieson-fausset-brown", kind: "commentary", name: "Jamieson-Fausset-Brown Bible Commentary", author: "Robert Jamieson, A. R. Fausset, David Brown", licence: PD, attribution: "Jamieson, Fausset and Brown, Commentary Critical and Explanatory on the Whole Bible (1871) — public domain.", shareAlike: false, mayTranslate: false, eligible: true,
    ...pdWork("Published 1871; all three authors died before 1900. Public domain worldwide.", "Jamieson-Fausset-Brown (Wikipedia)", "https://en.wikipedia.org/wiki/Jamieson-Fausset-Brown_Bible_Commentary") },
  "john-calvin": { id: "john-calvin", kind: "commentary", name: "John Calvin's Commentaries", author: "John Calvin (1509–1564); English by the Calvin Translation Society", licence: PD, attribution: "John Calvin's Commentaries, Calvin Translation Society English text (1843–1855), via CCEL — public domain.", shareAlike: false, mayTranslate: false, eligible: true,
    ...pdWork("Calvin Translation Society English texts, 1843–1855; CCEL identifies its electronic Calvin commentaries as public domain and usable for any purpose.", "CCEL", "https://www.ccel.org/ccel/calvin/commentaries.html") },
  "john-gill": { id: "john-gill", kind: "commentary", name: "John Gill Bible Commentary", author: "John Gill (1697–1771)", licence: PD, attribution: "John Gill, Exposition of the Entire Bible (1746–1763) — public domain.", shareAlike: false, mayTranslate: false, eligible: true,
    ...pdWork("Published 1746–1763; author died 1771. Public domain worldwide.", "John Gill (Wikipedia)", "https://en.wikipedia.org/wiki/John_Gill_(theologian)") },
  "keil-delitzsch": { id: "keil-delitzsch", kind: "commentary", name: "Carl Friedrich Keil and Franz Delitzsch Old Testament Commentary", author: "Carl Friedrich Keil (1807–1888), Franz Delitzsch (1813–1890); English translation (T&T Clark)", licence: PD, attribution: "Keil and Delitzsch, Commentary on the Old Testament, English translation published by T&T Clark (1866–1891) — public domain.", shareAlike: false, mayTranslate: false, eligible: true,
    ...pdWork("German originals 1861–1875 (authors died 1888 and 1890); English translation 1866–1891 by 19th-century translators. Public domain.", "worthy.bible", "https://worthy.bible/commentaries/keil-delitzsch-commentary") },
  "matthew-henry": { id: "matthew-henry", kind: "commentary", name: "Matthew Henry Bible Commentary", author: "Matthew Henry (1662–1714)", licence: PD, attribution: "Matthew Henry, Commentary on the Whole Bible (1706–1721) — public domain.", shareAlike: false, mayTranslate: false, eligible: true,
    ...pdWork("Published 1706–1721; author died 1714. Public domain worldwide.", "Matthew Henry (Wikipedia)", "https://en.wikipedia.org/wiki/Matthew_Henry") },
  tyndale: {
    id: "tyndale", kind: "commentary", name: "Tyndale Open Study Notes", author: "Tyndale House Publishers (Tyndale Open Resources)", licence: BYSA,
    attribution: "Tyndale Open Study Notes © Tyndale House Publishers, Tyndale Open Resources. Licensed under a Creative Commons Attribution-ShareAlike 4.0 International License.",
    source: { label: "Tyndale Open Resources", url: "https://tyndaleopenresources.com/" }, shareAlike: true, mayTranslate: false, eligible: true,
    verified: { on: REVIEWED, at: "https://tyndaleopenresources.com/", finding: "\"This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License.\" Shown unmodified; no derivative is made, so share-alike obligations are not triggered beyond attribution and the licence link." },
    note: "Shown unmodified under CC BY-SA 4.0.",
  },
  // Not from AO Lab: bundled with the server (data/reference-easton.txt, scripts/build-reference-index.mjs).
  easton: {
    id: "easton", kind: "reference", name: "Easton's Bible Dictionary (1897)", author: "M. G. Easton",
    licence: PD,
    attribution: "From Easton's Bible Dictionary by M. G. Easton (Illustrated Bible Dictionary, 3rd edition, Thomas Nelson, 1897). Public domain. Text from the CrossWire SWORD module (v2.0.1), from the CCEL etext; the illustrations are not included.",
    source: { label: "CrossWire Bible Society", url: "https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Easton" }, shareAlike: false, mayTranslate: false, eligible: true,
    verified: { on: "2026-11-13", at: "https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Easton", finding: "Module .conf: DistributionLicense=Public Domain, TextSource=CCEL, \"Public Domain -- Copy Freely\"; CCEL's own info file (ccel.org/ccel/easton/ebd/easton-info.txt) carries the same notice. The download is pinned by SHA-256." },
    note: "Written in 1897 and not revised since: dates, places and scholarship reflect that time.",
    via: { label: "CrossWire SWORD module", url: "https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Easton" },
  },
};

/** The change P2P Global makes to every resource (stated wherever CC BY / BY-SA requires changes to be indicated). */
export const P2P_CHANGES = "Re-formatted for display in P2P Global; wording unchanged.";

export const isEligible = (id: string) => STUDY_RESOURCES[id]?.eligible === true;

/** Languages actually written right to left (ISO 639-3 and common 639-1 codes). */
const RTL_LANGS = new Set(["heb", "he", "arb", "ara", "ar", "pes", "fas", "fa", "urd", "ur", "syr", "arc", "yid", "yi", "pus", "ps", "snd", "sd", "uig", "ug", "div", "dv"]);
/**
 * Text direction from the LANGUAGE, not the provider's flag: several English commentaries are listed as
 * "rtl" in the live catalogue, which is wrong for English. Original-language words use their own rule
 * (Hebrew and Aramaic right to left, Greek left to right).
 */
export function directionFor(language: string | null | undefined): "ltr" | "rtl" {
  return RTL_LANGS.has(String(language ?? "").toLowerCase()) ? "rtl" : "ltr";
}
export const originalDirection = (lang: string) => (lang === "hebrew" || lang === "aramaic" ? "rtl" : "ltr");

/** Language label: honest about English-only resources. */
export function languageLabel(code: string | null | undefined, englishName: string | null | undefined): string {
  const c = String(code ?? "").toLowerCase();
  if (c === "eng" || c === "en") return "English";
  return englishName || code || "Unknown";
}

/** What the app shows for a resource: its credit, licence and notices. */
export function creditFor(id: string, providerNotice: string | null = null) {
  const r = STUDY_RESOURCES[id];
  if (!r) return null;
  return {
    id: r.id, name: r.name, author: r.author, attribution: r.attribution, licence: r.licence, shareAlike: r.shareAlike,
    providerNotice: providerNotice || null, changes: P2P_CHANGES, note: r.note ?? null,
    /** The original source, always shown as a link (STEPBible requires "STEP Bible" linked to its site). */
    origin: r.source,
    /** How it reaches P2P Global (AO Lab's API: MIT licensed, adds no restrictions of its own). */
    via: r.via ?? { label: "Free Use Bible API (AO Lab)", url: "https://bible.helloao.org" },
    licenceVerifiedOn: r.verified.on,
  };
}
