-- Kingdom Stories library — exact client privileges (follow-up to 215).
--
-- 215 granted the intended privileges but did not first remove Supabase's
-- default ones, so signed-in users also held INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER on the four library tables. Row-level security already
-- refused every write outside the policies (saves: own rows; views and
-- collections: read-only), and TRUNCATE isn't reachable through the API —
-- this makes the grants say exactly what the policies allow.
-- Privileges only: no data, policy or function changes. Idempotent.

do $$
declare t text;
begin
  foreach t in array array['p2p_kingdom_story_saves', 'p2p_kingdom_story_views',
                           'p2p_kingdom_story_collections', 'p2p_kingdom_story_collection_items'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from public, anon, authenticated', t);
      execute format('grant all on public.%I to service_role', t);
    end if;
  end loop;
end $$;

-- Your own Favourites / Saved for Later (RLS: own rows only).
grant select, insert, delete on public.p2p_kingdom_story_saves to authenticated;
-- Recently viewed is written by the API; you can read your own.
grant select on public.p2p_kingdom_story_views to authenticated;
-- Published collections (editors see drafts through the API).
grant select on public.p2p_kingdom_story_collections, public.p2p_kingdom_story_collection_items to authenticated;
