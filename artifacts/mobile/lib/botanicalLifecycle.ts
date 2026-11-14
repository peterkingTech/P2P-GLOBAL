// The apple tree's complete natural lifecycle (used by HOW MY TREE GROWS, app/botanical) with the owner's Meshy models
// (registry: lib/growthTreeAssets.ts BOTANICAL_REGISTRY). Teaching only: these phases are what any apple
// tree goes through in a year. They are NOT participant stages, never applied to a person's tree on a
// schedule, and never count toward anything. Seasons (dormant bud, June drop, autumn leaf) are nature's
// rhythm — never inactivity, loss or decline.
// The botanical notes are plain, well-established horticulture (no claims beyond that).

export interface LifecycleItem { asset: string; name: string; note: string }
export interface LifecycleSection { id: string; title: string; intro: string; items: LifecycleItem[] }

export const APPLE_LIFECYCLE: LifecycleSection[] = [
  { id: "seed", title: "Seed and roots", intro: "Everything begins below ground.", items: [
    { asset: "asset-00-germinating-seed", name: "Germinating seed", note: "The seed coat splits and the first root grows downward. (The same model as the Seed stage.)" },
    { asset: "asset-micro-5-active-root-tip", name: "Active root tip", note: "The pale, growing tip of a root takes up water and nutrients." },
    { asset: "extra-roots-young", name: "Young roots", note: "Fine roots spread out from a central taproot." },
    { asset: "extra-roots-established", name: "Established roots", note: "Woody lateral roots anchor the tree, with fine rootlets feeding it." },
    { asset: "extra-roots-deep", name: "Deep roots", note: "An old tree's roots form a wide, deep web that holds it through storms and drought." },
  ] },
  { id: "buds", title: "Buds and shoots", intro: "Each spring, growth starts from buds formed the year before.", items: [
    { asset: "asset-micro-6-dormant-winter-bud", name: "Dormant winter bud", note: "In winter the buds rest under protective scales. Resting is part of the year, not a sign of decline." },
    { asset: "asset-micro-1-green-tip-bud", name: "Green tip", note: "In early spring the bud scales part and the first green leaf tips show." },
    { asset: "asset-micro-3-unfurling-shoot-tip", name: "Unfurling shoot", note: "New shoots lengthen and their leaves unfold." },
    { asset: "asset-06-fruiting-spur-socket", name: "Fruiting spur", note: "Short woody shoots where an apple tree carries its blossom and fruit year after year." },
  ] },
  { id: "leaves", title: "Leaves", intro: "Leaves feed the tree through the growing season.", items: [
    { asset: "asset-07-single-leaf-particle", name: "A single leaf", note: "An apple leaf: oval, finely toothed at the edge, with a clear network of veins." },
    { asset: "extra-leaf-cluster-small", name: "Leaves on a twig", note: "Leaves grow in small clusters along the shoots and spurs." },
    { asset: "extra-leaf-cluster-dense", name: "Dense foliage", note: "By summer the canopy is full of overlapping leaves." },
    { asset: "asset-micro-9-golden-autumn-leaf", name: "Autumn leaf", note: "In autumn the leaves turn golden and fall as the tree prepares to rest. It is a season, not a loss." },
  ] },
  { id: "blossom", title: "Blossom", intro: "Apple blossom opens in spring; bees carry pollen between flowers.", items: [
    { asset: "asset-micro-2-pink-bud-cluster", name: "Pink bud cluster", note: "Flower buds separate and show pink before they open." },
    { asset: "asset-micro-7-balloon-stage-bud", name: "Balloon bud", note: "The petals swell like a balloon just before the flower opens." },
    { asset: "asset-apple-blossoms", name: "Blossom", note: "Open blossom: white and pale pink petals around yellow stamens." },
    { asset: "asset-micro-4-petal-fall-fruitlet", name: "Petal fall", note: "Petals drop, and pollinated flowers begin to form tiny fruit." },
  ] },
  { id: "fruit", title: "From fruitlet to ripe apple", intro: "Through the summer an apple grows, sweetens and changes colour.", items: [
    { asset: "asset-apple-stage-1-fruitlet", name: "Fruitlet", note: "A tiny green apple, just formed." },
    { asset: "asset-micro-8-june-drop-fruitlet", name: "June drop", note: "In early summer the tree naturally sheds some fruitlets so the rest can grow well. It is thinning, not failure." },
    { asset: "asset-04c-young-green-applelet", name: "Young applelet", note: "The young apple swells and firms." },
    { asset: "asset-apple-stage-2-green", name: "Green apple", note: "Full-sized but not yet ripe." },
    { asset: "asset-apple-stage-3-yellow-green", name: "Turning yellow-green", note: "As it ripens, starch turns to sugar and the skin begins to change colour." },
    { asset: "asset-apple-stage-4-golden-yellow", name: "Golden", note: "Golden colour shows as the apple nears ripeness." },
    { asset: "asset-04d-blushed-apple", name: "Blushed", note: "In sunlight many varieties develop a red blush." },
    { asset: "asset-apple-stage-5-ripe-red", name: "Ripe", note: "Ripe and ready to pick." },
    { asset: "asset-apple-stage-6-striped-red", name: "Striped variety", note: "Some varieties ripen with red and gold stripes." },
  ] },
];

export const LIFECYCLE_NOTE = "This is how any apple tree develops through the year. It is not a set of growth stages: your Growth Stage comes only from your verified milestones, and nothing here counts toward them.";
