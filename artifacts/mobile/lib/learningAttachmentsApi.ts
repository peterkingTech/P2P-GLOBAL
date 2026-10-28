import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import type { DrawingDoc } from "@/lib/handwriting";

// Drawings, photos and PDFs on Comprehensive Check answers (migration 218,
// routes/learningAttachments.ts). Every check happens on the server: drafts
// are the owner's alone; sent work opens only for the people who may see that
// answer (the learner, its peer evaluator, the group's reviewers). Files are
// never public: uploads use a one-path signed URL, downloads a 5-minute link.

export type AttachmentKind = "handwriting" | "image" | "pdf";
export interface Attachment {
  id: string; kind: AttachmentKind; fileName: string; mimeType: string; sizeBytes: number | null; pageCount: number | null;
  caption: string | null; status: "pending" | "ready"; submitted: boolean; createdAt: string; updatedAt: string;
}
export type TargetKind = "core_submission" | "group_submission";
export interface AttachmentStatus { enabled: boolean; limits: { fileBytes: number; drawingBytes: number; pages: number; drawingsPerAnswer: number; filesPerAnswer: number }; fileTypes: string[] }

/** The words an answer carries when it was given only as a drawing or file (matches the server). */
export const ATTACHED_ONLY = "(Answer given as a drawing or file — open it in the latest P2P app to see it.)";
export const isAttachedOnlyText = (t: string | null | undefined) => (t ?? "").trim() === ATTACHED_ONLY;

async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ?? null; }
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const t = await token();
  const res = await fetch(`${getApiUrl()}/learning/attachments${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? "Something went wrong. Please try again."), { status: res.status });
  return body as T;
}
const send = <T>(method: string, path: string, body?: unknown) => call<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

let statusCache: { at: number; value: AttachmentStatus } | null = null;
/** Whether drawings and attachments are switched on (cached for a minute). Off or unreachable → hidden. */
export async function getAttachmentStatus(): Promise<AttachmentStatus> {
  if (statusCache && Date.now() - statusCache.at < 60000) return statusCache.value;
  try { const value = await call<AttachmentStatus>("/status"); statusCache = { at: Date.now(), value }; return value; }
  catch { return { enabled: false, limits: { fileBytes: 0, drawingBytes: 0, pages: 0, drawingsPerAnswer: 0, filesPerAnswer: 0 }, fileTypes: [] }; }
}

export const createDrawing = (doc: DrawingDoc, caption?: string | null) => send<Attachment>("POST", "/handwriting", { doc, caption: caption ?? null });
export const saveDrawing = (id: string, doc: DrawingDoc, caption?: string | null) => send<Attachment>("PUT", `/handwriting/${id}`, { doc, caption: caption ?? null });
export const getDrawing = (id: string) => call<{ attachment: Attachment; doc: DrawingDoc }>(`/${id}/content`);
export const getFileLink = (id: string) => call<{ url: string; expiresIn: number; fileName: string; mimeType: string }>(`/${id}/link`);
export const setCaption = (id: string, caption: string | null) => send<Attachment>("PATCH", `/${id}`, { caption });
export const removeDraft = (id: string) => send<{ removed: boolean }>("DELETE", `/${id}`);
export const myDrafts = () => call<{ attachments: Attachment[] }>("/mine");

/** Core answers: freeze my drafts onto the answer's id BEFORE the answer is saved. */
export const linkToCoreAnswer = (b: { submissionId: string; lessonId: string; assignmentQuestionId: string; attachmentIds: string[] }) =>
  send<{ submissionId: string; attachments: Attachment[] }>("POST", "/link", b);

/** The files of answers I may see, by answer id (others are simply missing). */
export async function attachmentsFor(kind: TargetKind, ids: string[]): Promise<Record<string, Attachment[]>> {
  const clean = [...new Set(ids.filter(Boolean))].slice(0, 50);
  if (!clean.length) return {};
  return (await call<{ attachments: Record<string, Attachment[]> }>(`/for?kind=${kind}&ids=${clean.join(",")}`)).attachments;
}

/** Upload a photo or PDF with progress. Retries ask for a fresh URL for the same attachment, so nothing is lost. */
export async function uploadFile(f: { uri: string; name: string; mimeType: string; size: number; caption?: string | null }, onProgress?: (fraction: number) => void, existingId?: string): Promise<Attachment> {
  const start = existingId
    ? await send<{ attachmentId: string; uploadUrl: string }>("POST", `/${existingId}/retry-url`)
    : await send<{ attachmentId: string; uploadUrl: string }>("POST", "/uploads", { fileName: f.name, mimeType: f.mimeType, sizeBytes: f.size, caption: f.caption ?? null });
  const blob = await (await fetch(f.uri)).blob();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", start.uploadUrl);
    xhr.setRequestHeader("Content-Type", f.mimeType);
    xhr.setRequestHeader("x-upsert", existingId ? "true" : "false");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Object.assign(new Error("Upload paused — tap Retry."), { attachmentId: start.attachmentId })));
    xhr.onerror = () => reject(Object.assign(new Error("Upload paused — tap Retry."), { attachmentId: start.attachmentId }));
    xhr.send(blob);
  });
  onProgress?.(1);
  return send<Attachment>("POST", `/${start.attachmentId}/complete`);
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
export const attachmentLabel = (a: Pick<Attachment, "kind" | "pageCount" | "fileName">) =>
  a.kind === "handwriting" ? `Drawing, ${a.pageCount ?? 1} page${(a.pageCount ?? 1) === 1 ? "" : "s"}` : a.kind === "pdf" ? `PDF · ${a.fileName}` : `Photo · ${a.fileName}`;
