-- 028: Enable Postgres Realtime replication for the peer-evaluation tables.
--
-- The lesson-detail screens (app/lesson/[id].tsx, app/plan/lesson/[lessonId].tsx)
-- and the new unlock-sync subscription in DataContext.tsx both subscribe to
-- postgres_changes UPDATE events on these tables so a submitter's UI refreshes
-- the instant a peer evaluator approves/requests revision on their work.
-- Confirmed via direct testing that these subscriptions silently never fired —
-- only p2p_messages had ever been added to the supabase_realtime publication
-- (migration 012). Without this, every "live" evaluation subscription in the
-- app is a no-op and the submitter only sees fresh state after a manual
-- pull-to-refresh or full app reload.
ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_lesson_evaluations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_plan_lesson_evaluations;
