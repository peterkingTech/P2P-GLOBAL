// Private groups and Communities client (api-server routes/groups.ts). Group chat itself is an ordinary
// group conversation (app/messages/[id]); these calls manage groups, communities, invitations and links.
// Everything is authorised on the server — a non-member gets "not available" for a private group.
import { apiRequest } from "@/lib/apiClient";

export interface MyGroup {
  id: string; name: string | null; description: string | null; photoUrl: string | null;
  kind: "private_group" | "family" | "church" | "circle" | "peer_group" | string;
  communityId: string | null; familyId: string | null; churchId: string | null;
  isAnnouncements: boolean; posting: "everyone" | "admins"; archived: boolean; myRole: "admin" | "member"; members: number;
}
export interface MyCommunity {
  id: string; kind: "community" | "family" | "church"; name: string; description: string | null; photoUrl: string | null;
  archived: boolean; myRole: string; groupIds: string[];
}
export interface GroupMember { id: string; role: string; name: string; photoUrl: string | null; isMe?: boolean }
export interface GroupDetail {
  id: string; name: string | null; description: string | null; photoUrl: string | null; createdAt: string; archived: boolean;
  posting: "everyone" | "admins"; isAnnouncements: boolean; community: { id: string; name: string } | null; myRole: "admin" | "member"; members: GroupMember[];
}
export interface CommunityDetail {
  id: string; name: string; description: string | null; photoUrl: string | null; archived: boolean; myRole: "owner" | "admin" | "member";
  members: GroupMember[];
  groups: { id: string; name: string | null; description: string | null; isAnnouncements: boolean; posting: string; archived: boolean; member: boolean; myRole: string | null }[];
}
export interface Invitation { id: string; type: "group" | "community"; targetId: string; name: string | null; description: string | null; invitedBy: string; createdAt: string }
export interface InviteLink { id: string; createdAt: string; expiresAt: string | null; maxUses: number | null; uses: number; requiresApproval: boolean; revoked: boolean }

const call = <T,>(path: string, init: RequestInit = {}) => apiRequest<T>(`/groups${path}`, init, { fallbackError: "That didn't work. Please try again." });
const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const typeQ = (type?: "group" | "community") => (type === "community" ? "?type=community" : "");

export const myGroups = () => call<{ groups: MyGroup[]; communities: MyCommunity[] }>("");
export const createGroup = (g: { name: string; description?: string; communityId?: string | null; memberIds?: string[]; posting?: "everyone" | "admins" }) => call<{ id: string }>("", send("POST", g));
export const getGroup = (id: string) => call<GroupDetail>(`/${id}`);
export const updateGroup = (id: string, p: { name?: string; description?: string; posting?: "everyone" | "admins"; archived?: boolean }) => call<{ saved: true }>(`/${id}`, send("PATCH", p));
export const addGroupMembers = (id: string, userIds: string[]) => call<{ added: number }>(`/${id}/members`, send("POST", { userIds }));
export const removeGroupMember = (id: string, userId: string) => call<{ removed: boolean }>(`/${id}/members/${userId}`, send("DELETE"));
export const setGroupAdmin = (id: string, userId: string, admin: boolean) => call<{ role: string }>(`/${id}/admins`, send("POST", { userId, admin }));
export const invite = (id: string, userIds: string[], type?: "group" | "community") => call<{ invited: number }>(`/${id}/invitations${typeQ(type)}`, send("POST", { userIds }));
export const myInvitations = () => call<{ invitations: Invitation[] }>("/invitations");
export const answerInvitation = (id: string, accept: boolean) => call<{ status: string; type: string; targetId: string }>(`/invitations/${id}`, send("POST", { accept }));
export const createLink = (id: string, o: { expiresInHours?: number; maxUses?: number; requiresApproval?: boolean }, type?: "group" | "community") =>
  call<{ id: string; token: string; expiresAt: string; maxUses: number | null; requiresApproval: boolean }>(`/${id}/links${typeQ(type)}`, send("POST", o));
export const listLinks = (id: string, type?: "group" | "community") => call<{ links: InviteLink[] }>(`/${id}/links${typeQ(type)}`);
export const revokeLink = (id: string, linkId: string, type?: "group" | "community") => call<{ revoked: true }>(`/${id}/links/${linkId}${typeQ(type)}`, send("DELETE"));
export const joinWithLink = (token: string) => call<{ status: "joined" | "requested"; type?: string; targetId?: string }>("/join", send("POST", { token }));
export const joinRequests = (id: string, type?: "group" | "community") => call<{ requests: { id: string; userId: string; name: string; createdAt: string }[] }>(`/${id}/requests${typeQ(type)}`);
export const decideRequest = (id: string, requestId: string, approve: boolean, type?: "group" | "community") => call<{ status: string }>(`/${id}/requests/${requestId}${typeQ(type)}`, send("POST", { approve }));
export const createCommunity = (c: { name: string; description?: string; memberIds?: string[]; announcements?: boolean }) => call<{ id: string }>("/communities", send("POST", c));
export const getCommunity = (id: string) => call<CommunityDetail>(`/communities/${id}`);
export const updateCommunity = (id: string, p: { name?: string; description?: string; archived?: boolean }) => call<{ saved: true }>(`/communities/${id}`, send("PATCH", p));
export const addCommunityMembers = (id: string, userIds: string[]) => call<{ added: number }>(`/communities/${id}/members`, send("POST", { userIds }));
export const removeCommunityMember = (id: string, userId: string) => call<{ removed: boolean }>(`/communities/${id}/members/${userId}`, send("DELETE"));
export const setCommunityAdmin = (id: string, userId: string, admin: boolean) => call<{ role: string }>(`/communities/${id}/admins`, send("POST", { userId, admin }));

/** The invite link people open (in P2P Global): /groups/join?t=<token>. */
export const inviteLinkPath = (token: string) => `/groups/join?t=${encodeURIComponent(token)}`;
