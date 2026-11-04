-- 231 (approved by the owner 2026-11-04: "yes do all" — remove the remaining
-- evaluation duplicates; restore-tested 2026-11-04; applied only with the
-- guarded production procedure): FUNCTION BODY ONLY.
--
-- The old (pre-engine) path sends "You have a lesson evaluation waiting" once
-- per evaluation. A learner who submits 30 answers sent one evaluator 30
-- notices within five minutes (2 November). Now, while that evaluator still
-- has an unread "waiting" notice from the last 10 minutes, that notice is
-- updated to the current count ("You have 30 lesson evaluations waiting")
-- instead of adding another; a new notice also states the current count. Updating it never pushes again: a notice already
-- pushed stays pushed; one not yet pushed goes out once, with the new text.
--
-- Engine evaluations are unchanged (they notify themselves, migration 229).
-- No table, column, row or trigger changes. Idempotent.

create or replace function public.p2p_notify_evaluator() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_waiting integer;
  v_recent uuid;
begin
  if new.engine_state is not null then
    return new;
  end if;
  if new.status <> 'pending' or new.evaluator_id is null then
    return new;
  end if;

  select count(*) into v_waiting from p2p_lesson_evaluations
   where evaluator_id = new.evaluator_id and status = 'pending' and engine_state is null;

  select id into v_recent from p2p_notifications
   where user_id = new.evaluator_id and notification_type = 'evaluation_waiting' and not coalesce(read, false)
     and created_at > localtimestamp - interval '10 minutes'
   order by created_at desc limit 1
   for update;

  if v_recent is not null and v_waiting > 1 then
    update p2p_notifications
       set title = format('You have %s lesson evaluations waiting', v_waiting),
           message = 'Fellow disciples submitted work for review. Please evaluate it when you can.'
     where id = v_recent;
  elsif v_waiting > 1 then
    insert into p2p_notifications (user_id, title, message, notification_type)
    values (
      new.evaluator_id,
      format('You have %s lesson evaluations waiting', v_waiting),
      'Fellow disciples submitted work for review. Please evaluate it when you can.',
      'evaluation_waiting'
    );
  else
    insert into p2p_notifications (user_id, title, message, notification_type)
    values (
      new.evaluator_id,
      'You have a lesson evaluation waiting',
      'A fellow disciple submitted work for review. Please evaluate it when you can.',
      'evaluation_waiting'
    );
  end if;
  return new;
end;
$$;

-- Rollback: re-run the p2p_notify_evaluator definition from 229 (one notice per evaluation).
