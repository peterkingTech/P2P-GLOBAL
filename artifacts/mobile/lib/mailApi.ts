// P2P Mail client (api-server routes/mail.ts). P2P Mail is P2P Global's own correspondence — not e-mail,
// and never part of a chat. Every call is authorised on the server.
import { apiRequest } from "@/lib/apiClient";

export type MailFolder = "inbox" | "sent" | "archived";
export interface MailPerson { id: string; name: string; photoUrl?: string | null }
export interface MailThreadSummary {
  id: string; subject: string; lastMessageAt: string; unread: number; letters: number;
  isOfficial: boolean; officialScope: "p2p" | "church" | "family" | null;
  from: { id: string; name: string } | null; with: MailPerson[]; snippet: string;
}
export interface MailLetter {
  id: string; kind: "original" | "reply" | "forward"; body: string; sentAt: string; replyToId: string | null; forwardedFromId: string | null;
  isOfficial: boolean; attachments: unknown[]; from: { id: string; name: string; isMe: boolean };
}
export interface MailThread {
  id: string; subject: string; createdAt: string; isOfficial: boolean; officialLabel: string | null; archived: boolean; lastReadAt: string | null;
  participants: (MailPerson & { role: "sender" | "recipient"; isMe: boolean })[]; letters: MailLetter[];
}
export interface OfficialScope { scope: "p2p" | "church" | "family"; scopeId: string | null; label: string; memberCount: number | null }
export interface MailDraft { id: string; threadId: string | null; subject: string; body: string; updatedAt: string; to: MailPerson[]; official: { scope: string; scopeId: string | null } | null }

const call = <T,>(path: string, init: RequestInit = {}) => apiRequest<T>(`/mail${path}`, init, { fallbackError: "P2P Mail didn't respond. Please try again." });
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const listMail = (folder: MailFolder, opts: { q?: string; with?: string } = {}) => {
  const p = new URLSearchParams({ folder });
  if (opts.q?.trim()) p.set("q", opts.q.trim());
  if (opts.with) p.set("with", opts.with);
  return call<{ threads: MailThreadSummary[] }>(`?${p.toString()}`);
};
export const mailUnread = () => call<{ unreadThreads: number }>("/unread");
export const getThread = (id: string) => call<MailThread>(`/${id}`);
export const markThreadRead = (id: string) => call<{ read: true }>(`/${id}/read`, { method: "POST" });
export const archiveThread = (id: string, archived: boolean) => call<{ archived: boolean }>(`/${id}/archive`, post({ archived }));
export const sendMail = (m: { to: string[]; subject: string; body: string; official?: { scope: string; scopeId?: string | null; toAll?: boolean } | null; draftId?: string | null }) =>
  call<{ threadId: string; recipients: number }>("", post(m));
export const replyMail = (threadId: string, body: string) => call<{ messageId: string }>(`/${threadId}/reply`, post({ body }));
export const forwardMail = (threadId: string, messageId: string, to: string[], note?: string) => call<{ threadId: string }>(`/${threadId}/forward`, post({ messageId, to, note }));
export const officialScopes = () => call<{ scopes: OfficialScope[] }>("/official-scopes");
export const searchRecipients = (q: string) => call<{ people: (MailPerson & { username: string | null })[] }>(`/recipients?q=${encodeURIComponent(q)}`);
export const listDrafts = () => call<{ drafts: MailDraft[] }>("/drafts");
export const saveDraft = (d: { id?: string | null; to: string[]; subject: string; body: string; official?: { scope: string; scopeId?: string | null } | null }) => call<{ id: string }>("/drafts", post(d));
export const deleteDraft = (id: string) => call<{ deleted: true }>(`/drafts/${id}`, { method: "DELETE" });
