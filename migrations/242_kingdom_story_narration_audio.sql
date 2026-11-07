-- 242 — Kingdom Stories studio narration files. Written 2026-11-07. REQUIRES 152.
-- NOT APPLIED. Additive; nothing is deleted or changed for existing files.
--
-- Chapter narrations (ElevenLabs, generated server-side by api-server/scripts/narrate.mjs) are stored
-- beside each story's other media, at kingdom-stories-media/<storyId>/narration/<chapterId>.mp3 and
-- <chapterId>.json (the recording's word timings). The bucket so far accepts only images and video,
-- so this adds exactly two types: audio/mpeg and application/json. Nothing else changes:
--   • the bucket stays private (the API hands readers a signed link, after the chapter-open check);
--   • the existing policies already cover these paths (editors manage; readers may read only files
--     whose first path segment is a PUBLISHED story's id);
--   • the size limit (100 MB) is unchanged; a long chapter is about 12 MB.

update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct t order by t)
  from unnest(coalesce(allowed_mime_types, array[]::text[]) || array['audio/mpeg', 'application/json']) as t
)
where id = 'kingdom-stories-media'
  and not (coalesce(allowed_mime_types, array[]::text[]) @> array['audio/mpeg', 'application/json']);

do $$
declare v text[];
begin
  select allowed_mime_types into v from storage.buckets where id = 'kingdom-stories-media';
  if v is not null and not (v @> array['audio/mpeg', 'application/json', 'image/jpeg', 'video/mp4']) then
    raise exception 'P2P_NARRATION_242: kingdom-stories-media types not as expected: %', v;
  end if;
  raise notice 'P2P_NARRATION_242: kingdom-stories-media now accepts %', v;
end $$;
