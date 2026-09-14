// Kingdom Stories — genuine, well-documented church history, written for
// this site rather than pulled from the app (no public Kingdom Stories API
// exists yet — see the project's Stage 1 architecture notes). Categories
// match the app's real 13-category taxonomy (migration 152_kingdom_stories).

export type KingdomStory = {
  slug: string;
  category: string;
  contentType: string;
  title: string;
  subtitle: string;
  period: string;
  body: string[];
};

export const KINGDOM_STORIES: KingdomStory[] = [
  {
    slug: "welsh-revival-1904",
    category: "Revival",
    contentType: "Historical event",
    title: "When the Fire Spread",
    subtitle: "The Welsh Revival, 1904–1905",
    period: "1904–1905, Wales",
    body: [
      "It began in small prayer meetings in Loughor, Wales, under a young former coal miner named Evan Roberts. Within months, the revival had spread across the country — chapels filled past capacity, coal mines fell quiet as workers stopped to pray, and tens of thousands professed faith in a matter of weeks.",
      "There was no advertising campaign behind it, no single organizing institution. Reports of what was happening in Wales traveled by letter and by word of mouth, and the same pattern — ordinary people gathering to pray, confess, and encourage one another — appeared soon after in revivals from India to the United States.",
      "The Welsh Revival is remembered less for any one leader and more for what it revealed: that a movement of God's Spirit through ordinary believers can outpace anything an institution could plan or produce.",
    ],
  },
  {
    slug: "perpetua-and-felicity",
    category: "Persecution",
    contentType: "Historical account",
    title: "A Faith That Would Not Bend",
    subtitle: "Perpetua and Felicity, Carthage",
    period: "c. 203 AD, Roman North Africa",
    body: [
      "Perpetua was a young mother of noble birth in Roman Carthage; Felicity was enslaved and pregnant. Both were catechumens — new believers preparing for baptism — when they were arrested during a wave of persecution under Emperor Septimius Severus.",
      "What survives from their imprisonment is one of the earliest first-person accounts in Christian history: Perpetua's own prison diary, describing her father's pleading, her visions, and her steady refusal to renounce her faith even under threat of death in the arena.",
      "Their story endured for centuries in the early church specifically because it was ordinary believers, not bishops or theologians, who modeled what it meant to belong to Christ before belonging to anything — or anyone — else.",
    ],
  },
  {
    slug: "william-carey-modern-missions",
    category: "Missions",
    contentType: "Historical figure",
    title: "The Cobbler Who Would Not Stop",
    subtitle: "William Carey and the birth of the modern missions movement",
    period: "1793 onward, India",
    body: [
      "William Carey trained as a shoemaker in England before he ever set foot on a ship. He had no formal theological credential and little support at first — his own missionary society was born out of a single sermon and a handful of committed friends who pooled what little they had.",
      "In India, Carey spent decades translating Scripture into Bengali and other regional languages, founded a college, and helped end practices like widow-burning — but the work that outlasted him most was quieter: training Indian believers to carry the gospel further than any one missionary could reach alone.",
      "Carey is often called the father of modern Protestant missions not because he did the work himself, but because he modeled a pattern that has repeated ever since — one faithful learner, multiplying.",
    ],
  },
];
