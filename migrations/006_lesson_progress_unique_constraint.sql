-- Required for upsert(onConflict: "user_id,lesson_id") used by the mobile app
-- when marking a lesson complete — without this, there's no way to update an
-- existing progress row instead of erroring on duplicate insert.

ALTER TABLE p2p_lesson_progress
ADD CONSTRAINT p2p_lesson_progress_user_lesson_unique UNIQUE (user_id, lesson_id);
