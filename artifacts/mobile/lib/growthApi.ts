import { apiRequest } from "@/lib/apiClient";

// Your growth journey (GET /growth/me — migrations 235–237). The stage is
// calculated on the server from real, dated activity; the app only shows it.

export interface GrowthStageInfo { stage: number; key: string; name: string; emoji: string; description: string; verse: string; verseRef: string }
export interface GrowthChecklistItem { label: string; met: boolean; have: number; need: number }
export interface GrowthDimension { dimension: "consistency" | "learning" | "fruit" | "discipleship"; label: string; required: boolean; met: boolean; items: GrowthChecklistItem[] }
export interface GrowthJourney {
  stage: GrowthStageInfo & { since: string; verification: "verified" | "legacy_unverified"; legacyNote: string | null };
  next: (GrowthStageInfo & { dimensions: GrowthDimension[] }) | null;
  milestones: "draft" | "approved";
  promotionsEnabled: boolean;
  history: { stage: number; name: string; achievedAt: string; kind: "automatic" | "legacy_import" | "correction" }[];
  collective: { name: string; emoji: string; description: string; verse: string; verseRef: string; note: string };
  evaluatedAt: string | null;
}

export const getGrowthJourney = () => apiRequest<GrowthJourney>("/growth/me", {}, { fallbackError: "Couldn't load your growth journey." });

/** "3 weeks" / "2 months" in the current stage — whole units, never a percentage. */
export function timeInStage(since: string, now: number = Date.now()): string {
  const days = Math.max(0, Math.floor((now - Date.parse(since)) / 86_400_000));
  if (days < 1) return "since today";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  const months = Math.floor(days / 30.44);
  return months < 24 ? `${months} months` : `${Math.floor(months / 12)} years`;
}

/** "5 of 8" for a milestone — a count against its requirement (no percentages). */
export const progressText = (i: GrowthChecklistItem) => (i.met ? "Done" : `${Math.min(i.have, i.need)} of ${i.need}`);
