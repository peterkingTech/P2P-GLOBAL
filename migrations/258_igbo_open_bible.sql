-- 258 — Igbo Contemporary Bible, open licence (owner 2026-11-20: "commit, push, and run all the pending migrations";
-- 2026-11-19: "I want only Igbo to play … to honor my parents").
-- Biblica's Igbo Contemporary Bible (2020) — the same text P2P shows from API.Bible as BIUO / ICB — is published by
-- Biblica under CC BY-SA 4.0 (primary source, read 2026-11-19: https://ebible.org/Scriptures/details.php?id=ibo):
-- share "in any format", adaptations allowed, commercial use allowed (CC BY-SA), with attribution, share-alike, the
-- changes indicated, and no Biblica® trademark on a derivative. AO Lab serves it as `ibo_bib` (66 books).
-- With this row, P2P Voice (9jaLingo Igbo voices) may read it — a derivative (audio) work credited as Biblica asks.
-- Permissions mirror the reviewed Hausa Contemporary Bible row (AO-hau_bib, migration 226): display + commercial;
-- no server caching, no offline copies, no copying of verse text.
-- ADDITIVE: one new row; nothing existing is changed. Applying this migration is the owner's sign-off; the reviewer
-- recorded is the earliest super admin (the rule from migration 225).
-- Rollback: delete from p2p_bible_translations where translation_code = 'AO-ibo_bib'.
begin;

insert into public.p2p_bible_translations (language, translation_code, translation_name, is_default_for_language, provider, provider_translation_id, abbreviation, description,
  text_direction, copyright_notice, licence_name, licence_url, attribution, source_url, provider_licence, permits_display, permits_commercial, permits_caching, permits_offline, permits_audio, permits_sharing,
  licence_status, licence_questions, reviewed_by, reviewed_at, is_licensed_confirmed, license_notes, coverage, is_curated, selection_rationale)
select 'ig', $o$AO-ibo_bib$o$, $o$Igbo Contemporary Bible (open licence)$o$, false, 'helloao', $o$ibo_bib$o$, $o$ICB$o$, $o$Complete Bible (Old and New Testaments)$o$,
  'ltr', $o$Copyright © 2020 Biblica, Inc.$o$, $o$CC BY-SA 4.0$o$, $o$https://creativecommons.org/licenses/by-sa/4.0/$o$,
  $o$Copyright © 2020 Biblica, Inc.. Licensed under CC BY-SA 4.0. The original work by Biblica, Inc. is available for free at www.biblica.com and open.bible.$o$,
  $o$https://ebible.org/Scriptures/details.php?id=ibo$o$,
  $o${"attribution":"required","commercialUse":"allowed","derivatives":"allowed","copyleft":true,"publicDomain":false}$o$::jsonb,
  true, true, false, false, false, false,
  'approved',
  $o$This work is made available under the Creative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA). You have permission to share and redistribute this Bible translation in any format and to make reasonable revisions and adaptations, provided the copyright and source are included, changes are indicated, and derivatives are shared under the same licence.
Trademark: use of the Biblica® trademark requires the written permission of Biblica, Inc. A derivative work (e.g. P2P Voice audio) must not carry the Biblica® trademark and must be attributed: "The original work by Biblica, Inc. is available for free at www.biblica.com and open.bible."$o$,
  (select id from public.p2p_profiles where role::text = 'super_admin' order by created_at limit 1), now(), true,
  $o$CC BY-SA 4.0 — Copyright © 2020 Biblica, Inc. (verified at eBible.org 2026-11-19). P2P Voice may read it (derivative audio, CC BY-SA, credited).$o$,
  'bible', true,
  $o$Complete Igbo Bible under an open licence, so P2P Voice's Igbo voices may read it (the API.Bible copy of the same text is display-only) — owner 2026-11-19.$o$
where not exists (select 1 from public.p2p_bible_translations t where t.translation_code = 'AO-ibo_bib' or (t.provider = 'helloao' and t.provider_translation_id = 'ibo_bib'));

commit;
