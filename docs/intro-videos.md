# About P2P — in-app introduction videos (2026-11-26)

Owner brief: "P2P Global — In-app video experience, About P2P library & multilingual video system", built on the owner's
instruction to use these recommendations and report afterwards, then extended the same day at the owner's request
(voice-overs, voice choice, flags, Naija Pidgin, Giggy, full-screen About P2P, device language).

**State:** committed and pushed with the owner's permission (the API auto-deploys from `main`). NOT done (each needs the
owner's approval): migrations 260 and 261, the media upload + `INTRO_VIDEOS_MEDIA_URL` on Railway, an app build,
publishing any translation. Until the media is uploaded the library says "being prepared" and no introduction is forced.

## 1. What exists (findings)

| Area | Before | Reused |
|---|---|---|
| Player | `expo-video` (`components/media/VideoPlayer.tsx`, `SplashIntro.tsx`) with native controls | `expo-video` (HLS, audio-track selection), no new dependency |
| Onboarding | `(auth)/onboarding` (language + slides) → register → intake → profile-setup → goals → journey → `get-started?intro=1` | same flow, one gate per step |
| Languages | 36 app languages (`lib/i18n.ts`), RTL ar/he/fa/ur, locale files, `lib/languageRegistry.ts` flags | same; `LanguageFlag` everywhere in the player |
| "Seen" status | phone only (AsyncStorage) | same pattern + server table (260) |
| Admin | Admin Centre roles, audit log | same roles, same audit |

## 2. Where each video appears

| # | Video | Opens by itself | Screen |
|---|---|---|---|
| 01 | The Movement Film | first opening: language, then the film, before registration ("I already have an account" still signs in) | `components/introVideo/FirstLaunchFilm.tsx` in `(auth)/onboarding` |
| 02 | The P2P Global Vision | right after registration | `(auth)/intake` |
| 03 | Welcome to P2P | Getting Started | `get-started` |
| 04 | What Is a Peer Guide? | journey step 1, before choosing a guide | `(auth)/journey` |
| 05 | A Church That Makes Disciples | first church visit / registration | `church/index`, `church/register` |
| 06 | The Bible and Deep Study | first Deep Study visit | `deep-study/index` |
| 07 | Learning in P2P | first Learning tab visit | `(tabs)/learn` |
| 08 | Discipleship Begins at Home | first Family Circle visit | `family/index` |
| 09 | Kingdom Stories | first Kingdom Stories visit | `kingdom-stories/index` |
| 10 | Kingdom School | first Kingdom School visit | `kingdom-school` |
| 11 | From Learning to Living | first completed lesson | `lesson/[id]` |

**About P2P** (all 11, always): a full screen in **More → Prayer | Discover | About P2P** (`components/introVideo/
AboutP2PLibrary.tsx`, embedded in `(tabs)/more.tsx`). `/about-p2p` (old links, Settings, admin preview `?preview=1`,
`?play=<id>`) redirects there. Wide screens: featured film beside its text, 2–3 column grid.

## 3. Viewing rules

`components/introVideo/IntroVideoPlayer.tsx` + `useIntroVideo` / `IntroVideoGate` + `lib/introVideos.ts`.

- First viewing: no skip/close, no seeking past what was watched, pause allowed, resume; completed only at the real end
  (the server also checks nearly all of it was watched).
- Later viewings: skip, close, seek, replay. "Don't show introductions automatically again" after completing (05–11).
- Accounts created before 26 Nov 2026 (`INTRO_REQUIRED_FROM`) may skip each feature introduction once.
- If the server can't be reached, an introduction is not forced. Status per account (260) + phone; pre-registration
  status moves to the account at sign-up / sign-in.

## 4. Languages, voices and the player

**One master per video, no text burned in** (engine `CLEAN=1`; the Movement Film's app build). Subtitles and on-screen
text are drawn by the app; the logo and the network's name are never translated.

| Language | Subtitles + on-screen text | First voice | Second voice (other gender) |
|---|---|---|---|
| English | original | the film's narrator (ElevenLabs) | — |
| German, French, Arabic | ✓ | the film's narrator speaking the language (ElevenLabs `eleven_v4`) | Giggy: Klaus/Anneliese · Jean-Baptiste/Marceline · Khalid/Sara |
| Igbo | ✓ | Giggy Chidi / Chiamaka | Giggy Nnamdi / Ngozi |
| Twi | ✓ | Giggy Yaw | Giggy Kofi (Giggy has men's Twi voices only) |
| Naija Pidgin (film language, not an app language) | ✓ | Giggy Gbenga / Nkem | the other of the two |

- **Voice keys:** `de` (first voice), `de-2` (second). Stream: one picture, an audio track per voice key (`NAME="de-2"`,
  `LANGUAGE="de"`); the web, which cannot switch HLS audio, plays `web-<key>.mp4` (picture copied, not re-encoded).
  `voices.json` is generated from the recordings that exist (`_ENGINE/sync_voices.py`), so the menu never offers a
  voice that is not there.
- **Player:** a language pill in the top bar — the voice's flag, the translate sign, the subtitles' flag (+ "CC"); the
  menu has **Voice** (every voice with its flag, language, narrator, man's/woman's voice) and **Subtitles**. The player
  starts in the app language; only a choice made in the menu overrides it (saved choices v2 — v1 also pinned the sound
  to English when only subtitles were chosen). Changing the voice carries on from the same moment.
- **Never the wrong language silently:** a language appears only when **Published** (`INTRO_VIDEOS_PREVIEW_ALL=1`
  on localhost only shows everything for review; refused in production).
- **Scripture on screen** is never our own translation: Luther 1912 (de), Segond 1910 (fr), Van Dyck (ar), Igbo
  Contemporary Bible (Biblica, CC BY-SA 4.0), Asante Twi (Biblica, CC BY-SA 4.0). **Naija Pidgin:** no openly licensed
  Pidgin Bible exists, so direct quotations stay in the original English (BSB/KJV), on screen and in the narration.
- Arabic narration ran ~15–19 % longer than English: 20 Arabic subtitle lines (03, 04, 06, 10) were tightened (same
  facts, incl. "more than one hundred and eighty lessons, and growing"). Voices that still run long are fitted by
  starting a little sooner / using the next pause, then ≤ 1.18× time-stretch; Giggy voices are re-recorded at Giggy's
  own speed (≤ 1.35×) instead.
- All translations: AI-assisted, **awaiting review** by fluent speakers (Igbo, Twi and Pidgin especially).

**Why Giggy for Igbo/Twi/Pidgin:** read back with Naija Speech's own Igbo speech recognition, Naija Speech's Igbo voice
slurred or garbled a third to a half of the words ("Kingdom School" → "n'indosku", "nwa ya" → "mmanya"); Giggy's was
clearly more accurate. In English, Giggy and ElevenLabs were equally clear (0 words missed). ElevenLabs lists no Igbo or
Twi voice. Samples: `P2P-GLOBAL-VIDEO-LIBRARY/_APP/voice-samples/`.

## 5. P2P Voices (the app's general voices — Kingdom School, Kingdom Stories, Deep Study…)

New provider **Giggy** (`lib/voices/providers.ts`, `GIGGY_API_TTS_KEY`, `VOICES_GIGGY=off` to switch off). Owner
2026-11-26: Igbo, Twi, Hausa, Yoruba and Naija Pidgin use **Giggy only** (`catalogue.ts GIGGY_ONLY_LANGUAGES`) — Naija
Speech, 9jaLingo, Spitch, Azure and Google voices are not offered or used for them, and a saved Naija Speech voice is
ignored. Giggy's terms allow commercial use and keeping the audio, so these voices may be cached and kept offline.
Catalogue: 20 Igbo, 7 Twi, 20 Hausa, 12 Yoruba, 27 Pidgin voices (read ten pages at a time, ~15 s cold). **Giggy needs
paid credits** — without them these languages fall back to the phone's own voice.

## 6. App language = the device's language

`lib/i18n.ts deviceLanguage()`: on a first opening (nothing saved yet) the app starts in the phone's/browser's language
when it is one of the 36 app languages (region and old codes handled: fr-CA → fr, zh-HK → zh-TW, iw → he…), otherwise
English. Not saved, so it follows the device until the person chooses; sign-up stores it on the new account. Tested:
fr-FR → French, ar-EG → Arabic, hu-HU → English. "Naijá" is now shown as **"Naija Pidgin"** (language registry).

## 7. Storage and cost

- Media (`P2P-GLOBAL-VIDEO-LIBRARY/_APP/media`, not in git): pictures ~1.6 GB; each voice adds a stream track
  (~1 MB/min) and a web copy (~10–130 MB per film) — with 13 voices the web copies dominate (~3–4 GB in all).
  Recommended later: a web HLS player (hls.js) so the web needs no per-voice copies.
- Hosting (needs approval): public Supabase bucket `p2p-about-videos`, then `INTRO_VIDEOS_MEDIA_URL` on Railway.
- Voices used 2026-11-26: ElevenLabs ~66k characters (de/fr/ar first voices); Giggy ~150k characters (Igbo/Twi/Pidgin,
  second voices) — the free monthly credits ran out; the owner subscribed.

## 8. Database (proposed, NOT applied)

- **260** `p2p_intro_video_views`, `p2p_intro_video_assets`, `p2p_intro_video_asset_events`, `p2p_intro_video_events`.
  Without it everything works from the phone's copy and the review screen is read-only.
- **261** widens `p2p_voice_catalogue`'s provider check (naijalingo, naijaspeech, giggy) so voice lists survive restarts.

## 9. Files

App: `lib/introVideos.ts`, `components/introVideo/{IntroVideoPlayer,useIntroVideo,FirstLaunchFilm,AboutP2PLibrary}.tsx`,
`app/about-p2p.tsx` (redirect), `app/admin/intro-videos.tsx`, gates in the screens of §2, `(tabs)/more.tsx` (About P2P
segment), `settings/index.tsx`, `lib/moreRoutes.ts`, `lib/i18n.ts` (device language), `contexts/AuthContext.tsx`,
`(auth)/onboarding.tsx`, `components/language/LanguageFlag.tsx` (flag font piece loaded at once), `lib/languageRegistry.ts`,
`lib/voices/index.ts`, `introVideos` strings in en/de/fr/ar/ig/tw.
API: `routes/introVideos.ts`, `lib/introVideos.ts`, `data/intro-videos/{timing,voices}.json + lang/*.json → bundle.txt`
(`scripts/build-intro-videos.mjs`), `lib/voices/{providers,catalogue,synth,types}.ts`, `routes/voices.ts`.
Video library (not in git): `_ENGINE/{engine,export_app_text,package_app_media,voiceover_lang,voiceover_01,sync_voices,
narrate_giggy,narrate_naija}.*`, `_APP/` (masters, media, voice samples, local server `serve-media.mjs`).

## 10. To go live (each needs the owner's approval)

1. Fluent review of each language; approve → publish in Admin Centre → About P2P Videos.
2. Apply 260 (and 261) — guarded apply + backup.
3. Create the bucket, upload `_APP/media`, set `INTRO_VIDEOS_MEDIA_URL` on Railway.
4. App build (EAS).
5. Keep Giggy credits topped up (films are recorded once; P2P Voices uses credits as people listen).
