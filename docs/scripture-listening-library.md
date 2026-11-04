# Scripture Listening Library

A music-style library for Scripture: playlists, collections, saved passages, favourites, listening history and resume. It is built on what already exists:
- Scripture Collections (migration 220);
- Saved passages (migration 207);
- the one shared Listen player (`lib/listen`, see [listen.md](listen.md)).

## Data (migration 227)

| What | Where | Who can see it |
|---|---|---|
| Playlists and collections | `p2p_scripture_collections` (`kind`), with `cover_kind`, `cover_ref` and `tags` added in 227 | The owner, plus whoever it's shared with (220's permissions) |
| Passages in them | `p2p_scripture_collection_items` | The same people |
| Saved Scriptures | `p2p_bible_bookmarks`, with `title`, `tags`, `memorisation_status` and `updated_at` added in 227 | The owner only |
| Favourites (passages, playlists, collections) | `p2p_scripture_favourites` | The owner only |
| Listening history | `p2p_scripture_listening_history` | The owner only |
| Where I am in each playlist | `p2p_scripture_listening_state` | The owner only (per person, even for a shared playlist) |

- **A passage is its reference:** translation, book, chapter and verses (`refKey`). Saving one passage, favouriting it and adding it to several playlists never copies it into a separate record.
- **Only references are stored.** Bible text and audio always come from the licensed provider when someone reads or listens.
- **Duplicates:** a playlist skips a passage it already holds, unless the person explicitly chooses to add a repeat (`allowRepeat`).
- **History:** one row per passage listened. Starting the same passage again within 10 minutes continues the open row. Nothing is recorded per progress tick.
- **Resume:** each person has one row per playlist. It holds the current item and place, a shuffled order (the saved order never changes), the repeat mode and the speed. The app never starts playing by itself after a restart; it offers "Continue listening".
- **Deleting a playlist:** its favourites and resume rows go. History rows stay, no longer linked to it.
- **Clearing history:** removes history only.

## Security

- **The three new tables follow 220's pattern:** RLS on, no client policies and no client grants. Every read and write goes through the API (`routes/scriptureLibrary.ts`), which:
  - identifies the caller from their token;
  - checks the caller's access to any playlist named, using the same rule as `/scripture-collections`;
  - drops a revoked share, a left group or a block at once.
- **Saved passages keep their existing owner-only policy.**
- **Private notes, highlights, reflections and prayers are never read** by any of this. Sharing a playlist shares the playlist only, never the owner's library, favourites, history or resume place.

## API

- **`/scripture-library`:**
  - Saved Scriptures: `GET /saved`, `PATCH /saved/:id`.
  - One passage to several places: `POST /save`.
  - Favourites: `GET/PUT /favourites`, `DELETE /favourites/:id`.
  - History: `GET/POST/DELETE /history`, `POST /history/:id/complete`.
  - Resume: `GET /recent`, `GET/PUT /state/:collectionId`.
- **`/scripture-collections`** (220) gains `cover` and `tags` on `PATCH /:id`, and `allowRepeat` on `POST /:id/items`.

Rules are plain functions in `lib/scriptureLibrary.ts`. The app clients are `lib/scriptureLibraryApi.ts` and `lib/scriptureCollectionsApi.ts`.

## Lock screen: removed (2026-11-04)

Builds 82–84 turned each sentence into an audio file on the phone (`lib/listen/fileSpeech.ts` and the `modules/p2p-speech-audio` native module) so that playlists could show lock-screen controls. On an iPhone this made listening slow and unnatural: each sentence had to be written to a file before it could be heard. In build 83, listening also stopped after the passage heading.

The owner chose natural speech over lock-screen controls, so the pipeline was removed. All listening (playlists included) is now the device's own voice speaking straight from the text through `expo-speech`, exactly as before. See `docs/listen.md` for what that means with the screen locked.

Recorded Bible audio from a licensed provider would be a separate, future experience, not part of P2P Listen.

## Screens (app)

| Screen | File |
|---|---|
| My Scripture Library: Continue listening, sections, Recently played, filters and sort, Shared with me, history | `app/library/index.tsx` (opened from Bible Study → My Scripture Library) |
| Playlist / collection: cover, Play all, Shuffle, favourite, Add Scripture, Cover & tags, Duplicate | `app/scripture-collections/[id].tsx` |
| Saved Scriptures: search, filters, sort, select several, title / tags / memorisation | `app/library/saved.tsx` |
| Favourites, Listening history, Memorise, Reminders | `app/library/favourites.tsx`, `history.tsx`, `memorise.tsx`, `reminders.tsx` |
| Find / Add Scripture: references, words, exact phrases, select several | `app/library/add.tsx` |
| Save to several places at once | `components/library/SaveScriptureSheet.tsx`; the reader's "Add to…" action |

## Playback

- **One player.** `lib/listen/playlistSession.ts` only decides the listening order (shuffle, queue), and records history and resume. It plays through `listen`.
- **Engine.** Content of kind `"playlist"` plays on from passage to passage. Repeat can be off, this passage, or everything. Previous within the first 2 sentences of a passage goes to the passage before; later, it restarts the passage. Other content behaves exactly as before.
- **Voice.** The shared device-speech driver in `lib/listen/index.ts` speaks each sentence straight from the text, with no audio files, no preparation and no downloads. There are no lock-screen controls.

## Known limits

- **No lock-screen controls** for playlists, as for all P2P Listen content. The background limits are in `docs/listen.md`.
- **Exact phrases:** checked only among the provider's top results. AO Lab translations have no word search at all.
- **Shared playlists:** update notifications go out only when passages are added, at most once every 6 hours per playlist.

## Your own photos (migration 228)

- **What the owner can add:** a square **cover photo** and a wide (16:9) **header photo**. The header photo fills the top of the playlist page and fades into it, with the title on it.
- **Storage:** a private bucket, `scripture-library-images`, with no client access. The upload works like this:
  1. `POST /scripture-collections/:id/photos` gives a one-off upload link to a path the server chooses (`<owner>/<slot>-<collection>-<random>.<ext>`).
  2. `POST …/photos/complete` checks that the file arrived and is no bigger than 8 MB, then uses it.
- **Who sees a photo:** only people who can see the playlist at that moment, through 1-hour signed links. Unsharing a playlist stops them at once.
- **Clean-up:** replacing, removing (`DELETE …/photos/:slot`), choosing built-in artwork, or deleting the playlist removes the old file.
