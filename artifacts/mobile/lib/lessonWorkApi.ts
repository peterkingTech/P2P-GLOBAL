import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Reflections + assignments on custom lessons (api-server routes/lessonWork.ts,
// migration 201). Identity is the signed-in session; the server checks
// membership, leadership and every sharing rule.

export type WorkScope = "family" | "church";
export type ReflectionVisibility = "private" | "leaders" | "group";
export type SubmissionStatus = "submitted" | "reviewed" | "returned";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${getApiUrl()}/learning/work${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? "Request failed"), { status: res.status });
  return body as T;
}

export interface MyReflection { id: string; questionId: string; content: string; visibility: ReflectionVisibility; lessonVersion: number | null; submittedAt: string }
export interface SharedReflection extends MyReflection { question: string; author: { id: string; name: string; photoUrl: string | null } }
export interface Submission { id: string; attempt: number; content: string; status: SubmissionStatus; feedback: string | null; reviewedAt: string | null; submittedAt: string }
export interface Assignment {
  id: string; title: string; instructions: string | null; dueAt: string | null; scriptureReferences: unknown[]; resources: { title: string; url: string }[];
  allowResubmission: boolean; status: "draft" | "published" | "archived"; createdBy: string | null; createdAt: string; updatedAt: string;
  mySubmission?: Submission | null; submittedCount?: number;
}

export const VISIBILITY_OPTIONS: { value: ReflectionVisibility; label: string; detail: string }[] = [
  { value: "private", label: "Only me", detail: "Kept in your journal. Nobody else can see it." },
  { value: "leaders", label: "Me and our leaders", detail: "Your Shepherd / Co-Shepherd or church leaders can read it." },
  { value: "group", label: "Everyone in the group", detail: "All current members of this family or church can read it." },
];

const L = (scope: WorkScope, lessonId: string) => `/${scope}/lessons/${lessonId}`;
export const getMyReflections = (s: WorkScope, lessonId: string) => call<{ reflections: MyReflection[] }>(`${L(s, lessonId)}/reflections/mine`);
export const getSharedReflections = (s: WorkScope, lessonId: string) => call<{ reflections: SharedReflection[] }>(`${L(s, lessonId)}/reflections/shared`);
export const submitReflection = (s: WorkScope, lessonId: string, questionId: string, content: string, visibility: ReflectionVisibility) =>
  call<{ id: string; visibility: ReflectionVisibility }>(`${L(s, lessonId)}/reflections`, { method: "POST", body: JSON.stringify({ questionId, content, visibility }) });
export const setReflectionVisibility = (reflectionId: string, visibility: ReflectionVisibility) =>
  call<{ visibility: ReflectionVisibility }>(`/reflections/${reflectionId}/visibility`, { method: "PUT", body: JSON.stringify({ visibility }) });

export const getAssignments = (s: WorkScope, lessonId: string) => call<{ canManage: boolean; assignments: Assignment[] }>(`${L(s, lessonId)}/assignments`);
export interface AssignmentInput { title?: string; instructions?: string | null; dueAt?: string | null; allowResubmission?: boolean; status?: "draft" | "published" | "archived" }
export const createAssignment = (s: WorkScope, lessonId: string, input: AssignmentInput) => call<Assignment>(`${L(s, lessonId)}/assignments`, { method: "POST", body: JSON.stringify(input) });
export const updateAssignment = (s: WorkScope, id: string, input: AssignmentInput) => call<Assignment>(`/${s}/assignments/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const getMyAttempts = (s: WorkScope, id: string) => call<{ assignment: Assignment; attempts: Submission[] }>(`/${s}/assignments/${id}/submissions/mine`);
export const submitAssignment = (s: WorkScope, id: string, content: string) => call<Submission>(`/${s}/assignments/${id}/submissions`, { method: "POST", body: JSON.stringify({ content }) });
export const getSubmissionsForReview = (s: WorkScope, id: string) =>
  call<{ assignment: Assignment; submissions: (Submission & { attempts: number; author: { id: string; name: string; photoUrl: string | null } })[] }>(`/${s}/assignments/${id}/submissions`);
export const reviewSubmission = (s: WorkScope, submissionId: string, status: "reviewed" | "returned", feedback: string) =>
  call<Submission>(`/${s}/submissions/${submissionId}/review`, { method: "POST", body: JSON.stringify({ status, feedback }) });

/** What a member sees as the state of one assignment. */
export function assignmentState(a: Assignment, hasDraft: boolean): "Not started" | "In progress" | "Submitted" | "Reviewed" | "Returned" {
  const s = a.mySubmission?.status;
  if (s === "returned") return hasDraft ? "In progress" : "Returned";
  if (s === "reviewed") return "Reviewed";
  if (s === "submitted") return "Submitted";
  return hasDraft ? "In progress" : "Not started";
}
