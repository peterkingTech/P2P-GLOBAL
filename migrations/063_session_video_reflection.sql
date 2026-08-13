-- 063: Post-video-session reflection note + rating for p2p_sessions (the
-- real mentor/participant session table — see the comment in
-- session/[id].tsx about DataContext's separate, mismatched `sessions` array).
alter table p2p_sessions
  add column if not exists reflection_note text;
alter table p2p_sessions
  add column if not exists rating smallint check (rating between 1 and 5);