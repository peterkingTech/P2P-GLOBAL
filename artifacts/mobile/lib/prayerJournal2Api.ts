import { apiRequest } from "@/lib/apiClient";

// "Pray the Word" Stage 4 — client bindings for routes/prayerJournal.ts.
// Named prayerJournal2Api (not prayerJournalApi) to avoid any confusion
// with app/prayer/journal.tsx's existing direct-Supabase reads/writes,
// which keep working unchanged — this file is the additive path for
// entries that need server-verified cross-table links (Prayer 2.0 request
// ownership) or pagination.

export type JournalStatus = "still_praying" | "trusting_god" | "god_is_answering" | "answered" | "no_longer_needed";

export interface JournalEntry2 {
  id: string; userId: string; prayerText: string; category: string | null;
  isAnswered: boolean; answeredAt: string | null; answerNotes: string | null; isPrivate: boolean;
  createdAt: string; updatedAt: string; scriptureReferenceId: string | null; topicId: string | null;
  prayer2RequestId: string | null; status: JournalStatus | null;
}

export function createJournalEntry(input: {
  prayerText: string; category?: string | null; scriptureReferenceId?: string | null;
  topicId?: string | null; prayer2RequestId?: string | null; status?: JournalStatus | null;
}): Promise<JournalEntry2> {
  return apiRequest("/prayer/journal", { method: "POST", body: JSON.stringify(input) });
}
export function getMyJournal(page = 0, limit = 20, filter?: "answered" | "unanswered"): Promise<{ entries: JournalEntry2[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams({ page: String(page), limit: String(limit), ...(filter ? { filter } : {}) });
  return apiRequest(`/prayer/journal/mine?${q}`);
}
export function updateJournalEntry(id: string, updates: Partial<{
  prayerText: string; category: string | null; scriptureReferenceId: string | null; topicId: string | null;
  prayer2RequestId: string | null; status: JournalStatus | null; isAnswered: boolean; answerNotes: string | null;
}>): Promise<JournalEntry2> {
  return apiRequest(`/prayer/journal/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function deleteJournalEntry(id: string): Promise<{ removed: true }> {
  return apiRequest(`/prayer/journal/${id}`, { method: "DELETE" });
}
