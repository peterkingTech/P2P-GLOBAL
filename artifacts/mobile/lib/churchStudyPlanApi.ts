import { communityStudyPlanApi, type CommunityStudyPlanBase, type CommunityStudyPlanItem, type CommunityStudyPlanDetail } from "@/lib/communityStudyApi";

// Church study plans — the church view of lib/communityStudyApi (routes/
// churchStudyPlans.ts; the server checks membership and leadership).
export type { StudyPlanStatus } from "@/lib/communityStudyApi";
export interface ChurchStudyPlan extends CommunityStudyPlanBase { churchId: string }
export type ChurchStudyPlanItem = CommunityStudyPlanItem;
export type ChurchStudyPlanDetail = CommunityStudyPlanDetail<ChurchStudyPlan>;

const api = communityStudyPlanApi<ChurchStudyPlan>("church");
export const getChurchStudyPlans = api.getPlans;
export const getChurchStudyPlan = api.getPlan;
export const createChurchStudyPlan = api.createPlan;
export const updateChurchStudyPlan = api.updatePlan;
export const publishChurchStudyPlan = api.publishPlan;
export const archiveChurchStudyPlan = api.archivePlan;
export const addChurchStudyPlanLesson = api.addLesson;
export const removeChurchStudyPlanLesson = api.removeLesson;
export const reorderChurchStudyPlan = api.reorder;
