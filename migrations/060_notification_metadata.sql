-- Structured metadata on p2p_notifications so a notification can carry a
-- deep-link target (e.g. "circle session starting -> join this call") instead
-- of just title/message text. Used first by the group-call "Start Session"
-- flow (circles.ts); Break Rooms and pastoral/crisis calls reuse the same
-- columns rather than each inventing their own signaling path.
alter table p2p_notifications
  add column if not exists notification_type text;
alter table p2p_notifications
  add column if not exists data jsonb;

create index if not exists idx_p2p_notifications_type on p2p_notifications(notification_type);