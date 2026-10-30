import { communityStudyApi, type CommunityStudyBase, type CommunityStudyLesson } from "@/lib/communityStudyApi";

// Family Circle custom studies — the family view of lib/communityStudyApi
// (routes/familyStudies.ts; membership and leadership are enforced on the server).
export type { CustomStudyStatus, CustomStudyMedia } from "@/lib/communityStudyApi";
export interface FamilyStudy extends CommunityStudyBase { familyId: string }
export type FamilyStudyLesson = CommunityStudyLesson;

const api = communityStudyApi<FamilyStudy>("family");
export const getFamilyStudies = api.getStudies;
export const getFamilyStudy = api.getStudy;
export const createFamilyStudy = api.createStudy;
export const updateFamilyStudy = api.updateStudy;
export const archiveFamilyStudy = api.archiveStudy;
export const addFamilyStudyLesson = api.addLesson;
export const updateFamilyStudyLesson = api.updateLesson;
export const removeFamilyStudyLesson = api.removeLesson;
export const setFamilyStudyLessonStatus = api.setLessonStatus;
