---
name: P2P FK SET NULL Pattern
description: How ON DELETE SET NULL was applied to authored-content FK constraints; column nullability prerequisite; which tables were changed vs left alone.
---

## Rule
`ON DELETE SET NULL` silently fails at DELETE time with "null value violates not-null constraint" if the FK column itself is `NOT NULL`. You must run `ALTER COLUMN … DROP NOT NULL` **before** the FK change takes effect.

**Why:** Postgres FK triggers try to write NULL into the column; the column-level NOT NULL check fires first and rolls back.

**How to apply:** Any future FK change to SET NULL needs two steps:
1. `ALTER TABLE … ALTER COLUMN … DROP NOT NULL;`
2. `ALTER TABLE … DROP CONSTRAINT … / ADD CONSTRAINT … ON DELETE SET NULL;`

## Tables Changed (CASCADE → SET NULL + DROP NOT NULL)
- `p2p_content_flags.author_id`
- `p2p_help_requests.user_id`
- `p2p_assignment_submissions.user_id`
- `p2p_submissions.user_id`
- `p2p_lesson_evaluations.submitter_id`
- `p2p_lesson_evaluations.evaluator_id`
- `p2p_prayer_wall_posts.user_id`
- `p2p_prayer_wall_comments.user_id`
- `p2p_messages.sender_id`

## Tables Left as CASCADE (personal data — correct to delete with user)
- `p2p_conversation_members.user_id`
- `p2p_growth_events.user_id`
- `p2p_prayer_wall_reactions.user_id`
- `p2p_user_highlights.user_id`
- `p2p_user_notes.user_id`

## Special case: p2p_curriculums.created_by
Has NO FK constraint at all (confirmed via information_schema). Deleting a profile leaves created_by pointing to a stale UUID — not a cascade risk, but not auto-nulled either. Treat as an unconstrained soft reference.

## UI null-safety changes made
- `DataContext`: `ModerationFlag.authorId: string | null`, `HelpRequest.userId: string | null`
- `getModerationQueue`: skip `p2p_flag_poster_identity` RPC when `author_id` is null
- `moderation.tsx`: show "Creator no longer available" row when poster is null; disable Message icon when authorId is null
- `help-requests.tsx`: guard `handleMessageThem` for null userId; show italic muted label
- `prayer.tsx`: `|| "A believer"` on userName, `|| "?"` on charAt(0)
- `missions.tsx`: `|| "A believer"` on userName
