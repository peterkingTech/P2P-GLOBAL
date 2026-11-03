# Bible providers — API.Bible + AO Lab "Free Use Bible API"

P2P Global reads Scripture from two providers through **one** reader, one
translation list and one Listen player. API.Bible stays exactly as it was; AO Lab
(https://bible.helloao.org) is an additional, licence-reviewed source.

## Where things live

| Piece | File |
|---|---|
| Provider adapter (fixed base URL, validation, timeouts, normalisation) | `artifacts/api-server/src/lib/bibleProviders/helloao.ts` |
| Licence rules (display, cache, copy, recorded audio, approval) | `artifacts/api-server/src/lib/bibleLicence.ts` |
| Reader service (both providers; cache; books; search) | `artifacts/api-server/src/lib/bibleReader.ts` |
| Reader routes (unchanged URLs; `/bible/reader/books?t=`) | `artifacts/api-server/src/routes/bibleReader.ts` |
| Licence review (super admin only) | `artifacts/api-server/src/routes/bibleTranslationsAdmin.ts` → `/api/admin/bible-translations` |
| Database (DRAFT, not applied) | `migrations/225_bible_provider_licences.sql` |
| App model / picker / reader | `artifacts/mobile/lib/bibleReaderApi.ts`, `components/bible/TranslationPicker.tsx`, `app/bible/index.tsx` |
| Tests | `api-server/tests/bibleProviders.test.mjs` (real AO Lab fixtures), `mobile/tests/bibleProviders.test.mjs` |

Every translation has one row in `p2p_bible_translations` and a **unique code**
(AO Lab rows use `AO-<id>`, e.g. `AO-BSB`). Highlights, notes, saved passages,
Scripture collections, reading position and Listen all key on that code, so
nothing else needed to change and the same text from two providers never mixes.

## AO Lab endpoints used

`/api/available_translations.json` · `/api/{translation}/books.json` ·
`/api/{translation}/{book}/{chapter}.json` · `/api/available_commentaries.json` ·
`/api/available_datasets.json` · `/api/d/{dataset}/{book}/{chapter}.json` (cross
references — extension point only). Ids, books and chapters are validated before
they are put in a URL; responses are checked against the published schema
(https://bible.helloao.org/openapi.json); provider text is only ever plain data.

Normalised: verses (number, text, paragraph, poetry with line breaks), headings
(incl. Hebrew psalm subtitles and inline headings) before their verse, footnotes
(listed under the chapter), previous/next chapter, text direction (RTL), and —
only when a licence permits it — recorded audio links with verse timings.
The source omits the space where a footnote marker sat between two words; it is
restored only between letters, never in scripts written without spaces.

## Licences — nothing is shown until a person approves it

AO Lab's API licence does not cover the Bible texts: each translation keeps its
own licence. AO Lab's catalogue includes a summary (public domain, commercial use,
attribution, derivatives, copyleft) — recorded as **their statement**, never as
our approval.

Per translation (migration 225): copyright notice, licence name + URL,
attribution, source, AO Lab's statement, and six permissions — display,
commercial app distribution, caching, offline storage, recorded audio, sharing
text. **Unknown = not permitted.** Status: unreviewed · needs_information ·
rejected · approved, with reviewer and time.

**Shown to people only when** status = approved, display AND commercial use are
permitted, and the reviewer is recorded — enforced in code
(`isServable`) and by a database check (`p2p_bible_translations_helloao_approval`).

Review flow (super admin):
1. `GET /api/admin/bible-translations/helloao/catalogue?language=jpn` — catalogue + review notes / open questions.
2. `POST /api/admin/bible-translations/helloao/import {"ids":["jpn_kou"]}` — adds it **unreviewed (hidden)**.
3. Check the publisher's licence, then `PATCH /api/admin/bible-translations/AO-jpn_kou/licence`
   `{ "status":"approved", "permits_display":true, "permits_commercial":true, "permits_caching":true, "permits_sharing":true, "copyright_notice":"…", "licence_name":"Public domain", "attribution":"…" }`.
   Anything incomplete is refused. `rejected` / `needs_information` hide it again.

API.Bible keeps its own rules (plan licence; public-domain-only copying) — AO Lab
terms are never applied to it, nor the reverse.

## What the catalogue holds (2 Nov 2026)

1,505 translations · 1,168 languages · 247 complete (66 books) · 30 right-to-left.
AO Lab's statements: 111 public domain, 681 "commercial use allowed",
804 commercial use NOT allowed (unsuitable for app-store distribution), 20 with no
licence summary.

Candidates worth reviewing first — complete Bibles in languages we lack or want
newer versions of (AO Lab says commercial use allowed; PD = public domain):

| App language | Candidates |
|---|---|
| Japanese | jpn_kou (PD), jpn_bun (PD), jpn_meb (PD) |
| Korean | kor_old (PD) |
| Russian | rus_syn (PD) |
| Romanian | ron_924 (PD) |
| Tagalog | tgl_bib, tgl_ulb |
| Ukrainian (complete) | ukr_ufb (PD), ukr_pan (PD) |
| French | fra_lsg (PD, Louis Segond), fra_ost (PD), fra_ncl |
| German | deu_sch (Schlachter), deu_elo/deu_l12/deu_tkw (PD) |
| English | BSB (PD), ENGWEBP (PD), and others |
| Arabic | arb_vdv (PD, Van Dyck), ARBNAV |
| Hebrew (modern) | heb_mod (PD) |
| Hausa | hau_bib |
| Italian | ita_riv (PD) |

No commercial-use-allowed complete Bible in the catalogue for: Danish, Indonesian,
Norwegian, Swedish.

## Listen

The shared Listen player reads the displayed chapter with the device voice, so AO
Lab translations work with Listen exactly like API.Bible ones (stop, again, next,
range, speed, voice), with nothing new to build.

AO Lab also offers **recorded** chapter audio for some translations (e.g. BSB has
three readers, with per-verse timings). It is NOT played: the recordings' own
licences haven't been reviewed, and the player today is device-speech only.
Once a translation's `permits_audio` is approved, the server includes
`chapter.audio` (reader, URL, verse timings). The next step is an expo-audio
driver behind the same Listen engine interface — not a second player. Bible
Brain work is unaffected.

## Commentaries and datasets (future; no screens yet)

Commentaries (7): Adam Clarke, Jamieson-Fausset-Brown, John Calvin, John Gill,
Keil & Delitzsch, Matthew Henry (public-domain mark), Tyndale Open Study Notes (CC BY-SA 4.0).
Datasets (6): BSB Interlinear (berean.bible terms), History Globe (CC BY 4.0),
Open Cross References (CC BY 4.0), STEPBible Brief Lexicons (CC BY 4.0),
Theographic Bible Metadata (CC BY-SA 4.0), Verse of the Day (AO Lab licence).

Extension point: `getHelloAoCommentaries`, `getHelloAoDatasets`,
`getHelloAoCrossReferences` (validated, cached). Rules for any future use:
show each resource's attribution, honour share-alike, and never present
third-party commentary as P2P teaching.

## Not done / limits

- **Word search** isn't available for AO Lab translations (AO Lab has no search);
  reference search ("John 3:16") works everywhere.
- The book picker still lists 66 books; opening a book a translation lacks shows
  "That passage isn't in this translation." (`/bible/reader/books?t=` already
  returns the real list for a future picker change.)
- Nothing is stored offline for any translation.
- Migration 225 is a draft; until it is applied no AO Lab translation can be
  approved, so people see exactly what they see today.

## Try it locally (before 225)

A local preview shows chosen AO Lab translations, labelled "preview — licence not
yet approved". It is ignored on the deployed server (Railway's project variables
are always present there).

```bash
# local API with previews (from the repo root)
LEARNING_ATTACHMENTS=on NODE_ENV=production HELLOAO_PREVIEW=BSB,arb_vdv,fra_lsg,jpn_kou \
  node <scratchpad>/local-api.mjs "$(pwd)" 8792
# web app against it
cd artifacts/mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:8792/api npx expo start --web --port 8081
# tests
cd artifacts/api-server && node tests/bibleProviders.test.mjs && node tests/bibleParser.test.mjs
cd artifacts/mobile && node tests/bibleProviders.test.mjs && npm run test:release
```
