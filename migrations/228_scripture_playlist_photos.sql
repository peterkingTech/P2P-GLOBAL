-- 228 (approved by the owner 2026-11-03; restore-tested, applied with the guarded
-- production procedure): your own photos for Scripture playlists and collections —
-- a square cover photo and a wide header photo shown across the top of the
-- playlist page.
--
-- Security (the 209 pattern):
--   • A PRIVATE storage bucket with NO storage.objects policies for anon /
--     authenticated: clients can't list, read or write it directly. Uploads
--     and views go through the API (routes/scriptureCollections.ts), which
--     lets only the playlist's owner upload, and shows a photo only to people
--     who can see that playlist right now — through short-lived signed links.
--     Unsharing a playlist stops its photos at once (no new links).
--   • Object paths are server-generated: <owner id>/<slot>-<collection id>-<random>.<ext>.
--   • Images only, up to 8 MB.
--   • The cover photo uses 227's cover_kind = 'image' / cover_ref (the path);
--     the header photo is a new nullable column, header_ref (the path).
-- Additive only: no existing row changes (header_ref starts empty).

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scripture-library-images', 'scripture-library-images', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

alter table public.p2p_scripture_collections
  add column if not exists header_ref text
    constraint p2p_scripture_collections_header_ref_check check (header_ref is null or header_ref ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$');

commit;

-- Rollback (removes the header column; the bucket must be emptied and deleted
-- through the Storage API — Supabase blocks deleting storage.buckets in SQL):
--   alter table public.p2p_scripture_collections drop column if exists header_ref;
--   update public.p2p_scripture_collections set cover_kind = null, cover_ref = null where cover_kind = 'image';
