// Real Kingdom School + Plans structure, sourced from the P2P-GLOBAL-clean
// migrations (106/107/111 for Kingdom School, 054 for Plans categories).
// No invented lesson content — titles/counts only, per the site's constraint
// against reproducing licensed lesson text publicly.

export const KINGDOM_SCHOOL = [
  {
    slug: "peer-to-peer-orientation",
    title: "Peer-to-Peer Orientation",
    description:
      "How P2P Global works, how Peer Guides and discipleship relationships function, and how to begin your journey on the platform.",
  },
  {
    slug: "the-gospel-and-salvation",
    title: "The Gospel & Salvation",
    description:
      "Four modules, seventeen lessons — the good news, simply stated. Who Jesus is, why He had to die, and how you can know you are saved.",
  },
  {
    slug: "the-christian-foundation",
    title: "The Christian Foundation",
    description:
      "Your identity in Christ, the Bible, prayer, the Holy Spirit, the church, water baptism, sharing your faith, and living with eternity in view.",
  },
] as const;

export const PLAN_CATEGORIES = [
  "Faith & Kingdom Living",
  "Prayer",
  "Holy Spirit",
  "Family & Relationships",
  "Identity & Salvation",
  "Marketplace & Purpose",
  "Church & Community",
  "Ministry & Leadership",
  "Spiritual Growth",
  "Healing & Freedom",
] as const;

export const PEER_SESSION_FLOW = [
  "Open in prayer",
  "Memory verse, together",
  "Read the lesson",
  "Discussion questions",
  "Life assignment",
  "Checkpoint — explain it in your own words, no notes",
  "Close in prayer for each other",
] as const;
