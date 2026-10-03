import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useData, getModuleProgressCounts } from "@/contexts/DataContext";
import {
  GET_STARTED_STEPS, type GetStartedStepId, loadCompletedSteps, markStepComplete, inferCompletedSteps,
} from "@/lib/getStarted";
import { loadReminderState, hasInvitedSomeone } from "@/lib/inviteEncouragement";

// Completed = explicitly finished in the guide, OR confirmed by real
// activity (lesson started, invite shared). Reloads on focus so progress
// made elsewhere in the app shows up when the user comes back.
export function useGetStartedProgress() {
  const { profile } = useAuth();
  const { modules } = useData();
  const [explicit, setExplicit] = useState<Set<GetStartedStepId>>(new Set());
  const [hasInvited, setHasInvited] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const userId = profile?.id;
      if (!userId) return;
      let cancelled = false;
      void (async () => {
        const [done, reminder] = await Promise.all([loadCompletedSteps(userId), loadReminderState(userId)]);
        if (cancelled) return;
        setExplicit(done);
        setHasInvited(hasInvitedSomeone(reminder, profile?.grainCount ?? 0));
      })();
      return () => { cancelled = true; };
    }, [profile?.id, profile?.grainCount]),
  );

  const { modulesStarted } = getModuleProgressCounts(modules);
  const completed = new Set<GetStartedStepId>([
    ...explicit,
    ...inferCompletedSteps({ modulesStarted, hasInvited }),
  ]);

  const complete = useCallback(async (stepId: GetStartedStepId) => {
    if (!profile?.id) return;
    setExplicit(await markStepComplete(profile.id, stepId));
  }, [profile?.id]);

  return {
    completed,
    completedCount: GET_STARTED_STEPS.filter((s) => completed.has(s.id)).length,
    total: GET_STARTED_STEPS.length,
    complete,
  };
}
