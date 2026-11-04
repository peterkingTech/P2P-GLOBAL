import { apiRequest } from "@/lib/apiClient";

// Discipleship genealogy + relationships (migrations 233–234). Generations come
// only from discipleship relationships; people beyond your own mentors and
// disciples appear as their privacy settings allow (a private profile is just
// "A disciple"). Nothing here can change who is in a lineage except your own
// relationship actions, which the server checks.

export interface LineagePerson {
  id: string | null; name: string; username: string | null; photoUrl: string | null; private: boolean;
  stage: { number: number; name: string; emoji: string } | null;
  isPrimary?: boolean; status?: string; since?: string | null; disciples?: number; generation?: number; generationsAbove?: number;
}
export interface MyLineage {
  me: LineagePerson; mentors: LineagePerson[]; lineAbove: LineagePerson[]; disciples: LineagePerson[];
  generations: { generation: number; people: number }[]; totalDescendants: number;
}
export interface Collective {
  activeRelationships: number; peopleBeingDiscipled: number; peopleDiscipling: number; generations: number; countries: number;
  stages: { stage: number; name: string; people: number }[]; relationshipsBegun: { month: string; relationships: number }[];
}
export interface RelationshipCard {
  linkId: string; status: "pending" | "active" | "paused" | "ended"; isPrimary: boolean; startedAt: string | null; pausedAt: string | null; endedAt: string | null; endReason: string | null; requestedAt: string;
  person: { id: string; name: string; username: string | null; photoUrl: string | null };
}

const g = <T,>(path: string, fallbackError: string) => apiRequest<T>(path, {}, { base: "/genealogy", fallbackError });
export const getMyLineage = () => g<MyLineage>("/me", "Couldn't load your lineage.");
export const getBranch = (personId: string) => g<{ generation: number; people: LineagePerson[] }>(`/branch/${encodeURIComponent(personId)}`, "Couldn't load this branch.");
export const getGeneration = (n: number, offset = 0) => g<{ generation: number; total: number; nextOffset: number | null; people: LineagePerson[] }>(`/me/generation/${n}?offset=${offset}`, "Couldn't load this generation.");
export const searchLineage = (q: string) => g<{ people: LineagePerson[] }>(`/me/search?q=${encodeURIComponent(q)}`, "Couldn't search your lineage.");
export const getCollective = () => g<Collective>("/collective", "Couldn't load the Forest of Nations.");

const d = <T,>(path: string, init: RequestInit, fallbackError: string) => apiRequest<T>(path, init, { base: "/discipleship", fallbackError });
const json = (body: unknown): RequestInit => ({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
export const getMyRelationships = () => d<{ mentors: RelationshipCard[]; disciples: RelationshipCard[] }>("/relationships/me", {}, "Couldn't load your relationships.");
export const changeRelationship = (linkId: string, action: "end" | "pause" | "resume", reason?: string) =>
  d<{ status: string }>(`/relationships/${encodeURIComponent(linkId)}/${action}`, json({ reason }), "Couldn't update the relationship.");
export const makePrimaryMentor = (linkId: string) => d<{ isPrimary: true }>(`/relationships/${encodeURIComponent(linkId)}/primary`, json({}), "Couldn't choose your primary mentor.");

/** "Generation 2 · 62 people" — plain words for a generation count. */
export const generationLabel = (n: number, people: number) => `Generation ${n} · ${people} ${people === 1 ? "person" : "people"}`;
