-- Real, question-based Assignments for "The Gospel & Salvation" curriculum.
--
-- These 17 lessons already had author-written "Assignment" text (stored as a
-- plain p2p_lesson_sections row, section_type='assignment') describing a real
-- Scripture-reading + reflective-writing task per lesson — but that text was
-- only ever rendered as an inert paragraph (see app/lesson/[id].tsx, which
-- doesn't even select section_type), never as an actual interactive
-- assignment. It never gated lesson completion the way a real p2p_assignments
-- row does, and Gospel & Salvation had zero rows in p2p_assignments/
-- p2p_assignment_questions before this migration.
--
-- This reuses the EXISTING assignment architecture (p2p_assignments,
-- p2p_assignment_questions, the QuestionResponseCard "kind=assignment" UI,
-- and the peer-evaluation-gated completion trigger from migration 031) —
-- the same one already used for Peer-to-Peer Orientation and Identity in
-- Christ — rather than building anything new. No app code changes were
-- needed for this: once these rows exist, DataContext.getAssignmentForLesson
-- and getAssignmentQuestionsForLesson pick them up automatically.
--
-- instructions preserve the original author-written text byte-for-byte;
-- question is a single, direct question derived from that same text (never
-- changing its meaning) so a peer must write a real, persisted answer to
-- progress — not just tap "Mark Complete".
--
-- Additive and idempotent: guarded per-lesson so re-running this migration
-- can never create duplicate assignments for a lesson that already has one.

-- The Good News, Simply Stated
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '1c4cab4b-4164-4aa4-a23b-6652c6dfeffd') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('1c4cab4b-4164-4aa4-a23b-6652c6dfeffd', 'Assignment', 'Memorize 1 Corinthians 15:3-4 this week. Practice saying it in your own words to a friend, family member, or your peer guide.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'Having memorized 1 Corinthians 15:3-4 this week, how would you explain it in your own words?', 0);
  end if;
end $$;

-- What Does It Mean to Follow Jesus as a Disciple, Not Just a Convert?
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = 'bf08c38f-0f35-42ef-8f15-09f719fc609f') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('bf08c38f-0f35-42ef-8f15-09f719fc609f', 'Assignment', 'Read Matthew 28:18-20 and Luke 14:25-33 this week. Write two or three sentences about what “discipleship, not just conversion” means for your own, specific life right now.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading Matthew 28:18-20 and Luke 14:25-33, what does "discipleship, not just conversion" mean for your own, specific life right now?', 0);
  end if;
end $$;

-- God Never Stopped Pursuing You
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = 'e3d6ee3d-cfd3-467c-bede-415d974f4218') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('e3d6ee3d-cfd3-467c-bede-415d974f4218', 'Assignment', 'Look back over your own life and identify three specific moments — big or small — where you can now see God’s patient pursuit at work before you ever believed. Write these down and share one with your peer guide.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'Looking back over your own life, what are three specific moments — big or small — where you can now see God''s patient pursuit at work before you ever believed?', 0);
  end if;
end $$;

-- You Were Never Meant to Grow Alone
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '69bbb5ae-ba88-42a8-9a89-309487a9860e') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('69bbb5ae-ba88-42a8-9a89-309487a9860e', 'Assignment', 'If you have a Peer Guide, reach out to them this week with one honest question or update about your own growth. If you don’t yet have one, take a step to connect with your Peer Guide or a peer group this week.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'What honest question or update about your own growth will you share with your Peer Guide this week — or what step will you take to connect with one?', 0);
  end if;
end $$;

-- How You Can Know You Are Saved
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = 'd4a3286a-408a-410f-b745-21f4016fd3ee') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('d4a3286a-408a-410f-b745-21f4016fd3ee', 'Assignment', 'Read 1 John 5:11-13 and write this promise somewhere you will see it regularly — your phone, a notecard, your journal — as a resource for future moments of doubt. Share with your peer guide how you’re feeling about your own assurance right now, honestly.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading 1 John 5:11-13, how are you feeling about your own assurance of salvation right now, honestly?', 0);
  end if;
end $$;

-- Confessing Christ and Counting the Cost
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '768e3264-aa30-4306-9e71-f511b60345ef') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('768e3264-aa30-4306-9e71-f511b60345ef', 'Assignment', 'This week, if you have not already done so, tell at least one person you trust about your decision to follow Christ. Write down how that conversation went.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'Have you told at least one person you trust about your decision to follow Christ this week? How did that conversation go?', 0);
  end if;
end $$;

-- Jesus Is Lord, Now and Forever
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '12903d68-3ae5-4de5-9908-94d1db3797a1') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('12903d68-3ae5-4de5-9908-94d1db3797a1', 'Assignment', 'Read Philippians 2:5-11 and Revelation 1:7 this week. Write a short paragraph describing what it means to you that Jesus both reigns now and will visibly return.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading Philippians 2:5-11 and Revelation 1:7, what does it mean to you that Jesus both reigns now and will visibly return?', 0);
  end if;
end $$;

-- Why You Could Not Save Yourself
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '528ea7aa-774e-4b48-8c13-bbf69dee4fbc') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('528ea7aa-774e-4b48-8c13-bbf69dee4fbc', 'Assignment', 'Write down, honestly, one thing you have relied on in the past to feel “good enough” — being kinder than someone else, going to church, avoiding the worst sins. Bring this to your next session to discuss.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'Honestly, what is one thing you have relied on in the past to feel "good enough" — being kinder than someone else, going to church, avoiding the worst sins?', 0);
  end if;
end $$;

-- Committed for the Long Haul
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '0b7c7761-35dc-4a2a-a940-061cc192d1f2') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('0b7c7761-35dc-4a2a-a940-061cc192d1f2', 'Assignment', 'Write a short letter to yourself about where you are right now, at the very start of this discipleship journey. Seal it, save it, and revisit it after you complete this entire course.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'Where are you right now, at the very start of this discipleship journey — what would you want to remember when you revisit this after completing the course?', 0);
  end if;
end $$;

-- Faith: Trusting Him Completely
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '7b78f578-3eae-4bba-8c6e-9f9dae84b592') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('7b78f578-3eae-4bba-8c6e-9f9dae84b592', 'Assignment', 'Read Hebrews 11:1-6 and Ephesians 2:8-9 this week. Write a short, honest description of where your own faith currently stands — genuine trust, still forming, somewhere in between.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading Hebrews 11:1-6 and Ephesians 2:8-9, how would you honestly describe where your own faith currently stands — genuine trust, still forming, or somewhere in between?', 0);
  end if;
end $$;

-- Fully God, Fully Man
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '68ba0ea5-e053-4e6f-a4bd-16ac1c4125bc') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('68ba0ea5-e053-4e6f-a4bd-16ac1c4125bc', 'Assignment', 'Read John 1:1-14 slowly this week. Underline or write down every phrase that emphasizes Jesus’s deity, and every phrase that emphasizes His genuine humanity.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading John 1:1-14 slowly, which phrases emphasize Jesus''s deity, and which emphasize His genuine humanity?', 0);
  end if;
end $$;

-- Made for Good, Marked by the Fall
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '1a3d2bd3-8341-47df-91ff-db626597026e') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('1a3d2bd3-8341-47df-91ff-db626597026e', 'Assignment', 'Read Genesis 1:26-31 and Genesis 3 back to back this week. Write two or three sentences describing the contrast between the world God made and the world sin produced.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading Genesis 1:26-31 and Genesis 3 back to back, how would you describe the contrast between the world God made and the world sin produced?', 0);
  end if;
end $$;

-- He Did Not Stay Dead
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = 'f46b7689-09a2-4224-bafe-ca5674289368') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('f46b7689-09a2-4224-bafe-ca5674289368', 'Assignment', 'Read 1 Corinthians 15:1-8 and list every specific detail Paul gives — names, numbers, timing — that makes this claim historically testable rather than vague.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading 1 Corinthians 15:1-8, what specific details — names, numbers, timing — make this claim historically testable rather than vague?', 0);
  end if;
end $$;

-- Why He Had to Die
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = 'a31a958f-7b22-443f-ae4c-a97a5fb61d82') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('a31a958f-7b22-443f-ae4c-a97a5fb61d82', 'Assignment', 'Read Isaiah 53 in full this week — written roughly 700 years before Jesus was born. Circle every phrase that describes what would happen to Him.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading Isaiah 53 in full, which phrases stand out to you as describing what would happen to Jesus, written roughly 700 years before He was born?', 0);
  end if;
end $$;

-- Repentance: Turning Toward God
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = '1f03a002-571d-42ab-9608-09bb01ff3540') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('1f03a002-571d-42ab-9608-09bb01ff3540', 'Assignment', 'Read Acts 3:17-21 and 2 Corinthians 7:8-10 this week. Identify one specific area of your life where you sense God inviting you to turn more fully toward Him.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading Acts 3:17-21 and 2 Corinthians 7:8-10, what is one specific area of your life where you sense God inviting you to turn more fully toward Him?', 0);
  end if;
end $$;

-- Separated From a Holy God
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = 'db1b8fbf-a1b7-4e11-a5b4-c578b6db8871') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('db1b8fbf-a1b7-4e11-a5b4-c578b6db8871', 'Assignment', 'Read Isaiah 59:1-2 and John 3:16-18 together this week. Notice how both the seriousness of the problem and the promise of a solution appear side by side.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'After reading Isaiah 59:1-2 and John 3:16-18 together, how do you see both the seriousness of the problem and the promise of a solution appearing side by side?', 0);
  end if;
end $$;

-- The Habits That Will Sustain Your Growth
do $$
declare
  v_assignment_id uuid;
begin
  if not exists (select 1 from p2p_assignments where lesson_id = 'e6a17e56-b56a-4c7f-885a-40a59f934140') then
    insert into p2p_assignments (lesson_id, title, instructions)
    values ('e6a17e56-b56a-4c7f-885a-40a59f934140', 'Assignment', 'Choose one of the three habits in this lesson and take one concrete, specific step in it this week — five minutes of Bible reading, one honest prayer, or one message to a local church about visiting.')
    returning id into v_assignment_id;

    insert into p2p_assignment_questions (assignment_id, question, display_order)
    values (v_assignment_id, 'Which one of the three habits in this lesson will you take a concrete step in this week, and what will that step be?', 0);
  end if;
end $$;

