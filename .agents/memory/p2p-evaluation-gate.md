---
name: P2P Peer-Evaluation Gate
description: How lesson completion is gated behind peer evaluation approval — status vocabulary, self-approval edge case, submission types, and where completion actually gets flipped.
---

## Status vocabulary

`p2p_lesson_evaluations.status` is `'pending' | 'approved' | 'needs_revision'` (NOT `'revision_requested'` — that was the first name tried and was renamed everywhere: DB check constraint, credit trigger, and all mobile code/types).

## Canonical submission table

`p2p_submissions` is the canonical submission record (not `p2p_assignment_submissions`, which is kept for backward compat but is no longer written to by new code). `p2p_lesson_evaluations.submission_id` FKs to `p2p_submissions(id)`.

`p2p_submissions` columns: id, user_id, lesson_id, reflection_question_id (nullable), assignment_id (nullable), submission_type ('text'|'audio'|'video'), text_content, media_url (Supabase Storage path), duration_seconds, created_at.

**Only assignment submissions** (`assignment_id IS NOT NULL`) trigger the evaluator-assignment trigger. Reflection question answers are stored but do NOT gate lesson completion.

## Completion is DB-driven, not client-driven

`p2p_lesson_progress.completed` is flipped by the `p2p_apply_evaluation_outcome` trigger (AFTER INSERT OR UPDATE OF status on `p2p_lesson_evaluations`) — never by client code.
**Why:** the evaluator (who approves) has no RLS permission to write to the *submitter's* progress row; only a security-definer trigger can do it cross-user.

## Self-approval edge case

When no one has completed the lesson yet (first learner through), the trigger inserts an evaluation row already `status='approved', self_approved=true, evaluator_id=submitter_id`. The notify trigger only fires when `new.status = 'pending'`, so self-approval sends no notification.

## Media upload and storage

- Bucket: `submissions` (private, 100 MB limit)
- Path convention: `{user_id}/{submission_id}/recording.{ext}`
- Storage RLS: submitters own `split_part(name,'/',1) = auth.uid()::text`; evaluators can read their assigned submission via `split_part(name,'/',2) = submission_id::text`; admins read all
- Upload pattern in React Native: `fetch(localUri).then(r => r.arrayBuffer())` → `supabase.storage.from('submissions').upload(path, arrayBuffer, {contentType})`
- Playback: `supabase.storage.from('submissions').createSignedUrl(path, 3600)` — signed URL is generated on demand in MediaPlayer component

## Recording libraries (Expo SDK 54)

- Audio recording + playback: `expo-av` (~15.0.x) — `Audio.Recording.createAsync()`, `Audio.Sound.createAsync()`
- Video recording: `expo-camera` (~17.0.10) — `CameraView` with `mode="video"`, `ref.recordAsync()` / `ref.stopRecording()`
- Video playback: `expo-av` `Video` component with `useNativeControls`
- **expo-camera version matters**: pnpm installs 57.x by default; must explicitly pin `~17.0.10` for Expo SDK 54

## Test lesson/user notes

Real test accounts: `test1@gmail.com` (student, id `d11a6127-...`) and `officialezepetervictor@gmail.com` (super_admin, id `6310e094-...`). Both have accumulated real completed-lesson progress and submissions from manual testing — always query before assuming a clean state.

## Idempotent migrations

Migrations 004 and 005 originally used bare `CREATE POLICY` (fails on re-run). Fixed: add `DROP POLICY IF EXISTS` before each `CREATE POLICY`. The DO $$ block in migration 004 must drop all four policies per table in the loop before re-creating them.
