-- 230 (approved by the owner 2026-11-04: "move the 86 old pending evaluations
-- into the new engine"; restore-tested, applied with the guarded production
-- procedure): DATA ONLY.
--
-- Every evaluation still waiting under the old system (status 'pending', no
-- engine state) moves into the Peer Evaluation Engine (migration 229):
--   • it becomes 'queued' with no named evaluator, so the engine's sweep
--     (every 5 minutes) invites an eligible, oriented evaluator — and keeps
--     retrying with backoff while none is available;
--   • the previous evaluator is kept in the audit history ('adopted' event);
--   • the learner's submission, learning progress and every other evaluation
--     (approved / revision / self-approved) are untouched;
--   • notifications: ONE short notice per learner, per previous evaluator and
--     per coordinator — not one per evaluation (some learners have many). The
--     engine's per-evaluation "arranging" / "needs an evaluator" notices for
--     this move are recorded as already sent, so they never pile up later.
-- Idempotent: a second run finds nothing left to move and sends nothing.

begin;
do $$
declare
  v_now timestamptz := date_trunc('second', now());
  v_count integer;
  r record;
  v_coord uuid;
begin
  perform set_config('p2p.eval_engine', 'on', true);

  create temp table p2p_adopt_230 on commit drop as
    select e.id, e.submitter_id, e.evaluator_id
    from public.p2p_lesson_evaluations e
    where e.engine_state is null and e.status = 'pending' and e.submitter_id is not null;
  select count(*) into v_count from p2p_adopt_230;
  if v_count = 0 then
    raise notice 'P2P_EVAL_230: nothing to move';
    return;
  end if;

  -- Audit: who it was waiting with before.
  insert into public.p2p_evaluation_events (evaluation_id, event_type, actor_type, detail, idem_key)
  select id, 'adopted', 'admin',
         jsonb_build_object('previousEvaluatorId', evaluator_id, 'reason', 'Owner approved moving waiting evaluations into the Peer Evaluation Engine (2026-11-04)'),
         format('eval:%s:adopted', id)
  from p2p_adopt_230
  on conflict (idem_key) do nothing;

  -- Into the engine's queue (the sweep invites when someone eligible is available).
  update public.p2p_lesson_evaluations e
     set engine_state = 'queued', evaluator_id = null, current_assignment_id = null, accepted_at = null, deadline_at = null,
         queued_since = v_now, next_attempt_at = v_now, attempts = 0
    from p2p_adopt_230 a
   where e.id = a.id;

  -- The engine's per-evaluation queue notices for this move count as sent (a summary goes instead).
  insert into public.p2p_evaluation_events (evaluation_id, event_type, actor_type, detail, idem_key)
  select a.id, 'notified', 'system', jsonb_build_object('suppressed', 'adoption_summary'), format('eval:%s:arranging:%s', a.id, v_now)
  from p2p_adopt_230 a
  on conflict (idem_key) do nothing;
  insert into public.p2p_evaluation_events (evaluation_id, event_type, actor_type, detail, idem_key)
  select a.id, 'notified', 'system', jsonb_build_object('suppressed', 'adoption_summary'), format('eval:%s:unassigned:%s:%s', a.id, v_now, c)
  from p2p_adopt_230 a cross join public.p2p_eval_coordinators() c
  on conflict (idem_key) do nothing;

  -- One notice per learner.
  for r in select submitter_id, count(*)::int n from p2p_adopt_230 group by submitter_id loop
    perform public.p2p_eval_notify(r.submitter_id, 'evaluation_arranging', 'Your submissions are being arranged',
      case when r.n = 1 then 'Your submission waiting for review is now with P2P Global''s new evaluation system. We''ll arrange a qualified evaluator and let you know when someone accepts. Your work is safe.'
           else format('Your %s submissions waiting for review are now with P2P Global''s new evaluation system. We''ll arrange qualified evaluators and let you know when someone accepts. Your work is safe.', r.n) end,
      '{}'::jsonb, format('adopt-230:learner:%s', r.submitter_id));
  end loop;

  -- One notice per previous evaluator (no pressure — an invitation to the orientation).
  for r in select evaluator_id, count(*)::int n from p2p_adopt_230 where evaluator_id is not null and evaluator_id <> submitter_id group by evaluator_id loop
    perform public.p2p_eval_notify(r.evaluator_id, 'evaluation_reassigned', 'Reviews have moved to the new evaluation system',
      'The reviews that were waiting with you have moved into P2P Global''s new evaluation system. If you''d like to serve as an evaluator, a short orientation in My Evaluations prepares you — there''s no obligation.',
      '{}'::jsonb, format('adopt-230:evaluator:%s', r.evaluator_id));
  end loop;

  -- One summary per coordinator.
  for v_coord in select * from public.p2p_eval_coordinators() loop
    perform public.p2p_eval_notify(v_coord, 'evaluation_unassigned', 'Waiting evaluations moved into the engine',
      format('%s waiting evaluations are now queued in the Peer Evaluation Engine. They will be invited automatically once oriented evaluators are available (see Evaluation oversight).', v_count),
      '{}'::jsonb, format('adopt-230:coordinator:%s', v_coord));
  end loop;

  raise notice 'P2P_EVAL_230: moved % waiting evaluations into the engine', v_count;
end $$;
commit;

-- Rollback (puts them back on the old path; history stays):
--   update p2p_lesson_evaluations e set engine_state = null, evaluator_id = (ev.detail->>'previousEvaluatorId')::uuid,
--     queued_since = null, next_attempt_at = null, attempts = 0
--   from p2p_evaluation_events ev where ev.evaluation_id = e.id and ev.event_type = 'adopted' and e.engine_state = 'queued';
