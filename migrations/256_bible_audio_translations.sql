-- 256 — New API.Bible text editions that come WITH recorded audio in the owner's API.Bible plan (owner 2026-11-19:
-- "new licences have been added to my API … these translations have audio too").
-- PROPOSED ONLY — not applied. Apply with the guarded apply script after owner approval.
--
-- Additive: inserts 7 translation rows (never updates or deletes). Each is a complete text edition in the owner's
-- plan, with its own audio edition (artifacts/api-server/src/lib/bibleAudio.ts AUDIO_EDITIONS):
--   BSB    Berean Standard Bible                  — Public Domain (API.Bible record)        audio: BSB non-drama
--   WEB    World English Bible                    — Public Domain (API.Bible record)        audio: WEB 2013 drama (NT only)
--   IRVHin / IRVBen / IRVTam / IRVTel / IRVUrd    — Indian Revised Version 2019, Bridge Connectivity Solutions,
--                                                    Creative Commons licence (API.Bible record)  audio: each language's IRV
-- The nine translations already in P2P whose audio editions are in the plan (ONAV, BCV, HCV, BIUO, ONEN, OTCV,
-- WAKNA, WASNA, BMYO) need NO database change — their audio plays once the API with lib/bibleAudio.ts is deployed.
-- Licence notes: BSB/WEB are public domain (so P2P Voice may also read them); IRV is an open licence (CC BY-SA) —
-- displayed and its OWN recorded audio streamed; not public domain, so P2P Voice does not synthesise it.
begin;

insert into public.p2p_bible_translations (language, translation_code, translation_name, is_default_for_language, provider, api_bible_id, is_licensed_confirmed, license_notes)
select v.language, v.code, v.name, false, 'api.bible', v.api_id, true, v.notes
from (values
  ('en', 'BSB',    'Berean Standard Bible',                   '317e03834065a236-01', 'Public Domain — in the owner''s API.Bible plan (2026-11-19). Audio: Berean Standard Audio Bible (non-drama).'),
  ('en', 'WEB',    'World English Bible',                     '9879dbb7cfe39e4d-01', 'Public Domain — in the owner''s API.Bible plan (2026-11-19). Audio: World English Bible 2013, dramatised New Testament.'),
  ('hi', 'IRVHin', 'Indian Revised Version (IRV) Hindi 2019', '1e8ab327edbce67f-01', 'Creative Commons licence — Indian Revised Version (IRV) Hindi 2019 by Bridge Connectivity Solutions Pvt. Ltd.; in the owner''s API.Bible plan (2026-11-19), with its audio edition.'),
  ('bn', 'IRVBen', 'Indian Revised Version (IRV) Bengali',    '4c3eda00cd317568-01', 'Creative Commons licence — Indian Revised Version (IRV) Bengali 2019 by Bridge Connectivity Solutions Pvt. Ltd.; in the owner''s API.Bible plan (2026-11-19), with its audio edition.'),
  ('ta', 'IRVTam', 'Indian Revised Version (IRV) Tamil 2019', '03a021185023710b-01', 'Creative Commons licence — Indian Revised Version (IRV) Tamil 2019 by Bridge Connectivity Solutions Pvt. Ltd.; in the owner''s API.Bible plan (2026-11-19), with its audio edition.'),
  ('te', 'IRVTel', 'Indian Revised Version (IRV) Telugu 2019','5b835ce16a1703ff-01', 'Creative Commons licence — Indian Revised Version (IRV) Telugu 2019 by Bridge Connectivity Solutions Pvt. Ltd.; in the owner''s API.Bible plan (2026-11-19), with its audio edition.'),
  ('ur', 'IRVUrd', 'Indian Revised Version (IRV) Urdu 2019',  'de0270810140edf9-01', 'Creative Commons licence — Indian Revised Version (IRV) Urdu 2019 by Bridge Connectivity Solutions Pvt. Ltd.; in the owner''s API.Bible plan (2026-11-19), with its audio edition.')
) as v(language, code, name, api_id, notes)
where not exists (select 1 from public.p2p_bible_translations t where t.translation_code = v.code or t.api_bible_id = v.api_id);

commit;
