---
name: P2P growth video and forest stage transition
description: How "Watch your growth" video segments map to stages, and how the one-time forest transition is tracked and triggered.
---

The growth video (75.6s) only depicts one tree's lifecycle and has no forest imagery, so it only backs stages 0-3 (Dormant Seed 0:00-0:20, Sprout 0:20-0:40, Young Tree 0:40-0:45, Fruitful Tree 0:45-75.6). Stages 4-5 (Forest Builder / Forest of Nations) never play video — "Watch your growth" instead routes to the Personal Forest tab.

**Why:** the source footage is a stock avocado seed-to-tree clip with no multi-tree/forest shots, confirmed by frame extraction; user gave fixed segment timestamps to use anyway rather than sourcing new footage.

**How to apply:** `getWatchGrowthPlan(stageIndex, prevStageIndex, hasSeenForestTransition)` in `constants/growthVideo.ts` is the single source of truth for this branching (segment / levelup-video / forest-transition / forest-direct). The one-time particle transition into the forest is gated by an AsyncStorage key per user (`forest_transition_seen_{userId}`), not a DB column — it only needs to survive across app opens, not devices.

Forest Builder vs Forest of Nations are NOT visually distinct screens — both render the same Personal Forest tab; the differentiation is a banner driven by real data (`hasDiscipleMaker`, `countriesReached.length`) computed via BFS over `p2p_discipleship_links` (see `loadForestNetwork` in DataContext.tsx), keyed off which of stage index 4 vs 5 the user is in.
