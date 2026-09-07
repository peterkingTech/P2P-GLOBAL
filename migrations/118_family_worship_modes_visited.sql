-- 118: track which worship modes a session actually visited, so the
-- history summary (migration 117's p2p_family_worship_history) can report
-- something truer than just the final mode when a session ends. Additive
-- column only — appended to on each mode change by the API route, not by a
-- trigger, since "visited" here means "the host deliberately switched to
-- this mode," which the route already knows at the moment it happens.
alter table p2p_family_worship_sessions
  add column if not exists modes_visited text[] not null default '{}';