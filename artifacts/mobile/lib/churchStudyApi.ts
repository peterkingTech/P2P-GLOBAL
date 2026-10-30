import { communityStudyApi, type CommunityStudyBase, type CommunityStudyLesson } from "@/lib/communityStudyApi";

// Church custom studies — the church view of lib/communityStudyApi (routes/
// churchStudies.ts; membership and leadership are enforced on the server).
export type { CustomStudyStatus, CustomStudyMedia } from "@/lib/communityStudyApi";
export interface ChurchStudy extends CommunityStudyBase { churchId: string }
export type ChurchStudyLesson = CommunityStudyLesson;

const api = communityStudyApi<ChurchStudy>("church");
export const getChurchStudies = api.getStudies;
export const getChurchStudy = api.getStudy;
export const createChurchStudy = api.createStudy;
export const updateChurchStudy = api.updateStudy;
export const archiveChurchStudy = api.archiveStudy;
export const addChurchStudyLesson = api.addLesson;
export const updateChurchStudyLesson = api.updateLesson;
export const removeChurchStudyLesson = api.removeLesson;
export const setChurchStudyLessonStatus = api.setLessonStatus;
