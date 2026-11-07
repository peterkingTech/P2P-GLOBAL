# Kingdom Stories narration (ElevenLabs)

Kingdom Stories chapters can have a studio narration. It is a warm, expressive storyteller reading the whole chapter, with real whispers, laughs, gasps and pauses. When a reader taps **Listen**, the shared player plays that recording sentence by sentence, still highlighting each sentence on screen. If a chapter has no recording, or anything in it can't play, the phone's own voice reads as before.

## Voice and model

| | |
|---|---|
| Model | **Eleven v4** (`eleven_v4`), ElevenLabs' most expressive model. It acts out inline audio tags and does not read them aloud. |
| Narrator | **Jon: Warm & Grounded Storyteller**, from the ElevenLabs Voice Library, with a neutral American accent that is widely understood. It is the same voice for every story. |
| Settings | `artifacts/api-server/narration/config.json` holds the voice ID, model, stability (0.3, expressive), language and tag aliases. |

The ElevenLabs *default* voices expire on 31 December 2026, so a Voice Library voice is used instead. To change the narrator, change `voice.id` in the config and regenerate.

## How a story is narrated

1. **Script.** Each chapter has a script at `artifacts/api-server/narration/scripts/<story>/chapter-N.txt`. The script contains every part the Listen player reads: the title, the story, Story Lessons, Personal Reflections and the Comprehensive Check. Each part has its own `### <partKey>` heading. The text is the chapter's own words plus:
   - **audio tags** in square brackets just before the words they colour, about one every sentence or two, matched to the emotion already in the line. Examples: `[whispers]`, `[giggles]`, `[gasps]`, `[awed]`, `[reverent]`, `[commanding]`, `[tenderly]`, `[dramatic pause]`;
   - **ellipses** (…) for thoughtful pauses, **em dashes** (—) for short beats, and the occasional **CAPITALISED** word for emphasis.

   The words themselves never change. This keeps on-screen highlighting exact and keeps Scripture faithful. The generator refuses any script whose words differ from the screen.
2. **Generate.** Run this from `artifacts/api-server`:
   ```
   ELEVENLABS_API_KEY=… node scripts/narrate.mjs --script narration/scripts/<story> --dry-run   # check, no cost
   ELEVENLABS_API_KEY=… node scripts/narrate.mjs --script narration/scripts/<story>             # make the audio
   ELEVENLABS_API_KEY=… node scripts/narrate.mjs --script narration/scripts/<story> --upload    # and store it
   ```
   The key comes from the environment (Railway: `ELEVENLABS_API_KEY`) and is never printed or sent to the app.

   The generator reads the live chapter exactly as the app speaks it, using the app's own `chapterListenSections`. It then:
   - generates the audio in blocks of up to 1,400 characters, each with the previous block as context;
   - caches every block in `narration/.cache`, keyed by a hash of everything that shapes it, so nothing is ever generated twice;
   - joins the blocks into one MP3, with headers stripped so its length and seeking are correct;
   - aligns the MP3 to the text using ElevenLabs forced alignment, which gives every word's time.
3. **Store.** The output is `<chapterId>.mp3` plus `<chapterId>.json` (the word timings), stored in Supabase Storage at `kingdom-stories-media/<storyId>/narration/`. This is a private bucket. Migration 242 lets it hold audio and JSON.
4. **Play.** The app calls `GET /api/kingdom-stories/:id/chapters/:chapterId/narration`. It gets the narration only for a published story (or if the caller is an editor) and only for a chapter the reader has opened, which is the database's own rule. It receives a 6-hour signed link and the timings. The app fetches these once per chapter, plus the next and previous chapters, and the player plays each sentence's stretch of the file.

Nothing is generated when someone presses play.

## Other languages

Each language has its own narrator (`languages` in `config.json`). Currently that's English, **Jon**, and German, **Alexander** (a native German "Deep TV Narrator"). Each language also has its own script folder (`narration/scripts/<story>/<lang>/`), output folder (`narration/out/<storyId>/<lang>/`) and Storage folder (`<storyId>/narration/<lang>/`).

- **English** scripts must match the screen word for word.
- **A translation** is the cached, reviewable script itself. It is checked for completeness (every part translated) and is never retranslated.

Run `--lang de --upload` to do three things at once:
- upload the audio;
- save each chapter's translation into the shared translation store, `p2p_content_translations` (`content_type` `kingdom_story_chapter`, every part in `metadata.parts`; migration 243), as a **draft** for review. A later run updates only the text and never changes a status a reviewer has set;
- make the API serve the narration for `?lang=de`. A language without its own recording gets none; English audio is never served instead.

The aim is that a reader's **content language** shows every part of a story, and its narration, in that language.

| Story | Language | Narrator | Length | Translation |
|---|---|---|---|---|
| Creation (Biblical History, topic 1) | English | Jon | about 48 min | (source text) |
| Creation (Biblical History, topic 1) | German | Alexander | about 50 min | 6 chapters, draft (awaiting review) |

## Local development

`NARRATION_LOCAL_DIR` points at the generator's `narration/out` folder, and `NARRATION_LOCAL_BASE_URL` at a local file server (port 8796, with byte-range support). With both set, the local API serves narration before anything is uploaded.

## Done so far

| Story | Chapters | Length |
|---|---|---|
| Biblical History, topic 1: *Creation: The Beginning of Everything* | 1–6, including all lessons, reflections and checks | about 48 min |

Checks run on these recordings:
- Every one of the 299 sentence chunks the app speaks is found in its chapter's recording, in order.
- A speech-to-text pass found no cue words read aloud, and it detected the acted sounds (laughs, chuckles, gasps, breaths, sighs).

## Before production

1. Apply migration 242 (additive; it adds `audio/mpeg` and `application/json` to the bucket).
2. Run the generator with `--upload`.
3. Deploy the API (push to main).
4. Make an app build.
5. The privacy policy must say that some narration is AI-generated (ElevenLabs).
