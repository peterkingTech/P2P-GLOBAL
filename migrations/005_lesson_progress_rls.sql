-- p2p_lesson_progress has rowsecurity=true but zero policies (same silent-block
-- pattern as migration 004). Needed so users can read/write their own lesson
-- completion state, which now drives level-gating in the app.

CREATE POLICY "Users can read own lesson progress"
ON p2p_lesson_progress
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can insert own lesson progress"
ON p2p_lesson_progress
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own lesson progress"
ON p2p_lesson_progress
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can read all lesson progress"
ON p2p_lesson_progress
FOR SELECT
TO authenticated
USING (p2p_is_admin());
