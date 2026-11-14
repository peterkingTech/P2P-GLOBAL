# Learning Roots: how learning is grouped, and the proposed theme mapping (for review)

Status: grouping LIVE in code (local, 2026-11-14); theme mapping PROPOSED, not applied.

## What the app does now (no review needed)

`GET /growth/me/learning-roots` groups a participant's learning by the curriculum's **own, already-approved**
structure. Nothing is inferred from lesson titles.

| Root | Source of the grouping | Example titles |
|---|---|---|
| One root per Kingdom School Foundations curriculum | `p2p_curriculums.type = 'core'` (its own title) | Peer-to-Peer Orientation · The Gospel & Salvation · The Christian Foundation |
| One root per Learning Plan category | the 10 approved plan categories (`type = 'plan_category'`, migration 054; slug in `tags`) | Ministry & Leadership · Prayer · Family & Relationships … |
| Kingdom Stories | `type = 'kingdom_story'`; each story topic listed inside | Creation … |
| Other learning | any other curriculum type | — |

Per lesson the status is one of: **Assessment passed** (verified, credited, not withdrawn ledger pass),
**Returned for revision**, **Awaiting assessment** (answers submitted), **In progress** (lesson progress only).
A lesson is one learning unit however often it is passed or wherever it is studied (the ledger's `unit_key`).
Verified practical activities on a lesson are shown apart from the pass.

## The owner's proposed display themes: a mapping that needs editorial review

The brief lists *Biblical Understanding, Knowledge of Jesus Christ, Biblical History, Biblical Interpretation,
Discipleship, Relationships and Community, Responsibility and Stewardship, Leadership and Service, Mission and
Influence*. These are **display themes**, not qualifications. The safest maintainable layer is to map the
existing groupings above (not individual lessons) to themes, in one reviewed table. Proposed starting point
(**every row needs an editor's yes/no**):

| Existing grouping | Proposed theme(s) | Confidence | Note |
|---|---|---|---|
| Peer-to-Peer Orientation (core) | Discipleship | medium | How P2P learning and peer guidance work |
| The Gospel & Salvation (core) | Knowledge of Jesus Christ | high | |
| The Christian Foundation (core) | Biblical Understanding · Discipleship | medium | Broad; may need per-module mapping |
| Kingdom Stories | Biblical History | high | Story-based narrative of Scripture |
| Plan: Identity & Salvation | Knowledge of Jesus Christ | medium | |
| Plan: Spiritual Growth | Discipleship | medium | |
| Plan: Prayer | Discipleship | low | Could be its own theme ("Prayer") — editor's choice |
| Plan: Holy Spirit | Biblical Understanding | low | |
| Plan: Faith & Kingdom Living | Mission and Influence · Discipleship | low | |
| Plan: Ministry & Leadership | Leadership and Service | high | |
| Plan: Family & Relationships | Relationships and Community | high | |
| Plan: Church & Community | Relationships and Community | high | |
| Plan: Marketplace & Purpose | Responsibility and Stewardship | medium | |
| Plan: Healing & Freedom | — | — | No matching proposed theme; keep its own name |
| (none) | Biblical Interpretation | — | **No reliable source**: Bible reading / Deep Study store nothing on the server, and no curriculum is tagged for interpretation |

How it would be applied once approved: a small reviewed table (proposed name `p2p_learning_theme_map`:
`grouping_kind`, `grouping_key`, `theme_key`, `status` draft/approved, `reviewed_by`, `reviewed_at`) read by
the same endpoint. That is a schema change, so it is **not created** — it needs owner approval. Until then the
app shows the curriculum's own groupings and says the themes are awaiting review.

Rules kept either way: a passed lesson stays ONE learning unit even if its grouping maps to two themes; root
size on the 3D model is never scaled by these counts; no root on the model is claimed to be a specific lesson.
