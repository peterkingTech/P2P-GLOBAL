import React, { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { getStoryCollection, type StoryCard } from "@/lib/kingdomStoriesApi";
import StoryGridScreen from "@/components/kingdom-stories/StoryGridScreen";

// One editorial collection (e.g. "Start Here"), in the editors' order.
export default function KingdomStoryCollectionScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [title, setTitle] = useState("Collection");
  const [description, setDescription] = useState<string | null>(null);
  const [stories, setStories] = useState<StoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try { const c = await getStoryCollection(slug); setTitle(c.title); setDescription(c.description); setStories(c.stories); setError(null); }
    catch (e: any) { setError(e?.status === 404 ? "This collection isn't available." : e?.message ?? "Couldn't load this collection."); }
    finally { setLoading(false); }
  }, [slug]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return <StoryGridScreen title={title} subtitle={description} stories={stories} loading={loading} error={error} onRetry={load} emptyText="No stories in this collection yet." />;
}
