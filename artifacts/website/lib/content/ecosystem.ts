// The P2P ecosystem — the ten domains explained publicly on /experience and
// summarized on the homepage. Purpose + 2-3 sentence explanation each, per
// the "editorial storytelling, not SaaS feature cards" instruction.

export type EcosystemDomain = {
  slug: string;
  name: string;
  purpose: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
};

export const ECOSYSTEM_DOMAINS: EcosystemDomain[] = [
  {
    slug: "scripture",
    name: "Scripture",
    purpose: "The foundation everything else is tested against.",
    body: "Every module in Kingdom School, every Plan, every discussion carries a root Scripture. P2P doesn't start with an opinion and look for a verse to support it — it starts with the text.",
    ctaLabel: "Why Scripture matters",
    ctaHref: "/why-p2p",
  },
  {
    slug: "discipleship",
    name: "Discipleship",
    purpose: "Kingdom School — a sequential path — and Plans, a topical library.",
    body: "Peer-to-Peer Orientation, The Gospel & Salvation, The Christian Foundation: one continuous path that unlocks a lesson at a time, alongside a library of Plans across ten life areas you can browse independently.",
    ctaLabel: "Preview the curriculum",
    ctaHref: "/explore/curriculum",
  },
  {
    slug: "prayer",
    name: "Prayer",
    purpose: "Pray the Word — curated Scripture-prayer paths and real coordination.",
    body: "Not a reaction button. A personal prayer library, guided Scripture-prayer sequences, and a real way to ask someone to pray with you, not just at you.",
    ctaLabel: "See Kingdom Wins",
    ctaHref: "/explore/wins",
  },
  {
    slug: "people",
    name: "People",
    purpose: "Smart matching, groups, and discovery — relationship first.",
    body: "A peer who shares your language and season of life. A group to study with. A way to find and be found — always in service of an actual relationship, never a feed to scroll.",
    ctaLabel: "For Individuals",
    ctaHref: "/for-individuals",
  },
  {
    slug: "families",
    name: "Families",
    purpose: "A household gathering around Scripture together, in real time.",
    body: "A Shepherd leads a real, synchronized gathering — shared Scripture, shared prayer, shared media. A Family Journey tracks what actually happened. No rankings, no spiritual points.",
    ctaLabel: "For Families",
    ctaHref: "/for-families",
  },
  {
    slug: "churches",
    name: "Churches",
    purpose: "A free discipleship portal for the local church.",
    body: "Cohorts, announcements, shared learning goals, and Church Grove — a congregation-wide view of growth with no individual singled out. Completely free, always.",
    ctaLabel: "For Churches",
    ctaHref: "/for-churches",
  },
  {
    slug: "missions",
    name: "Missions",
    purpose: "Real mission fields and stories, organized by focus.",
    body: "Evangelism, bible translation, the persecuted church, digital missions — real content organized by what it's actually for, never a fabricated activity map or invented country count.",
    ctaLabel: "Explore Missions",
    ctaHref: "/explore/missions",
  },
  {
    slug: "kingdom-stories",
    name: "Kingdom Stories",
    purpose: "Editorial stories from the global church.",
    body: "Revival, history, persecution, the people God has used — curated, not user-submitted. A documentary archive, not a feed.",
    ctaLabel: "Explore Kingdom Stories",
    ctaHref: "/explore/stories",
  },
  {
    slug: "kingdom-wins",
    name: "Kingdom Wins",
    purpose: "Personal testimonies, shared with consent.",
    body: "A guided way to tell what God has done — reviewed before it's shared, never for the author's own recognition. One story encourages another.",
    ctaLabel: "Explore Kingdom Wins",
    ctaHref: "/explore/wins",
  },
  {
    slug: "gatherings",
    name: "Gatherings",
    purpose: "Real-time study and prayer, together.",
    body: "A Bible study session, a family worship gathering, a church-wide call — different scales of the same idea: discipleship happening in real time, with real people, not asynchronously through a feed.",
    ctaLabel: "See how it works",
    ctaHref: "/how-it-works",
  },
];
