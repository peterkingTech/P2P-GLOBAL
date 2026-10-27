import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { getKingdomStoriesFeed, type FeedSort, type StoryCard } from "@/lib/kingdomStoriesApi";
import StoryGridScreen, { PillRow } from "@/components/kingdom-stories/StoryGridScreen";

// Every published story. Default: the approved topic-number order. Topic
// number descending and category order are arranged here from the same list
// the server sorts (topic / title / recently added / recently updated).
type Sort = "topic" | "topic_desc" | "title" | "recent" | "updated" | "category";
const SORTS: { value: Sort; label: string }[] = [
  { value: "topic", label: "Topic No. ↑" }, { value: "topic_desc", label: "Topic No. ↓" }, { value: "title", label: "Title A–Z" },
  { value: "recent", label: "Recently Added" }, { value: "updated", label: "Recently Updated" }, { value: "category", label: "Category" },
];
const PAGE = 50;

export default function AllKingdomStoriesScreen() {
  const params = useLocalSearchParams<{ sort?: string }>();
  const [sort, setSort] = useState<Sort>(SORTS.some((s) => s.value === params.sort) ? (params.sort as Sort) : "topic");
  const [stories, setStories] = useState<StoryCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const serverSort: FeedSort = sort === "title" || sort === "recent" || sort === "updated" ? sort : "topic";

  const loadPage = useCallback(async (page: number) => {
    const mine = ++seq.current;
    page === 0 ? setLoading(true) : setMore(true);
    try {
      const r = await getKingdomStoriesFeed({ sort: serverSort, page, limit: PAGE });
      if (mine !== seq.current) return;
      setStories((prev) => (page === 0 ? r.stories : [...prev, ...r.stories]));
      setTotal(r.total); setError(null);
    } catch (e: any) { if (mine === seq.current && page === 0) setError(e?.message ?? "Couldn't load stories."); }
    finally { if (mine === seq.current) { setLoading(false); setMore(false); } }
  }, [serverSort]);
  useEffect(() => { setStories([]); loadPage(0); }, [loadPage]);

  const shown = sort === "topic_desc" ? [...stories].reverse()
    : sort === "category" ? [...stories].sort((a, b) => (a.category?.title ?? "").localeCompare(b.category?.title ?? "") || (a.topicNumber ?? 1e6) - (b.topicNumber ?? 1e6))
    : stories;
  // Reversing / grouping needs the whole list, so those load every page.
  useEffect(() => { if ((sort === "topic_desc" || sort === "category") && !loading && !more && stories.length < total) loadPage(Math.floor(stories.length / PAGE)); }, [sort, loading, more, stories.length, total, loadPage]);

  return (
    <StoryGridScreen
      title="All Kingdom Stories"
      subtitle={total ? `${total} published ${total === 1 ? "story" : "stories"}` : null}
      controls={<PillRow label="Sort stories" value={sort} onChange={setSort} options={SORTS} />}
      stories={shown} loading={loading} error={error} onRetry={() => loadPage(0)}
      emptyText="Kingdom Stories will appear here as new stories are published."
      onEndReached={() => { if (!more && !loading && stories.length < total && sort !== "topic_desc" && sort !== "category") loadPage(Math.floor(stories.length / PAGE)); }}
      footerLoading={more}
    />
  );
}
