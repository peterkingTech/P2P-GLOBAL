---
name: P2P Plans V2 Schema
description: Separate p2p_plans table hierarchy for content-first plans (not curriculum); admin hub, DataContext integration, public screens.
---

## Overview
Migration `018_plans_schema.sql` added 12 new tables completely separate from the `p2p_curriculums` hierarchy. Plans V2 have inline lesson content (no separate sections/scriptures/questions tables per lesson).

## Table hierarchy
```
p2p_plans
  └─ p2p_plan_source_teachers (many)
  └─ p2p_plan_modules (optional, if has_submodules=true)
  └─ p2p_plan_lessons (inline content: memory_verse, definition, why, to_whom, notes)
       └─ p2p_plan_reflection_questions (up to 5)
       └─ p2p_plan_assignment_questions (up to 5)
       └─ p2p_plan_lesson_progress (unique per user+lesson)
  └─ p2p_plan_teaching_outlines (1:1 with plan)
       └─ p2p_plan_teaching_sessions
  └─ p2p_plan_discussion_questions
  └─ p2p_plan_assignment_submissions
       └─ p2p_plan_lesson_evaluations (peer-eval gate, mirrors core curriculum pattern)
```

## DataContext
- `PlanV2` and `PlanV2Teacher` types exported from DataContext.tsx
- `plansV2: PlanV2[]` and `plansV2Loading: boolean` in context value
- `refreshPlansV2` (alias for `loadPlansV2`) in context value
- Loaded alongside `loadCurriculum` and `loadPlans` in the main `loadData` effect

## Admin
- Admin nav tab "Content" (was "Curriculum") at `/admin/content`
- Content Manager screen has 3 sub-tabs: Core Curriculum | Plans | Prayer & Testimonies
- Core Curriculum sub-tab navigates to existing `/admin/curriculum` (unchanged)
- Plans sub-tab: full CRUD for plans, teachers, modules, lessons, questions, outline, sessions
- Prayer sub-tab: prayer wall post moderation (delete/filter by type)

## Public screens
- `/plan/[id]` — Plan detail: teacher credit block, progress bar, module/lesson list, collapsible outline + DQs
- `/plan/lesson/[lessonId]` — Lesson: memory verse card, content sections, reflection Qs (read-only), assignment text inputs, submit → peer eval gate
- Both screens query Supabase directly (not through DataContext)

## Peer eval gate (mirrors 007/008 pattern)
- `p2p_plan_assign_evaluator_on_submission` trigger on insert into `p2p_plan_assignment_submissions`
- First user through a lesson gets auto-approved (self_approved=true)
- `p2p_plan_apply_evaluation_outcome` trigger writes `p2p_plan_lesson_progress` completed=true on approval

## learn.tsx
- Shows both legacy Plan cards (→ /module/[id]) and PlanV2 cards (→ /plan/[id]) in the Plans tab
- PlanCardV2 shows teacher attribution line below the title
