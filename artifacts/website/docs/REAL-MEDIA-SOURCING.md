# Real Media Sourcing Checklist

**Auto-generated from `lib/media.ts` — do not hand-edit this file.** Regenerate with `node scripts/gen-media-doc.mjs` after changing the manifest.

Every row below is a real slot on the live site today, rendering as a labeled placeholder. Nothing marked here is fabricated — `status` is the honest signal of what actually exists.

Total slots: 25 · Placeholder: 16 · Pending (needs a real asset, e.g. app screenshots): 9

| ID | Page | Section | Type | Subject | Aspect | Status |
| -- | ---- | ------- | ---- | ------- | ------ | ------ |
| `P2P_HOME_HERO_001` | / | Scene 01 — Arrival | video | People, Scripture, conversation, prayer, and community, cut together as a single opening moment. | 16/9 | placeholder |
| `P2P_HOME_SCRIPTURE_001` | / | Scene 04 — Scripture | image | An open Bible, hands, natural light — someone reading, not posing. | 4/5 | placeholder |
| `P2P_HOME_PEOPLE_001` | / | Scene 06 — People | image | Two people studying Scripture together, mid-conversation. | 16/9 | placeholder |
| `P2P_HOME_FAMILY_001` | / | Scene 11 — Families | image | A family reading Scripture together at home. | 4/3 | placeholder |
| `P2P_HOME_CHURCH_001` | / | Scene 12 — Churches | image | A local church community gathered together. | 16/9 | placeholder |
| `P2P_HOME_MISSION_001` | / | Scene 13 — Missions | image | A real mission context — service, people, place. | 16/9 | placeholder |
| `P2P_LEARN_001` | /how-it-works | Learn | image | One person studying Scripture, alone or with a guide. | 4/5 | placeholder |
| `P2P_GROW_001` | /how-it-works | Grow | image | A person in a moment of reflection, prayer, or quiet growth. | 4/5 | placeholder |
| `P2P_HELP_001` | /how-it-works | Help | image | One person helping another understand Scripture — natural conversation. | 4/5 | placeholder |
| `P2P_MULTIPLY_001` | /how-it-works | Multiply | image | A small group spanning multiple generations, studying together. | 4/5 | placeholder |
| `P2P_INDIVIDUAL_001` | /for-individuals | Hero | image | A single honest portrait — not posed for marketing. | 4/5 | placeholder |
| `P2P_FAMILY_001` | /for-families | Hero | image | Family discipleship — a household gathered together. | 16/9 | placeholder |
| `P2P_CHURCH_001` | /for-churches | Hero | image | A church community engaged in discipleship together. | 16/9 | placeholder |
| `P2P_MISSION_001` | /explore/missions | Hero | image | Real mission-field service and community. | 16/9 | placeholder |
| `P2P_GLOBAL_001` | / | Scene 17 — Habakkuk 2:14 | image | A real global/cultural context reflecting the diversity of the global church. | 16/9 | placeholder |
| `P2P_APP_001` | /get-the-app | App showcase | image | Actual P2P application screenshot. | 9/19.5 | pending |
| `P2P_APP_VIDEO_001` | /get-the-app | App showcase | video | A short screen recording of the real P2P application in use. | 9/19.5 | pending |
| `P2P_STORIES_001` | /explore/stories | Featured story | image | Editorial/documentary imagery matching a specific Kingdom Story's historical period and place. | 3/2 | placeholder |
| `P2P_WINS_001` | /explore/wins | Testimony | image | A real, consented portrait accompanying a real Kingdom Win. | 4/5 | pending |
| `P2P_APP_SCREEN_HOME` | /get-the-app | App showcase | image | The app's Home tab. | 9/19.5 | pending |
| `P2P_APP_SCREEN_LEARN` | /get-the-app | App showcase | image | The app's Learn tab — Kingdom School. | 9/19.5 | pending |
| `P2P_APP_SCREEN_PRAYER` | /get-the-app | App showcase | image | The app's Prayer tab — Pray the Word. | 9/19.5 | pending |
| `P2P_APP_SCREEN_FAMILY` | /get-the-app | App showcase | image | A Family Gathering screen. | 9/19.5 | pending |
| `P2P_APP_SCREEN_STORIES` | /get-the-app | App showcase | image | The Kingdom Stories screen. | 9/19.5 | pending |
| `P2P_APP_SCREEN_WINS` | /get-the-app | App showcase | image | The Kingdom Wins screen. | 9/19.5 | pending |

## How to add a real asset

1. Drop the file into the matching `public/media/<category>/` subfolder.
2. In `lib/media.ts`, set that slot's `filename`, and move `status` to `"p2p-owned"` (real P2P media) or `"licensed"` (properly licensed third-party media).
3. Fill in `source`, `creator`, `attribution`, `license`, and `sourceUrl` for anything not P2P-owned.
4. Nothing else changes — `<RealImage>` / `<RealVideo>` already render the real asset automatically once `status` and `filename` are set; `<MediaPlaceholder>` stops rendering for that slot.

## What must never happen

- No slot moves to `"p2p-owned"` or `"licensed"` without a real file backing it.
- No app-screenshot slot (`P2P_APP_SCREEN_*`, `P2P_APP_001`, `P2P_APP_VIDEO_001`) is ever filled with a redesigned or invented screen — only an actual capture from the running app.
- No stock photo is marked as depicting a real P2P member, family, or church.
