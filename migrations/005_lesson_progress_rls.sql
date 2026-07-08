-- p2p_lesson_progress RLS policies — idempotent (drops before re-creating).

DROP POLICY IF EXISTS "Users can read own lesson progress"  ON p2p_lesson_progress;
DROP POLICY IF EXISTS "Users can insert own lesson progress" ON p2p_lesson_progress;
DROP POLICY IF EXISTS "Users can update own lesson progress" ON p2p_lesson_progress;
DROP POLICY IF EXISTS "Admins can read all lesson progress"  ON p2p_lesson_progress;

CREATE POLICY "Users can read own lesson progress"
ON p2p_lesson_progress FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can insert own lesson progress"
ON p2p_lesson_progress FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own lesson progress"
ON p2p_lesson_progress FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can read all lesson progress"
ON p2p_lesson_progress FOR SELECT TO authenticated
USING (p2p_is_admin());
