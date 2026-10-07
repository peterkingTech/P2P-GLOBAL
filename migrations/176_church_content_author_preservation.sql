-- 176: Keep church content when its author's account is deleted.
--
-- p2p_church_announcements.author_id and p2p_church_learning_goals.created_by
-- CASCADEd from p2p_profiles, so deleting a church leader's account would
-- also delete announcements and learning goals the whole church relies on.
-- Same treatment as migration 175's shared records: the content stays and
-- the author reference becomes null ("Deleted user"). The API code that
-- lists announcement authors skips null ids (same change).
--
-- Both tables are empty in production at the time of writing (0 rows), so
-- no row is affected; this only changes what a future deletion does.

alter table public.p2p_church_announcements alter column author_id drop not null;
alter table public.p2p_church_announcements drop constraint if exists p2p_church_announcements_author_id_fkey;
alter table public.p2p_church_announcements add constraint p2p_church_announcements_author_id_fkey
  foreign key (author_id) references public.p2p_profiles(id) on delete set null;

alter table public.p2p_church_learning_goals alter column created_by drop not null;
alter table public.p2p_church_learning_goals drop constraint if exists p2p_church_learning_goals_created_by_fkey;
alter table public.p2p_church_learning_goals add constraint p2p_church_learning_goals_created_by_fkey
  foreign key (created_by) references public.p2p_profiles(id) on delete set null;
