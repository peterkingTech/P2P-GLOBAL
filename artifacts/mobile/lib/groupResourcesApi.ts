import { apiRequest } from "@/lib/apiClient";

// Client for Files & Resources (api-server routes/groupResources.ts). The
// server checks membership of the exact group on every call and only ever
// hands out short-lived signed URLs — the app never touches the bucket.

export type GroupScope = "family" | "church";
export interface GroupResource {
  id: string; scope: GroupScope; groupId: string; fileName: string; mimeType: string; sizeBytes: number;
  uploaderId: string | null; uploaderName: string | null; createdAt: string;
  lessonId: string | null; curriculumId: string | null; gatheringId: string | null;
}
export class ResourceApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }

const call = <T,>(path: string, init?: RequestInit) => apiRequest<T>(path, init, {
  fallbackError: "Something went wrong.", offlineError: "You're offline — check your connection and try again.",
  makeError: (message, status) => new ResourceApiError(message, status),
});

export const listResources = (scope: GroupScope, groupId: string) =>
  call<{ available: boolean; canUpload: boolean; canManage: boolean; items: GroupResource[] }>(`/resources/${scope}/${groupId}`);
export const getDownloadUrl = (id: string) => call<{ url: string; expiresIn: number; fileName: string; mimeType: string }>(`/resources/${id}/download`);
export const deleteResource = (id: string) => call<{ removed: true }>(`/resources/${id}`, { method: "DELETE" });

/** Same rules as the server (shown before uploading so people aren't surprised). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export function fileKind(mime: string): "image" | "pdf" | "doc" | "sheet" | "slides" | "text" | "audio" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("word")) return "doc";
  if (mime.includes("sheet") || mime.includes("excel") || mime === "text/csv") return "sheet";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "slides";
  if (mime.startsWith("text/")) return "text";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UploadHandle { promise: Promise<void>; cancel: () => void }

/**
 * Upload one picked file: ask the server for a signed slot (it validates type,
 * size and membership), PUT the bytes with progress, then confirm.
 */
export function uploadResource(scope: GroupScope, groupId: string, file: { uri: string; name: string; mimeType: string; size: number },
  context: { lessonId?: string; curriculumId?: string; gatheringId?: string }, onProgress: (fraction: number) => void): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;
  const promise = (async () => {
    const start = await call<{ resourceId: string; uploadUrl: string }>(`/resources/${scope}/${groupId}/uploads`, {
      method: "POST", body: JSON.stringify({ fileName: file.name, mimeType: file.mimeType, sizeBytes: file.size, ...context }),
    });
    if (cancelled) throw new ResourceApiError("Upload cancelled", 499);
    const blob = await (await fetch(file.uri)).blob();
    await new Promise<void>((resolve, reject) => {
      xhr = new XMLHttpRequest();
      xhr.open("PUT", start.uploadUrl);
      xhr.setRequestHeader("Content-Type", file.mimeType);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(0.99, e.loaded / e.total)); };
      xhr.onload = () => (xhr!.status >= 200 && xhr!.status < 300 ? resolve() : reject(new ResourceApiError("The upload failed. Please try again.", xhr!.status)));
      xhr.onerror = () => reject(new ResourceApiError("The upload failed — check your connection and try again.", 0));
      xhr.onabort = () => reject(new ResourceApiError("Upload cancelled", 499));
      xhr.send(blob);
    });
    await call(`/resources/${start.resourceId}/complete`, { method: "POST" });
    onProgress(1);
  })();
  return { promise, cancel: () => { cancelled = true; (xhr as XMLHttpRequest | null)?.abort(); } };
}
