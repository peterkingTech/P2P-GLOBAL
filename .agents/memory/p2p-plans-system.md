---
name: P2P Plans System
description: Architecture decisions for the Plans feature — how Plans differ from Core Curriculum and how data flows end to end.
---

## Architecture

Plans reuse the existing `p2p_curriculums → p2p_modules → p2p_lessons` hierarchy rather than creating separate tables. This keeps all existing editors, lesson detail screens, content tables (sections/scriptures/questions), and RLS policies working without duplication.

### How Plans are distinguished from Core Curriculum

`p2p_curriculums` has a `type text DEFAULT 'core'` column:
- Core curriculum rows: `type = 'core'`
- Plans curriculum: `type = 'plan'`

`DataContext.loadCurriculum` now filters `.eq("type", "core")` to prevent the Plans curriculum from polluting the Core Curriculum module list.

### Fixed Plans curriculum UUID

The Plans curriculum uses a deterministic UUID: `b0000000-0000-0000-0000-000000000001`. This ID is hardcoded in:
- `DataContext.loadPlans` (via the type='plan' filter, not the ID directly)
- `admin/curriculum.tsx` `PLANS_CURRICULUM_ID` constant

### Module icon_name

`p2p_modules` has an `icon_name text` column (added via ALTER TABLE). Plan modules use Ionicons names here (e.g. `radio-outline`) for the plan card icon in the Plans tab.

### DataContext

`loadPlans(userId?)` fetches:
1. Published plan-type curriculums
2. Published modules from those curriculums (status='published' filter)
3. Lessons for those modules
4. User progress for lesson completion %

Exports: `plans: Plan[]`, `plansLoading: boolean`

### learn.tsx Plans tab

Replaces the old COMING_SOON_PLANS static array. Shows real plan cards with progress bars. Tapping a plan navigates to `/module/${plan.id}` — the same module detail screen used for core curriculum modules.

### Admin Plans tab

`admin/curriculum.tsx` has a tab switcher (Curriculum | Plans) at the top of the tree panel. Plans tab shows modules in the Plans curriculum. "New Plan" button opens the create modal with `PLANS_CURRICULUM_ID` as the parent. Uses the same `ModuleEditor` and `LessonEditor` components as core curriculum.

**Why:**
Reusing the existing hierarchy means zero new tables, RLS policies already cover plan modules/lessons, and the existing lesson detail + editor screens work unchanged.

**How to apply:**
- To add a new plan: insert a module in `b0000000-0000-0000-0000-000000000001`, set status='published', set icon_name to a valid Ionicons name.
- To hide a plan from users: set module status='draft'.
- Never let the Plans curriculum appear in the Core Curriculum tree: `loadCurriculum` filters `.eq("type","core")`.
