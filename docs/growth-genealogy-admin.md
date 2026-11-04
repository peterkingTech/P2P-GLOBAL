# Growth, genealogy and the Admin Centre (migrations 232–238)

Built on 2026-11-04 from the owner's Phase 0–7 briefs. **Migrations 232–238 applied in production on 2026-11-04** (fresh backup, rehearsal of all seven together, then precheck, apply and postcheck for each). Promotions are **off** and the matrix is a **draft**.

**Known follow-up:** `p2p_growth_stage_points` (a pure-math helper, no data) is still callable by signed-in users through Supabase's default function grants. Revoke it in the next migration. Every function that reads or writes data is service-role only.

## What changed

| Area | Before | Now |
|---|---|---|
| Lineage route `GET /profiles/:id/forest` | Answered anyone, signed in or not | Only the signed-in person (super admins: anyone) |
| `POST /discipleship` | Created an **active** relationship without the other person's consent | Retired (410). Relationships begin through `POST /request`, then the other person accepts |
| `growth_level` | Writable by the signed-in person | Server-only (232) |
| Relationships | `active` and `status` overlapping; no safeguards | States `pending · active · paused · ended` (plus `declined · expired`); one primary mentor; no self-links, duplicate open pairs or cycles (database-enforced); history in `p2p_discipleship_link_events` (233) |
| Generations | Walked on the phone (blocked by RLS beyond 1 level) or by the API (3 levels) | Server functions with no fixed depth: `p2p_lineage_descendants`, `p2p_lineage_ancestors` and `p2p_lineage_generation_counts` (234) |
| Growth | 3 formulas (010 points, 113 My Tree, the unused `forest_nodes` view); stage only moved on module completion | One engine: milestones across 4 dimensions, a queue, nightly reconciliation, history and celebrations (235–237) |
| Admins | A peer account with a role; role lists copied 3 times | Admin identity registry, server-side admin sessions, role → permission table, append-only audit (238) |

## Growth engine

- **Personal stages:** 1 Dormant Seed · 2 Sprout · 3 Young Tree · 4 Fruitful Tree · 5 Forest Builder.
- **Forest of Nations** is collective only, never a personal stage.
- **Evidence** (`p2p_growth_facts`) comes from dated records only. It never reads the content of a reflection, journal or evaluation. Sources:
  - answers;
  - lesson and module completion events;
  - evaluations given;
  - journal entries (counted);
  - prayer and Scripture activity;
  - fruit;
  - sustained discipleship.
- **Evaluation** (`p2p_growth_evaluate`): a stage is met only when all its requirements are, and every stage below it is too.
- **Promotion** (`p2p_growth_recalculate`): never lowers anyone. Each stage is recorded once (unique index), with one notification (`growth_stage_reached`) and one celebration (`p2p_growth_events.stage_reached`).
- **`growth_level`** mirrors the stage for older app builds (0 · 4 · 12 · 28 · 60).
- **Settings** (`p2p_growth_settings`):
  - the matrix starts as **draft** and promotions are **off**;
  - promotions can only be switched on once the matrix is approved (database check);
  - while off, the old 010 formula keeps writing `growth_level`, and the one stage follows it upward as `legacy_unverified`.
- **Queue:** event triggers add to `p2p_growth_queue`. The `p2p-growth-queue` worker runs every 5 minutes, and `p2p-growth-reconcile` runs nightly. Failures retry with back-off and the error is kept.
- **Moving existing people over (237):** everyone keeps the stage they saw. Forest of Nations (110+ points) becomes Forest Builder, with a note. Stages the draft matrix doesn't confirm are marked `legacy_unverified`, with the reason.

## Genealogy API

`/genealogy/me`, `/genealogy/branch/:id`, `/genealogy/me/generation/:n`, `/genealogy/me/search` and `/genealogy/collective`.

- **Direct relationships** show by name.
- **Anyone further away** follows their own privacy settings: a private profile is "A disciple", with no id.
- **The collective view** is totals only.

Relationship actions live at `/discipleship/relationships/*`. Either person may end, pause or resume; only the disciple chooses the primary mentor.

## Admin identity

- **Admin accounts:** `p2p_admin_accounts`. Today's admins are recorded as `legacy_shared`, and their access is unchanged.
- **Sessions:** `p2p_admin_sessions`.
  - Started at `POST /admin-identity/session/start`, only within 15 minutes of a real sign-in, and with `aal2` (two-step verification) where the account requires it.
  - Idle limit 2 hours, absolute limit 12 hours.
  - Revocable, and ended on Exit Admin.
  - The token is stored only as a hash and sent as `X-P2P-Admin-Session`.
- **Permissions:** `p2p_admin_role_permissions` + `p2p_admin_permissions_for(user)`, enforced by `requirePermission()`.
- **Audit:** `p2p_admin_audit` can't be edited, deleted or truncated (by anyone, the service role included).
- **The switch `ADMIN_SESSIONS_REQUIRED=true`** (an environment variable on the API) makes the admin session mandatory. Before switching it on, every admin screen must call the API through `lib/apiClient`; some still use plain `fetch`.

### Not done: 5b (needs its own approval)

144 RLS policies on 68 tables check `p2p_profiles.role`, and 6 admin screens read the database directly. A separate **admin-only** identity (no peer profile) works with the new API and screens, but not with those older paths yet. 5b means:
- moving those policies to the admin registry;
- moving those screens to the API;
- moving each admin to their own admin-only login;
- then switching sessions to required.

## Rollout order

1. 232 → 238, each with the guarded procedure: backup, rehearsal, precheck, apply, postcheck.
2. Deploy the API (Railway deploys from `main`).
3. App build: journey, lineage, relationships, admin screens and celebrations.
4. Owner approves the milestone matrix → **Admin Centre → Discipleship & Growth → Approve**, then switch promotions on.
5. Later: 5b, then `ADMIN_SESSIONS_REQUIRED=true`.

## Tests

- **API:** `test:security`, `test:discipleship`, `test:growth`, `test:genealogy`, `test:admin-identity`, `test:admin-centre`.
- **App** (in `test:release`): `test:growth-journey`, `test:genealogy`, `test:admin-centre`.
- **Database rehearsals** in the guarded staging scripts: `232`, `233-234`, `232-237`, `238`, and the integration `232-238`, which includes a 2,000-person lineage.
