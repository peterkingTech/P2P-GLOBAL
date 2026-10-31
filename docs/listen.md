# Listen — Read & Listen

The phone's own voice reads what a screen already shows: Bible chapters and selected verses, Kingdom Stories (chapters and introductions), Kingdom School, Core Curriculum and Learning Plan lessons, and plan overviews.

- **Nothing is recorded, downloaded or generated on a server.**
- **Listening never completes anything.**

## How it fits together

```
screen ── content adapter ──► lib/listen/engine.ts (ONE session for the whole app)
  app/bible/index.tsx        lib/listen/bibleContent.ts      ├─ chunking.ts   one utterance per sentence
  app/kingdom-stories/*      lib/storybook.ts                ├─ pronounce.ts  spoken copy only (LORD → Lord…)
  app/lesson/[id].tsx        lib/listen/lessonContent.ts     ├─ labels.ts     "Chapter 1", "Personal Reflections"… (locales)
  app/plan/[id].tsx                                          ├─ voices.ts     language match, quality, novelty filter
                                                             └─ SpeechDriver  device speech today (lib/listen/index.ts)
components/listen/ListenPlayer.tsx
  <ListenPlayer owner>  slim bar under the Listen screen in front
  <ListenHost/>         mounted once in app/_layout: floating mini player + the Read & Listen screen
components/listen/ReadAlongText.tsx   highlighted, following text
lib/listen/uiPrefs.ts                 mode, text size, Read Along switches (this phone)
```

- **Navigation:** leaving or closing a Listen screen never stops the session. Only Stop, an error, or the listener's own action does.
- **Bible chapters:** previous / next and "Continue to next chapter" are built outside the screen (`playBibleChapter`, `continueTo.load`), so they work from anywhere in the app.
- **One decision when content ends:**
  - **Bible:** stop, listen again once, or continue to the next chapter. It stays within the chosen range and the same book, after a visible countdown that can be cancelled.
  - **Everything else:** Auto Listen Again, once.

## What the device voice can and can't do

| | iOS | Android | Web |
|---|---|---|---|
| Keeps going when you leave the screen | Yes | Yes | Yes |
| Keeps going in the background | Intended (see below) | Short periods; may stop with the screen off | Depends on the browser |
| Lock-screen / notification controls | No | No | No |
| Length, elapsed time, seeking by seconds | No | No | No |
| Sentence-level position (highlighting) | Yes | Yes | Yes |

### iOS background

- `Info.plist` already declares the `audio` background mode.
- With **Background playback** on and **no live call**, the driver switches speech to the app's own audio session in playback mode (`expo-audio` `setAudioModeAsync`, the same way the ringtone does).
- During a call nothing is changed, so Agora, CallKit and Bluetooth routing stay as they are.
- **Not yet verified on a device:**
  - that speech carries on with the screen locked;
  - the short gap between sentences, where JavaScript queues the next one;
  - what happens after an interruption such as a phone call.

### Why there are no lock-screen controls (yet)

- **Lock-screen and media controls:** `expo-speech` has no media session. In `expo-audio` they belong to an audio player playing real audio (`setActiveForLockScreen`).
- **Android background:** lasting background playback (beyond about 3 minutes with the screen off) needs that lock-screen session and its foreground service.
- **No fakes:** showing controls on a silent track would be fake controls, so none are shown.

**What's needed (a new native module and a native build):** turn each passage into an audio file on the phone, then play it with `expo-audio`.
- **iOS:** `AVSpeechSynthesizer.write(_:toBufferCallback:)`.
- **Android:** `TextToSpeech.synthesizeToFile`.

That one change gives:
- real length, time and seeking;
- lock-screen and Control Center controls on iOS, and a media notification with background playback on Android;
- a file that can be shared in Study Together (below).

The engine is already separated from `expo-speech` through `SpeechDriver`, which reports its `capabilities`. A file-based driver, or licensed recorded Bible audio with verse timing, can slot in later without changing the screens.

## Voices

- **Never offered:** novelty and sound-effect voices.
  - Recognised first by system identifier: Apple's `com.apple.speech.synthesis.voice.*`, e.g. Albert, Bad News, Bahh, Bells, Boing, Bubbles, Cellos, Zarvox.
  - Then by name, for engines with opaque identifiers.
- **Offered only when nothing better exists for the language:** robotic "Eloquence" voices (Eddy, Flo, Grandma, Grandpa, Reed, Rocko, Sandy, Shelley).
- **Order:** premium, then enhanced (including browsers' "Natural" / "Neural" voices), then standard; the content's own region first.
- **Preview:** pauses the narration, reads the current sentence in that voice, then carries on. It uses the same single speech session.
- **The app never downloads voices.** Better voices are installed by the person in the phone's settings.

## Study Together — investigated, not changed

**What exists:**
- Family Gatherings already sync shared media files with a server-anchored clock (`components/family/SyncedMediaPlayer.tsx`).
- The call screens already detect who is speaking (Agora `onAudioVolumeIndication`).

**Why device speech on each phone isn't used:**
- Separate device voices on several phones won't stay in step.
- Speech played outside Agora isn't part of its echo cancellation, so it would be picked up by microphones and heard twice.

**The reliable design, for a later phase:**
1. The leader's phone produces the narration as an audio file (the native module above, or licensed recorded Bible audio).
2. It's played into the call with Agora audio mixing (`startAudioMixing`). Everyone hears the same audio through the call, in step, with echo cancellation intact.
3. Late joiners get the playback position from the session clock that already exists.
4. Ducking: when someone speaks (volume indication), lower the narration with `adjustAudioMixingVolume` and restore it afterwards. The leader can pause manually.

**Must be tested on real devices with several people:**
- Bluetooth and speaker routing
- echo and noise suppression
- network changes
- several participants

No call audio code was changed.
