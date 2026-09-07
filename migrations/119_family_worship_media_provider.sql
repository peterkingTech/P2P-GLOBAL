-- 119: media provider boundary for Family Worship's Shared Media — additive
-- only. The existing media_id column was already generic enough to serve
-- as an external content id; the only genuinely new piece is knowing WHICH
-- provider that id belongs to, so the player can pick the right adapter
-- instead of guessing from a file extension (the exact bug that produced
-- "NotSupportedError: Failed to load because no supported source was
-- found" when a YouTube link was fed straight into expo-av's <Video>).
--
-- media_type/media_id/media_url are left completely untouched and remain
-- fully functional for the legacy raw-file case (a direct Supabase Storage
-- URL, say) — media_provider is simply null there, same as every row that
-- existed before this migration.
alter table p2p_family_worship_sessions
  add column if not exists media_provider text; -- 'youtube' | null (legacy raw file)