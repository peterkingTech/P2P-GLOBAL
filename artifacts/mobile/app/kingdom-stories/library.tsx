import React, { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { getLibraryShelf, SHELF_LABELS, type LibraryShelf, type StoryCard } from "@/lib/kingdomStoriesApi";
import StoryGridScreen, { PillRow } from "@/components/kingdom-stories/StoryGridScreen";

// My Kingdom Stories library: Favourites, Saved for Later, In Progress,
// Completed and Recently Viewed — all from the reader's own records; In
// Progress / Completed come from real chapter progress (never from opening).
const SHELVES: LibraryShelf[] = ["favourites", "later", "in_progress", "completed", "recent"];
const EMPTY: Record<LibraryShelf, string> = {
  favourites: "Tap the heart on any story to keep it here.",
  later: "Use “Save for Later” on a story to come back to it.",
  in_progress: "Stories you've started will appear here with your progress.",
  completed: "Stories you finish (every chapter done) appear here.",
  recent: "Stories you open appear here.",
};

export default function KingdomStoriesLibraryScreen() {
  const params = useLocalSearchParams<{ shelf?: string }>();
  const [shelf, setShelf] = useState<LibraryShelf>(SHELVES.includes(params.shelf as LibraryShelf) ? (params.shelf as LibraryShelf) : "favourites");
  const [stories, setStories] = useState<StoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async (s: LibraryShelf) => {
    setLoading(true); setError(null);
    try { const r = await getLibraryShelf(s, 60); setStories(r.stories); setUnavailable(!r.available); }
    catch (e: any) { setStories([]); setError(e?.message ?? "Couldn't load your library."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(shelf); }, [load, shelf]));

  return (
    <StoryGridScreen
      title="My Library"
      subtitle="Only you can see your library."
      controls={<PillRow label="Library shelves" value={shelf} onChange={(v) => { setStories([]); setShelf(v); }} options={SHELVES.map((s) => ({ value: s, label: SHELF_LABELS[s] }))} />}
      stories={stories} loading={loading} error={error} onRetry={() => load(shelf)}
      emptyText={unavailable ? "Your library will be available after the next update." : EMPTY[shelf]}
    />
  );
}
