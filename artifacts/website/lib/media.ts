// Media manifest — the single source of truth for every real photo/video
// slot on the site. Every entry today has status "placeholder" because no
// real P2P-owned or licensed media exists in the project yet (confirmed:
// zero files under public/media/ besides .gitkeep). Nothing here should be
// read as "this image exists" — MediaSlot.status is the honest signal.
//
// When real media arrives: drop the file into the matching public/media/
// subfolder, flip status to "p2p-owned" | "licensed", and fill in
// source/creator/attribution. No layout change should be required — every
// consumer of this manifest (<MediaPlaceholder>, <RealImage>, <RealVideo>)
// reads the same shape.

export type MediaStatus = "available" | "placeholder" | "pending" | "licensed" | "p2p-owned" | "demo";
export type MediaType = "image" | "video";
export type MediaOrientation = "landscape" | "portrait" | "square";
export type FocalPoint = "center" | "top" | "bottom" | "left" | "right";

export type MediaSlot = {
  id: string;
  type: MediaType;
  status: MediaStatus;
  subject: string;
  mood: string;
  aspectRatio: string; // e.g. "16/9"
  orientation: MediaOrientation;
  alt: string;
  caption?: string;
  avoid?: string;
  page: string;
  section: string;
  required?: boolean; // defaults to true (launch-blocking) when omitted; set false for nice-to-have slots
  // Populated only once status moves past "placeholder":
  filename?: string;
  source?: string;
  creator?: string;
  attribution?: string;
  credit?: string;
  license?: string;
  sourceUrl?: string;
  usageNotes?: string;
  focalPoint?: FocalPoint;
  poster?: string; // video only
  duration?: number; // seconds, video only
  priority?: boolean; // eligible for eager/priority load (above-the-fold only)
  url?: string; // status "demo" only — a hotlinked, properly licensed temporary stock asset
  tone?: "forest" | "ember" | "water" | "parchment"; // fallback <PhotoPanel> palette when no demo url exists
};

// ---------------------------------------------------------------------
// Phase 4 — visual prototype. A small number of slots above now carry
// status "demo": a real, properly licensed temporary stock photo (never
// P2P-owned, never implied to be a real P2P member/place) used so the
// site can be experienced with real photography instead of a gray box.
// Every one is recorded below with its source/creator/license, exactly
// like a "pending" or "placeholder" slot would be once real media
// arrives — swapping the demo photo for real P2P photography later is
// the same one-line status change described in the file header.
export const DEMO_MEDIA: Record<string, { url: string; creator: string; source: string; license: string; sourceUrl: string }> = {
  P2P_HOME_SCRIPTURE_001: {
    url: "https://upload.wikimedia.org/wikipedia/commons/6/62/Aaron_Burden_2016-01-25_%28Unsplash_fgmf2Eyrwm4%29.jpg",
    creator: "Aaron Burden",
    source: "Unsplash, via Wikimedia Commons",
    license: "Unsplash License (free to use)",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Aaron_Burden_2016-01-25_(Unsplash_fgmf2Eyrwm4).jpg",
  },
  P2P_HOME_CHURCH_001: {
    url: "https://upload.wikimedia.org/wikipedia/commons/b/bf/Fetu_Ao_Lima_%28Morning_Star_Church%29%2C_Congregational_Christian_Church_of_Tuvalu.jpg",
    creator: "Ryan Goebel",
    source: "Wikimedia Commons",
    license: "CC BY 2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Fetu_Ao_Lima_(Morning_Star_Church),_Congregational_Christian_Church_of_Tuvalu.jpg",
  },
};

export const MEDIA_MANIFEST: MediaSlot[] = [
  {
    id: "P2P_HOME_HERO_001",
    type: "video",
    status: "placeholder",
    subject: "People, Scripture, conversation, prayer, and community, cut together as a single opening moment.",
    mood: "Cinematic, quiet, human, documentary — not corporate, not staged.",
    aspectRatio: "16/9",
    orientation: "landscape",
    alt: "A short cinematic sequence introducing people learning, growing, and helping one another.",
    avoid: "Stock-footage energy, upbeat corporate music, staged smiles.",
    page: "/",
    section: "Scene 01 — Arrival",
    tone: "water",
  },
  {
    id: "P2P_HOME_SCRIPTURE_001",
    type: "image",
    status: "demo",
    subject: "An open Bible, hands, natural light — someone reading, not posing.",
    mood: "Warm, quiet, intimate.",
    aspectRatio: "4/5",
    orientation: "portrait",
    alt: "An open Bible with a person's hands resting on the page in natural light.",
    avoid: "Studio-lit prop Bibles, dramatic backlighting.",
    page: "/",
    section: "Scene 04 — Scripture",
    tone: "ember",
  },
  {
    id: "P2P_HOME_PEOPLE_001",
    type: "image",
    status: "placeholder",
    subject: "Two people studying Scripture together, mid-conversation.",
    mood: "Warm, authentic, intimate documentary photography.",
    aspectRatio: "16/9",
    orientation: "landscape",
    alt: "Two people sitting together studying Scripture in conversation.",
    avoid: "Staged smiles, corporate stock imagery, artificial-looking faces.",
    page: "/",
    section: "Scene 06 — People",
    tone: "forest",
  },
  {
    id: "P2P_HOME_FAMILY_001",
    type: "image",
    status: "placeholder",
    subject: "A family reading Scripture together at home.",
    mood: "Authentic documentary — a real home, not a staged set.",
    aspectRatio: "4/3",
    orientation: "landscape",
    alt: "A family sitting together reading Scripture at home.",
    avoid: "Perfectly staged stock-family imagery.",
    page: "/",
    section: "Scene 11 — Families",
    tone: "ember",
  },
  {
    id: "P2P_HOME_CHURCH_001",
    type: "image",
    status: "demo",
    subject: "A local church community gathered together.",
    mood: "Warm, communal, unposed.",
    aspectRatio: "16/9",
    orientation: "landscape",
    alt: "A local church congregation gathered together.",
    page: "/",
    section: "Scene 12 — Churches",
    tone: "forest",
  },
  {
    id: "P2P_HOME_MISSION_001",
    type: "image",
    status: "placeholder",
    subject: "A real mission context — service, people, place.",
    mood: "Respectful documentary, not a tourism photo.",
    aspectRatio: "16/9",
    orientation: "landscape",
    alt: "People serving together in a real mission context.",
    page: "/",
    section: "Scene 13 — Missions",
    tone: "water",
  },
  {
    id: "P2P_LEARN_001",
    type: "image",
    status: "placeholder",
    subject: "One person studying Scripture, alone or with a guide.",
    mood: "Focused, quiet.",
    aspectRatio: "4/5",
    orientation: "portrait",
    alt: "A person studying Scripture attentively.",
    page: "/how-it-works",
    section: "Learn",
  },
  {
    id: "P2P_GROW_001",
    type: "image",
    status: "placeholder",
    subject: "A person in a moment of reflection, prayer, or quiet growth.",
    mood: "Still, honest.",
    aspectRatio: "4/5",
    orientation: "portrait",
    alt: "A person in quiet reflection or prayer.",
    page: "/how-it-works",
    section: "Grow",
  },
  {
    id: "P2P_HELP_001",
    type: "image",
    status: "placeholder",
    subject: "One person helping another understand Scripture — natural conversation.",
    mood: "Warm, relational.",
    aspectRatio: "4/5",
    orientation: "portrait",
    alt: "One person explaining something to another in conversation.",
    page: "/how-it-works",
    section: "Help",
  },
  {
    id: "P2P_MULTIPLY_001",
    type: "image",
    status: "placeholder",
    subject: "A small group spanning multiple generations, studying together.",
    mood: "Authentic community, not staged.",
    aspectRatio: "4/5",
    orientation: "portrait",
    alt: "A small multigenerational group studying Scripture together.",
    page: "/how-it-works",
    section: "Multiply",
  },
  {
    id: "P2P_INDIVIDUAL_001",
    type: "image",
    status: "placeholder",
    subject: "A single honest portrait — not posed for marketing.",
    mood: "Documentary portraiture.",
    aspectRatio: "4/5",
    orientation: "portrait",
    alt: "A portrait of a person on their discipleship journey.",
    page: "/for-individuals",
    section: "Hero",
  },
  {
    id: "P2P_FAMILY_001",
    type: "image",
    status: "placeholder",
    subject: "Family discipleship — a household gathered together.",
    mood: "Authentic, warm.",
    aspectRatio: "16/9",
    orientation: "landscape",
    alt: "A family gathered together for shared study and prayer.",
    page: "/for-families",
    section: "Hero",
  },
  {
    id: "P2P_CHURCH_001",
    type: "image",
    status: "placeholder",
    subject: "A church community engaged in discipleship together.",
    mood: "Communal, real.",
    aspectRatio: "16/9",
    orientation: "landscape",
    alt: "A church community gathered for discipleship.",
    page: "/for-churches",
    section: "Hero",
  },
  {
    id: "P2P_MISSION_001",
    type: "image",
    status: "placeholder",
    subject: "Real mission-field service and community.",
    mood: "Respectful documentary.",
    aspectRatio: "16/9",
    orientation: "landscape",
    alt: "People engaged in mission service within a real community.",
    page: "/explore/missions",
    section: "Hero",
  },
  {
    id: "P2P_GLOBAL_001",
    type: "image",
    status: "placeholder",
    subject: "A real global/cultural context reflecting the diversity of the global church.",
    mood: "Documentary, dignified.",
    aspectRatio: "16/9",
    orientation: "landscape",
    alt: "A scene reflecting the global reach of the Christian church.",
    page: "/",
    section: "Scene 17 — Habakkuk 2:14",
  },
  {
    id: "P2P_APP_001",
    type: "image",
    status: "pending",
    subject: "Actual P2P application screenshot.",
    mood: "N/A — must be a real screenshot, not a fabricated UI mockup.",
    aspectRatio: "9/19.5",
    orientation: "portrait",
    alt: "A screenshot of the P2P mobile application.",
    avoid: "Any invented or redesigned screen not present in the real app.",
    page: "/get-the-app",
    section: "App showcase",
  },
  {
    id: "P2P_APP_VIDEO_001",
    type: "video",
    status: "pending",
    subject: "A short screen recording of the real P2P application in use.",
    mood: "Straightforward, no fabricated flows.",
    aspectRatio: "9/19.5",
    orientation: "portrait",
    alt: "A short video demonstrating the real P2P application.",
    page: "/get-the-app",
    section: "App showcase",
  },
  {
    id: "P2P_STORIES_001",
    type: "image",
    status: "placeholder",
    subject: "Editorial/documentary imagery matching a specific Kingdom Story's historical period and place.",
    mood: "Documentary, editorial.",
    aspectRatio: "3/2",
    orientation: "landscape",
    alt: "Editorial photography illustrating a Kingdom Story.",
    page: "/explore/stories",
    section: "Featured story",
  },
  {
    id: "P2P_WINS_001",
    type: "image",
    status: "pending",
    subject: "A real, consented portrait accompanying a real Kingdom Win.",
    mood: "Honest, human.",
    aspectRatio: "4/5",
    orientation: "portrait",
    alt: "A portrait of a P2P community member, used only with their consent.",
    avoid: "Any stock portrait implied to be a real P2P member.",
    page: "/explore/wins",
    section: "Testimony",
  },
  // App Showcase — real screenshots only. Screen names below match the
  // actual app's real navigation (Home/Learn/Prayer/Discover/Missions tabs,
  // Kingdom School, Family Gathering, Kingdom Stories, Kingdom Wins) per the
  // original mobile-app audit — this documents WHICH screens are needed,
  // it does not fabricate their content. All remain "pending" until a real
  // screenshot is captured from the running app.
  {
    id: "P2P_APP_SCREEN_HOME",
    type: "image",
    status: "pending",
    subject: "The app's Home tab.",
    mood: "N/A — real screenshot only.",
    aspectRatio: "9/19.5",
    orientation: "portrait",
    alt: "Screenshot of the P2P app's Home tab.",
    page: "/get-the-app",
    section: "App showcase",
  },
  {
    id: "P2P_APP_SCREEN_LEARN",
    type: "image",
    status: "pending",
    subject: "The app's Learn tab — Kingdom School.",
    mood: "N/A — real screenshot only.",
    aspectRatio: "9/19.5",
    orientation: "portrait",
    alt: "Screenshot of Kingdom School inside the P2P app.",
    page: "/get-the-app",
    section: "App showcase",
  },
  {
    id: "P2P_APP_SCREEN_PRAYER",
    type: "image",
    status: "pending",
    subject: "The app's Prayer tab — Pray the Word.",
    mood: "N/A — real screenshot only.",
    aspectRatio: "9/19.5",
    orientation: "portrait",
    alt: "Screenshot of the Prayer experience inside the P2P app.",
    page: "/get-the-app",
    section: "App showcase",
  },
  {
    id: "P2P_APP_SCREEN_FAMILY",
    type: "image",
    status: "pending",
    subject: "A Family Gathering screen.",
    mood: "N/A — real screenshot only.",
    aspectRatio: "9/19.5",
    orientation: "portrait",
    alt: "Screenshot of a Family Gathering inside the P2P app.",
    page: "/get-the-app",
    section: "App showcase",
  },
  {
    id: "P2P_APP_SCREEN_STORIES",
    type: "image",
    status: "pending",
    subject: "The Kingdom Stories screen.",
    mood: "N/A — real screenshot only.",
    aspectRatio: "9/19.5",
    orientation: "portrait",
    alt: "Screenshot of Kingdom Stories inside the P2P app.",
    page: "/get-the-app",
    section: "App showcase",
  },
  {
    id: "P2P_APP_SCREEN_WINS",
    type: "image",
    status: "pending",
    subject: "The Kingdom Wins screen.",
    mood: "N/A — real screenshot only.",
    aspectRatio: "9/19.5",
    orientation: "portrait",
    alt: "Screenshot of Kingdom Wins inside the P2P app.",
    page: "/get-the-app",
    section: "App showcase",
  },
];

export const APP_SHOWCASE_SCREEN_IDS = [
  "P2P_APP_SCREEN_HOME",
  "P2P_APP_SCREEN_LEARN",
  "P2P_APP_SCREEN_PRAYER",
  "P2P_APP_SCREEN_FAMILY",
  "P2P_APP_SCREEN_STORIES",
  "P2P_APP_SCREEN_WINS",
] as const;

export function getMediaSlot(id: string): MediaSlot | undefined {
  return MEDIA_MANIFEST.find((m) => m.id === id);
}
