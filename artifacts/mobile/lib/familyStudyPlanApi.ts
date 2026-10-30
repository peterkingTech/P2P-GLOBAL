import { apiRequest } from "@/lib/apiClient";
import { communityStudyPlanApi, type CommunityStudyPlanBase, type CommunityStudyPlanItem, type CommunityStudyPlanDetail } from "@/lib/communityStudyApi";

// Family Circle study plans — the family view of lib/communityStudyApi
// (routes/familyStudyPlans.ts; the server checks membership and leadership).
// Families also choose which source their Gatherings follow (below).
export type { StudyPlanStatus } from "@/lib/communityStudyApi";
export type FamilyStudySource = "p2p_curriculum" | "custom_study_plan";
export interface FamilyStudyPlan extends CommunityStudyPlanBase { familyId: string }
export type FamilyStudyPlanItem = CommunityStudyPlanItem;
export type FamilyStudyPlanDetail = CommunityStudyPlanDetail<FamilyStudyPlan>;

const api = communityStudyPlanApi<FamilyStudyPlan>("family");
export const getFamilyStudyPlans = api.getPlans;
export const getFamilyStudyPlan = api.getPlan;
export const createFamilyStudyPlan = api.createPlan;
export const updateFamilyStudyPlan = api.updatePlan;
export const publishFamilyStudyPlan = api.publishPlan;
export const archiveFamilyStudyPlan = api.archivePlan;
export const addFamilyStudyPlanLesson = api.addLesson;
export const removeFamilyStudyPlanLesson = api.removeLesson;
export const reorderFamilyStudyPlan = api.reorder;

export function setFamilyStudySource(
  familyId: string,
  updates: { studySource?: FamilyStudySource; activeStudyPlanId?: string | null }
): Promise<{ familyId: string; studySource: FamilyStudySource; activeStudyPlanId: string | null }> {
  return apiRequest(`/family/${familyId}/study-source`, { method: "PUT", body: JSON.stringify(updates) });
}
