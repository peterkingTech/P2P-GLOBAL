# Deep Study — licence review

Deep Study, Commentaries and Study Tools show third-party resources delivered by AO Lab's Free Use Bible API (bible.helloao.org). Every resource keeps its **own** licence; there is no blanket licence. This page records how each was checked, and what P2P Global must keep doing to stay compliant.

**Reviewed:** 12 November 2026, at each resource's **primary source**, not only the provider's catalogue. The same findings are in code (`artifacts/api-server/src/lib/studyResources.ts`, field `verified`), and `tests/deepStudy.test.mjs` fails if a required credit is removed.

## How a resource becomes visible

The live catalogue says what exists. Only resources listed in `STUDY_RESOURCES` with `eligible: true` are ever returned to the app. Anything new in the catalogue stays hidden and appears as "pending review" until it has been checked like the resources below.

Not yet reviewed, so hidden: **History Globe** (CC BY 4.0 per provider) and **Verse of the Day** (MIT).

## What P2P Global does for every resource

- **Shown as published.** The wording is never translated, summarised, merged or edited (`mayTranslate: false` for all). Only the formatting changes (paragraphs, verse ranges), and every credit says so: "Re-formatted for display in P2P Global; wording unchanged."
- **Attribution shown wherever the content appears.** The original source and the licence are both visible links, not hidden behind a toggle. The provider's own notice is kept.
- **No redistribution of datasets.** The app shows what a person opens. Nothing is bulk-downloaded or republished as a dataset.
- **Commentaries are presented as their authors' views,** not P2P Global teaching.

## Resources

| Resource | Licence | Verified at | Finding / obligation |
|---|---|---|---|
| Berean Standard Bible Interlinear | Public domain (dedicated 30 April 2023) | berean.bible/terms.htm | All Berean texts, including the Berean Interlinear Bible, are public domain; all uses are permitted. Attribution is appreciated but not required, and we use Berean's own notice. Their request: don't use the Berean name for texts that vary from the official text. We change formatting only, never wording. |
| STEPBible Brief Lexicons (TBESH, TBESG) | CC BY 4.0 | github.com/STEPBible/STEPBible-Data | **Condition: credit "STEP Bible" linked to www.STEPBible.org.** Done on every lexicon screen. Changes to data must be recorded; we make none to the wording. |
| OpenBible.info Cross References | CC BY 4.0 | openbible.info/labs/cross-references | Attribution with a licence link. **Only the verse references are used.** The site's ESV quotations (© Crossway) are never shown. |
| Theographic Bible Metadata (Robert Rouse) | CC BY-SA 4.0 | github.com/robertrouse/theographic-bible-metadata | Attribution, licence link, shown as published. No derivative dataset is made or redistributed. Event dates (one traditional chronology) are not shown. |
| Tyndale Open Study Notes | CC BY-SA 4.0 | tyndaleopenresources.com | Tyndale's own statement is used verbatim. Shown unmodified, so no derivative is made and share-alike isn't triggered beyond attribution and the licence link. |
| Matthew Henry | Public domain | — | Published 1706–1721; author died 1714. |
| Adam Clarke | Public domain | — | Published 1810–1826; author died 1832. |
| John Gill | Public domain | — | Published 1746–1763; author died 1771. |
| Jamieson-Fausset-Brown | Public domain | — | Published 1871; all authors died before 1900. |
| John Calvin (Calvin Translation Society) | Public domain | ccel.org | English texts 1843–1855. CCEL identifies its electronic Calvin commentaries as public domain and usable for any purpose. |
| Keil & Delitzsch (English, T&T Clark) | Public domain | — | German originals 1861–1875 (authors died 1888 and 1890); English translation 1866–1891. |
| Free Use Bible API (AO Lab) — the service | MIT | bible.helloao.org/docs | No account, no published usage limit, caching allowed; "AO Lab adds no restrictions; each text keeps its own notice." |

## Rules for changes

- **Translating any of these resources into other languages:**
  - **CC BY and CC BY-SA** permit translation. A translation is an adaptation: credit is required, and for BY-SA the translation must itself be CC BY-SA. This needs a separate decision and review first.
  - **Public-domain texts** may be translated freely.
- **Adding a resource:** verify at its primary source, add it to `STUDY_RESOURCES` with its `verified` record, and update this page.
- **Any edit to the wording** (summaries, excerpts presented as new work) creates an adaptation. Don't do it for CC BY-SA content without applying the same licence to the result.
