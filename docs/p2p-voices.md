# P2P Voices — how it works and how to switch providers on

P2P Voices is a voice library inside **P2P Listen** (the one shared player). It is not a separate player. Built 2026-11-18. It is not live until the steps below are done.

## What reads what
| Content | Who reads it |
|---|---|
| Bible reading, Scripture playlists | The phone's voice, or the translation's own licensed audio. **Never** a P2P Voice: the app and the server both refuse it. |
| Kingdom Stories | 1. The **official narration** (owner-approved and published) when the chapter has one. 2. Otherwise the listener's chosen P2P Voice (Azure or Google). 3. Otherwise the phone's voice. |
| Daily Word ("Listen to today's word"), lessons, plans | The listener's P2P Voice for that language, otherwise the phone's voice. |
| Deep Study / commentaries | The phone's voice (this content carries Bible quotations from translations with different licences). |

P2P **never generates ElevenLabs audio**. There is no ElevenLabs synthesis code in the server, and the ElevenLabs adapter has no `synthesize`. Official narration is made by the owner outside P2P, then uploaded in **Admin › Story Narration**. The upload is validated, the owner approves it after listening, and then the owner publishes or withdraws it. Nothing is ever deleted.

## Switching a provider on (Railway variables on the API service; never in the app)
1. **Azure Speech:** set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` (e.g. `westeurope`). The voice list is read from P2P's own Speech resource.
2. **Google Cloud Text-to-Speech:** enable the Text-to-Speech API in a Google Cloud project, create an API key restricted to that API, and set `GOOGLE_TTS_API_KEY`.
3. **ElevenLabs catalogue and previews (optional):** set `ELEVENLABS_API_KEY` and `VOICES_ELEVENLABS_CATALOGUE=true`. This only lists the account's voices and plays ElevenLabs' own preview links. It never generates audio.
4. **Spitch (candidate for Igbo):** set `SPITCH_API_KEY`. List the voices you verified in `VOICES_SPITCH_VOICES`, for example `[{"id":"…","language":"ig","gender":"female","name":"…"}]`. Listen to real Igbo test passages (short, long, tone-marked and unmarked), then set `VOICES_SPITCH_VERIFIED=true`. Until then Igbo is not shown anywhere.
5. Migration **254** (`migrations/254_p2p_voices.sql`) was **applied to production on 2026-11-18**. It adds the preferences and usage tables, the narration workflow tables and the private `p2p-voices-audio` bucket. Before it was applied, the system fell back to:
   - preferences are kept on the phone;
   - the catalogue cache is held in memory;
   - generated audio is cached on the API server's disk;
   - the narration workflow answers "needs migration 254".
6. Optional: set `VOICES_AUDIO_SECRET`, which signs local audio links. Without it, the server derives the signing secret from its service key.

Admin › Story Narration shows each provider as connected or not, with the reason, plus usage counts. No secrets are shown.

## Caching
- **What gets made.** One sentence at a time, only when someone listens.
- **Cache key.** It covers provider, voice, model, language, content key, content version and the exact text, so edited text is never served old audio.
- **Speed.** Speed is applied by the player, so one recording serves every speed.
- **Simultaneous requests.** Identical requests at the same moment share one generation.
- **Rate limits.** Per listener: 400 sentences an hour and 40 previews an hour.

## Candidates checked on 2026-11-18
- **Spitch:** public docs (spitch.app/docs, PyPI `spitch`) describe Igbo text-to-speech. Its voice IDs, pricing, commercial and caching terms were not confirmed.
- **Naija Speech / 9jaLingo:** docs exist only on a development domain, and `igbo_female1` could not be confirmed.
- **Orinode:** no public API documentation was found.
