-- 032: P2P Fruit System — schema + complete fruit catalog (Phase 1)
--
-- This is NOT a badge/achievement system. Fruits celebrate observable
-- evidence of discipleship (Galatians 5:22-23 framing) — they are permanent,
-- never revoked, and tell the story of a believer's journey. The catalog is
-- data-driven (p2p_fruits_catalog) so admins can add new fruits without a
-- code change; the award engine that actually grants them is migration 033.
--
-- Data-model notes discovered while writing this (see .agents/memory and the
-- live DB, both confirmed 2026-07-22):
--   - Core curriculum ("Foundations of Christianity") has 13 modules,
--     order_index 0-12. Module 0 is "PEER-TO-PEER ORIENTATION" (app/reviewer
--     mechanics, not doctrinal content) — the fruit spec's "12-module Core
--     Curriculum" (Maturity Fruit) means modules 1-12, excluding module 0.
--     Module 1 = "YOUR NEW IDENTITY IN CHRIST", Module 5 = "THE BIBLE",
--     Module 6 = "PRAYER", Module 10 = "SHARING YOUR FAITH" — these line up
--     exactly with the Christ Identity / Wisdom / Prayer / Evangelism fruits.
--   - p2p_plans (the Kingdom Plans system) has ZERO rows right now — no
--     Business/Education/Government/Media/Technology/Family/Church Ministry
--     plan content exists yet. The 7 Kingdom Influence fruits and the
--     Stephen/Revival/Mission fruits are still seeded here in full (the
--     catalog is descriptive, not dependent on content existing), but their
--     award-engine triggers (migration 033) cannot fire — and can't be
--     tested — until that Plan content is actually created.

-- ── Tables ────────────────────────────────────────────────────────────────────

-- p2p_user_fruits already existed with an old, incompatible ad-hoc schema
-- (fruit_name/description/icon_name/earned_at — never captured in any
-- migration, and never written to by any trigger). Confirmed empty (zero
-- rows) before dropping — no real earned-fruit data exists to migrate.
drop table if exists p2p_user_fruits cascade;

create table if not exists p2p_fruits_catalog (
  id                          uuid primary key default uuid_generate_v4(),
  fruit_key                   text unique not null,
  name                        text not null,
  description                 text not null,
  category                    text not null check (category in (
                                'personal_growth', 'community', 'multiplication',
                                'faithfulness', 'kingdom_influence', 'special', 'legendary'
                              )),
  verification_level         text not null check (verification_level in ('system', 'peer', 'mentor')),
  rarity                      text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  icon                        text not null,
  theme_verse                 text,
  theme_verse_text            text,
  biblical_meaning            text,
  unlock_condition_description text,
  unlock_condition_rules      jsonb,
  xp_value                    integer not null default 0,
  is_hidden                   boolean not null default false,
  is_active                   boolean not null default true,
  is_seasonal                 boolean not null default false,
  status                      text not null default 'active',
  display_order               integer,
  created_at                  timestamptz not null default now()
);

create table if not exists p2p_user_fruits (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  fruit_key          text not null references p2p_fruits_catalog(fruit_key),
  awarded_at         timestamptz not null default now(),
  awarded_by         text not null check (awarded_by in ('system', 'peer', 'mentor', 'admin')),
  awarded_by_user_id uuid references auth.users(id),
  evidence           jsonb not null,
  evidence_summary   text,
  source_type        text check (source_type in ('lesson', 'module', 'plan', 'peer_action', 'mentor_action', 'streak', 'milestone')),
  source_id          uuid,
  is_visible         boolean not null default true,
  notes              text,
  unique (user_id, fruit_key)
);

create index if not exists idx_p2p_user_fruits_user on p2p_user_fruits(user_id, awarded_at desc);

create table if not exists p2p_fruit_progress (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  fruit_key        text not null references p2p_fruits_catalog(fruit_key),
  current_count    integer not null default 0,
  required_count   integer not null,
  progress_details jsonb,
  last_updated     timestamptz not null default now(),
  unique (user_id, fruit_key)
);

create table if not exists p2p_fruit_audit_log (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  fruit_key         text not null,
  event_type        text not null check (event_type in ('eligibility_check', 'awarded', 'already_held', 'not_eligible')),
  trigger_event     text not null,
  trigger_source_id uuid,
  result            jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_p2p_fruit_audit_log_user on p2p_fruit_audit_log(user_id, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table p2p_fruits_catalog enable row level security;
alter table p2p_user_fruits enable row level security;
alter table p2p_fruit_progress enable row level security;
alter table p2p_fruit_audit_log enable row level security;

drop policy if exists "Authenticated users can read fruit catalog" on p2p_fruits_catalog;
create policy "Authenticated users can read fruit catalog" on p2p_fruits_catalog
  for select to authenticated using (true);

drop policy if exists "Admins can manage fruit catalog" on p2p_fruits_catalog;
create policy "Admins can manage fruit catalog" on p2p_fruits_catalog
  for all using (p2p_is_admin()) with check (p2p_is_admin());

drop policy if exists "Users can read own fruits" on p2p_user_fruits;
create policy "Users can read own fruits" on p2p_user_fruits
  for select using (auth.uid() = user_id or p2p_is_admin());

-- No general insert/update/delete policy for regular users — fruits are only
-- ever written by the SECURITY DEFINER award engine (migration 033) or admins.
drop policy if exists "Admins can manage user fruits" on p2p_user_fruits;
create policy "Admins can manage user fruits" on p2p_user_fruits
  for all using (p2p_is_admin()) with check (p2p_is_admin());

drop policy if exists "Users can read own fruit progress" on p2p_fruit_progress;
create policy "Users can read own fruit progress" on p2p_fruit_progress
  for select using (auth.uid() = user_id or p2p_is_admin());

drop policy if exists "Admins can manage fruit progress" on p2p_fruit_progress;
create policy "Admins can manage fruit progress" on p2p_fruit_progress
  for all using (p2p_is_admin()) with check (p2p_is_admin());

drop policy if exists "Admins can read fruit audit log" on p2p_fruit_audit_log;
create policy "Admins can read fruit audit log" on p2p_fruit_audit_log
  for select using (p2p_is_admin());

-- ── Catalog seed (52 fruits) ──────────────────────────────────────────────────
insert into p2p_fruits_catalog (
  fruit_key, name, description, category, verification_level, rarity, icon,
  theme_verse, theme_verse_text, biblical_meaning,
  unlock_condition_description, unlock_condition_rules,
  xp_value, is_hidden, display_order
) values

-- PERSONAL GROWTH ─────────────────────────────────────────────────────────────
('christ_identity_fruit', 'The Christ Identity Fruit',
 'Awarded for grounding your identity in who Christ says you are.',
 'personal_growth', 'system', 'common', '🌱',
 '2 Corinthians 5:17', 'Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!',
 'Discipleship begins with identity, not behavior. Before a believer is asked to change how they live, Scripture first tells them who they now are in Christ — a new creation, not a repaired old one.',
 'Complete every lesson in Module 1: Your New Identity in Christ.',
 '{"type":"module_complete","module_order_index":1}'::jsonb,
 10, false, 1),

('wisdom_fruit', 'The Wisdom Fruit',
 'Awarded for building your life on God''s Word.',
 'personal_growth', 'system', 'common', '📖',
 'Proverbs 2:6', 'For the Lord gives wisdom; from his mouth come knowledge and understanding.',
 'Wisdom in Scripture is never mere information — it is a gift given by God to those who seek His Word earnestly and let it shape how they see the world.',
 'Complete every lesson in Module 5: The Bible — God''s Word to You.',
 '{"type":"module_complete","module_order_index":5}'::jsonb,
 10, false, 2),

('prayer_fruit', 'The Prayer Fruit',
 'Awarded for learning to talk with God.',
 'personal_growth', 'system', 'common', '🙏',
 'Philippians 4:6', 'Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God.',
 'Prayer is the ongoing conversation at the center of a disciple''s relationship with God — not a religious formality, but the way an anxious heart finds peace.',
 'Complete every lesson in Module 6: Prayer — Talking with God.',
 '{"type":"module_complete","module_order_index":6}'::jsonb,
 10, false, 3),

('faith_fruit', 'The Faith Fruit',
 'Awarded for pressing all the way through an assignment with confidence in what is unseen.',
 'personal_growth', 'system', 'rare', '🔥',
 'Hebrews 11:1', 'Now faith is confidence in what we hope for and assurance about what we do not see.',
 'Faith is substance, not sentiment — the writer of Hebrews describes it as something a believer actually holds onto and acts from, especially when the outcome isn''t yet visible.',
 'Complete every assignment in any single module.',
 '{"type":"all_assignments_in_any_module"}'::jsonb,
 25, false, 4),

('obedience_fruit', 'The Obedience Fruit',
 'Awarded for following through completely — lessons, reflections, and assignments alike.',
 'personal_growth', 'system', 'rare', '🌿',
 'John 14:15', 'If you love me, keep my commands.',
 'Jesus ties love directly to obedience — not as a burden, but as the natural evidence of a heart that genuinely loves Him. Finishing what was started, without skipping the harder parts, is a small picture of that.',
 'Complete every lesson, reflection, and assignment in any single module without skipping any of them.',
 '{"type":"module_fully_done"}'::jsonb,
 25, false, 5),

('joy_fruit', 'The Joy Fruit',
 'Awarded for a season of learning marked by joy rather than correction.',
 'personal_growth', 'system', 'common', '😊',
 'John 15:11', 'I have told you this so that my joy may be in you and that your joy may be complete.',
 'Jesus speaks of His joy becoming ours — a joy that isn''t dependent on circumstances but flows from abiding in Him, evident in a steady, unhurried walk of growth.',
 'Complete 10 lessons consecutively without any of them receiving a "needs revision" status.',
 '{"type":"consecutive_lessons_no_revision","count":10}'::jsonb,
 10, false, 6),

('peace_fruit', 'The Peace Fruit',
 'Awarded for a sustained, steady rhythm of showing up to grow.',
 'personal_growth', 'system', 'rare', '🕊',
 'Philippians 4:7', 'And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.',
 'Peace in Scripture guards the heart — it is the fruit of a settled, unhurried life lived close to God, visible in the quiet consistency of someone who keeps returning day after day.',
 'Maintain active lesson progress across 14 consecutive calendar days.',
 '{"type":"active_calendar_days_window","count":14}'::jsonb,
 25, false, 7),

('perseverance_fruit', 'The Perseverance Fruit',
 'Awarded for coming back and finishing what was started.',
 'personal_growth', 'system', 'rare', '💪',
 'James 1:4', 'Let perseverance finish its work so that you may be mature and complete, not lacking anything.',
 'James describes perseverance as something that must be allowed to finish its work — it isn''t proven in the easy stretch, but in choosing to return after a season of struggle or distraction.',
 'Complete a lesson after a gap of 30 or more days of inactivity.',
 '{"type":"resume_after_gap_lesson_complete","min_gap_days":30}'::jsonb,
 25, false, 8),

('maturity_fruit', 'The Maturity Fruit',
 'Awarded for completing the entire Core Curriculum.',
 'personal_growth', 'system', 'epic', '🌳',
 'Ephesians 4:15', 'Instead, speaking the truth in love, we will grow to become in every respect the mature body of him who is the head, that is, Christ.',
 'Spiritual maturity is a whole-life growth, not a single milestone — Paul describes a believer growing in every respect toward Christ, which is exactly what walking the full curriculum, module after module, represents.',
 'Complete the entire 12-module Core Curriculum (Modules 1 through 12).',
 '{"type":"all_modules_complete","module_order_indexes":[1,2,3,4,5,6,7,8,9,10,11,12]}'::jsonb,
 50, false, 9),

('evangelism_fruit', 'The Evangelism Fruit',
 'Awarded for learning to share your faith without shame.',
 'personal_growth', 'system', 'common', '🌍',
 'Romans 1:16', 'For I am not ashamed of the gospel, because it is the power of God that brings salvation to everyone who believes.',
 'Paul''s confidence in the gospel wasn''t in his own ability to persuade, but in the gospel''s own power to save — a foundation that frees a believer to share their faith without fear.',
 'Complete every lesson in Module 10: Sharing Your Faith.',
 '{"type":"module_complete","module_order_index":10}'::jsonb,
 10, false, 10),

('reflection_fruit', 'The Reflection Fruit',
 'Awarded for genuinely wrestling with what you''ve been taught.',
 'personal_growth', 'system', 'common', '📝',
 'Psalm 119:15', 'I meditate on your precepts and consider your ways.',
 'The psalmist doesn''t just read God''s Word — he meditates on it and considers it, letting it press into his own life. Answering every reflection question is that same posture in practice.',
 'Answer every reflection question in any single module.',
 '{"type":"all_reflections_in_any_module"}'::jsonb,
 10, false, 11),

('study_fruit', 'The Study Fruit',
 'Awarded for thoroughness — leaving no resource in a plan unopened.',
 'personal_growth', 'system', 'rare', '📚',
 '2 Timothy 2:15', 'Do your best to present yourself to God as one approved, a worker who does not need to be ashamed and who correctly handles the word of truth.',
 'Paul charges Timothy to be a diligent, unashamed worker with the truth — someone who studies thoroughly rather than settling for the surface.',
 'Complete every lesson resource available in any single Plan.',
 '{"type":"all_resources_in_any_plan"}'::jsonb,
 25, false, 12),

-- FAITHFULNESS ────────────────────────────────────────────────────────────────
('consistency_fruit', 'The Consistency Fruit',
 'Awarded for showing up faithfully, week after week.',
 'faithfulness', 'system', 'common', '⏳',
 'Luke 16:10', 'Whoever can be trusted with very little can also be trusted with much.',
 'Jesus ties trustworthiness in small, repeated things to being entrusted with more — consistency across ordinary weeks is exactly that kind of small faithfulness.',
 'Show active lesson progress in each of 4 consecutive calendar weeks.',
 '{"type":"active_weeks_streak","count":4}'::jsonb,
 10, false, 13),

('diligence_fruit', 'The Diligence Fruit',
 'Awarded for a focused, unbroken week of daily learning.',
 'faithfulness', 'system', 'rare', '🌞',
 'Proverbs 13:4', 'The diligent are fully satisfied.',
 'Proverbs contrasts idle craving with diligent effort — the diligent are the ones who are satisfied, because they did the daily, unglamorous work.',
 'Complete at least one lesson on each of 7 consecutive calendar days.',
 '{"type":"active_days_streak","count":7}'::jsonb,
 25, false, 14),

('endurance_fruit', 'The Endurance Fruit',
 'Awarded for six months of walking this road.',
 'faithfulness', 'system', 'epic', '📅',
 'Hebrews 12:1', 'Let us run with perseverance the race marked out for us.',
 'The Christian life is described as a long race, not a sprint — endurance is what it takes to still be running six months in.',
 'Remain active for 180 days since joining, with real learning activity along the way.',
 '{"type":"days_since_join_active","count":180}'::jsonb,
 50, false, 15),

('steadfast_fruit', 'The Steadfast Fruit',
 'Awarded for returning after a long absence and picking a lesson back up.',
 'faithfulness', 'system', 'rare', '🛡',
 '1 Corinthians 15:58', 'Stand firm. Let nothing move you. Always give yourselves fully to the work of the Lord, because you know that your labor in the Lord is not in vain.',
 'Paul''s charge to stand firm isn''t about never stumbling — it''s about not staying away. Coming back after 30+ days and completing a lesson is steadfastness in action.',
 'Return after a gap of 30 or more days of inactivity and complete a lesson.',
 '{"type":"resume_after_gap_lesson_complete","min_gap_days":30}'::jsonb,
 25, false, 16),

('restoration_fruit', 'The Restoration Fruit',
 'Awarded for returning after time away and finishing a whole module.',
 'faithfulness', 'system', 'rare', '↩️',
 'Joel 2:25', 'I will repay you for the years the locusts have eaten.',
 'God''s promise through Joel is one of restoration — years that felt lost are not wasted with Him. Coming back after a real gap and finishing an entire module is a picture of that restored time.',
 'Return after a gap of 14 or more days of inactivity and complete a full module.',
 '{"type":"resume_after_gap_module_complete","min_gap_days":14}'::jsonb,
 25, false, 17),

('abiding_fruit', 'The Abiding Fruit',
 'Awarded for a full year of remaining in this journey.',
 'faithfulness', 'system', 'legendary', '🌳',
 'John 15:5', 'I am the vine; you are the branches. If you remain in me and I in you, you will bear much fruit; apart from me you can do nothing.',
 'Abiding is the whole picture behind this app''s name for its rewards — fruit only comes from remaining connected to the vine over time, not from a single burst of effort.',
 'Remain active for 365 days since account creation, with real learning activity along the way.',
 '{"type":"days_since_join_active","count":365}'::jsonb,
 100, false, 18),

-- MULTIPLICATION ──────────────────────────────────────────────────────────────
('seed_fruit', 'The Seed Fruit',
 'Awarded when your first mentee begins their own journey.',
 'multiplication', 'system', 'common', '🌱',
 'John 12:24', 'Very truly I tell you, unless a kernel of wheat falls to the ground and dies, it remains only a single seed. But if it dies, it produces many seeds.',
 'Multiplication starts small and hidden — a single seed given away. Connecting your first mentee and watching them begin Module 1 is that first seed planted.',
 'Your first mentee is connected and begins Module 1.',
 '{"type":"mentee_begins_module","module_order_index":1}'::jsonb,
 10, false, 19),

('growth_fruit', 'The Growth Fruit',
 'Awarded when a mentee completes their first module.',
 'multiplication', 'system', 'common', '🌿',
 '1 Corinthians 3:6', 'I planted the seed, Apollos watered it, but God has been making it grow.',
 'Paul is careful to credit God with the growth itself — the mentor plants and waters, but it is God who brings a mentee''s first real progress to completion.',
 'Any mentee completes Module 1.',
 '{"type":"mentee_completes_module","module_order_index":1}'::jsonb,
 10, false, 20),

('shepherd_fruit', 'The Shepherd Fruit',
 'Awarded when a mentee completes a full module under your care.',
 'multiplication', 'system', 'rare', '🌳',
 '1 Peter 5:2', 'Be shepherds of God''s flock that is under your care, watching over them.',
 'Peter''s charge to shepherd those under your care is exactly the posture of a peer guide — watching over a mentee closely enough that they make it all the way through a module.',
 'Any mentee completes a full module.',
 '{"type":"mentee_completes_any_module"}'::jsonb,
 25, false, 21),

('timothy_fruit', 'The Timothy Fruit',
 'Awarded when a mentee completes the entire Core Curriculum under your discipleship.',
 'multiplication', 'system', 'epic', '🍇',
 '2 Timothy 2:2', 'And the things you have heard me say in the presence of many witnesses entrust to reliable people who will also be qualified to teach others.',
 'Timothy is Paul''s model disciple — someone poured into faithfully enough to be entrusted with the whole truth. A mentee finishing the full curriculum under your care mirrors that relationship.',
 'Any mentee completes all 12 modules of the Core Curriculum.',
 '{"type":"mentee_completes_all_modules"}'::jsonb,
 50, false, 22),

('forest_fruit', 'The Forest Fruit',
 'Awarded when five of your mentees have each completed the entire Core Curriculum.',
 'multiplication', 'system', 'legendary', '🌲',
 'Isaiah 60:21', 'They will be called oaks of righteousness, a planting of the Lord, for the display of his splendor.',
 'A single tree is a testimony; a planting of many oaks is a forest. Five mentees, each fully grown in the curriculum through your discipleship, is no longer a single story — it''s a forest taking shape.',
 'Five different mentees each complete all 12 modules of the Core Curriculum.',
 '{"type":"mentees_complete_all_modules_count","count":5}'::jsonb,
 100, true, 23),

('nations_fruit', 'The Nations Fruit',
 'Awarded when your discipleship reaches learners across three different countries.',
 'multiplication', 'system', 'legendary', '🌎',
 'Matthew 28:19', 'Therefore go and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit.',
 'The Great Commission was never meant to stay local — it names "all nations" explicitly. Mentees from three different countries completing modules under your discipleship is that mandate taking real, geographic shape.',
 'Mentees from three different countries each complete modules under your discipleship.',
 '{"type":"mentees_from_countries_count","count":3}'::jsonb,
 100, true, 24),

('legacy_fruit', 'The Legacy Fruit',
 'Awarded when ten of your mentees have completed the Core Curriculum.',
 'multiplication', 'system', 'legendary', '👑',
 'Psalm 78:4', 'We will tell the next generation the praiseworthy deeds of the Lord, his power, and the wonders he has done.',
 'A legacy is measured across generations, not moments — ten mentees who have completed the Core Curriculum through your discipleship is a legacy of faithful teaching being passed on.',
 'Ten different mentees complete the entire Core Curriculum.',
 '{"type":"mentees_complete_core_count","count":10}'::jsonb,
 100, true, 25),

('great_commission_fruit', 'The Great Commission Fruit',
 'Awarded when someone you personally discipled goes on to become a peer guide themselves.',
 'multiplication', 'system', 'legendary', '✈️',
 'Matthew 28:19-20', 'Go and make disciples of all nations... teaching them to obey everything I have commanded you.',
 'The Great Commission was never meant to stop at one generation — Jesus commands disciples to make disciples who themselves keep obeying and teaching. Watching your own mentee become a peer guide is the commission multiplying forward.',
 'Personally disciple someone who later becomes a peer guide themselves.',
 '{"type":"disciple_becomes_peer_guide"}'::jsonb,
 100, true, 26),

-- COMMUNITY ───────────────────────────────────────────────────────────────────
('fellowship_fruit', 'The Fellowship Fruit',
 'Awarded for your first real peer discussion session.',
 'community', 'peer', 'common', '🤝',
 'Acts 2:42', 'They devoted themselves to the apostles'' teaching and to fellowship, to the breaking of bread and to prayer.',
 'The earliest church wasn''t just individuals learning alone — fellowship was devoted to, right alongside teaching and prayer. A first real peer discussion session is that same devotion in miniature.',
 'Complete your first peer discussion session (confirmed by your peer).',
 '{"type":"peer_verified","action":"discussion_session"}'::jsonb,
 10, false, 27),

('encouragement_fruit', 'The Encouragement Fruit',
 'Awarded for consistently building others up through your feedback.',
 'community', 'peer', 'rare', '💬',
 'Hebrews 10:25', 'Let us not give up meeting together... but let us encourage one another.',
 'Encouragement is named as a purpose of gathering together, not an accident of it — leaving genuinely encouraging feedback on peer work is a direct, practical form of that command.',
 'Leave encouraging feedback on five different peer assignments (confirmed by peers).',
 '{"type":"peer_verified_count","action":"encouraging_feedback","count":5}'::jsonb,
 25, false, 28),

('compassion_fruit', 'The Compassion Fruit',
 'Awarded for interceding for another learner.',
 'community', 'peer', 'rare', '❤️',
 'Colossians 3:12', 'Clothe yourselves with compassion, kindness, humility, gentleness and patience.',
 'Compassion here is something a believer actively puts on, like clothing — praying for another learner by name is a concrete way of clothing yourself with compassion for them.',
 'Pray for another learner using the in-app prayer feature (confirmed by peer).',
 '{"type":"peer_verified","action":"prayer_for_learner"}'::jsonb,
 25, false, 29),

('unity_fruit', 'The Unity Fruit',
 'Awarded for learning alongside someone from a different country.',
 'community', 'peer', 'epic', '🌍',
 'Ephesians 4:3', 'Make every effort to keep the unity of the Spirit through the bond of peace.',
 'Unity across real difference — culture, language, geography — takes deliberate effort, not just proximity. A peer session across national lines is that effort made visible.',
 'Complete a peer session with someone from a different country.',
 '{"type":"peer_session_cross_country"}'::jsonb,
 50, false, 30),

('global_fruit', 'The Global Fruit',
 'Awarded for peer learning that spans three different languages or regions.',
 'community', 'peer', 'epic', '🌐',
 'Revelation 7:9', 'A great multitude that no one could count, from every nation, tribe, people and language.',
 'The vision of heaven in Revelation is deliberately, gloriously diverse. Peer learning across three languages or regions is a small, present-day glimpse of that multitude.',
 'Engage in peer learning across three different languages or regions.',
 '{"type":"peer_session_cross_language_region_count","count":3}'::jsonb,
 50, false, 31),

('service_fruit', 'The Service Fruit',
 'Awarded for helping a peer complete a lesson through direct mentoring.',
 'community', 'peer', 'rare', '🤲',
 'Galatians 5:13', 'Serve one another humbly in love.',
 'Freedom in Christ, Paul says, is meant to be used to serve one another — helping a struggling peer actually finish a lesson is that freedom put to humble, practical use.',
 'Help a peer complete a lesson through mentoring (confirmed by peer).',
 '{"type":"peer_verified","action":"helped_peer_complete_lesson"}'::jsonb,
 25, false, 32),

-- KINGDOM INFLUENCE ───────────────────────────────────────────────────────────
('marketplace_fruit', 'The Marketplace Fruit',
 'Awarded for completing the Business Kingdom Plan.',
 'kingdom_influence', 'system', 'rare', '💼',
 'Colossians 3:23', 'Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.',
 'The marketplace is a mission field, not a separate compartment of life — Paul calls every believer to work as if directly for the Lord, whatever the job.',
 'Complete the Business Kingdom Plan.',
 '{"type":"kingdom_plan_complete","plan_theme":"business"}'::jsonb,
 25, false, 33),

('educator_fruit', 'The Educator Fruit',
 'Awarded for completing the Education Kingdom Plan.',
 'kingdom_influence', 'system', 'rare', '🎓',
 'Proverbs 22:6', 'Start children off on the way they should go, and even when they are old they will not turn from it.',
 'Education, rightly done, shapes a whole life — Proverbs frames teaching the next generation as one of the most consequential kinds of influence there is.',
 'Complete the Education Kingdom Plan.',
 '{"type":"kingdom_plan_complete","plan_theme":"education"}'::jsonb,
 25, false, 34),

('leadership_fruit', 'The Leadership Fruit',
 'Awarded for completing the Government Kingdom Plan.',
 'kingdom_influence', 'system', 'rare', '🏛',
 'Romans 13:1', 'Let everyone be subject to the governing authorities, for there is no authority except that which God has established.',
 'Government and public leadership are described as authority God Himself has established — a mountain of influence disciples are called into, not away from.',
 'Complete the Government Kingdom Plan.',
 '{"type":"kingdom_plan_complete","plan_theme":"government"}'::jsonb,
 25, false, 35),

('creator_fruit', 'The Creator Fruit',
 'Awarded for completing the Media Kingdom Plan.',
 'kingdom_influence', 'system', 'rare', '🎨',
 'Exodus 31:3', 'And I have filled him with the Spirit of God, with skill, ability and knowledge in all kinds of crafts.',
 'God Himself fills craftsmen with skill and creativity for His purposes — media and the arts are a legitimate Spirit-filled calling, not a lesser one.',
 'Complete the Media Kingdom Plan.',
 '{"type":"kingdom_plan_complete","plan_theme":"media"}'::jsonb,
 25, false, 36),

('innovation_fruit', 'The Innovation Fruit',
 'Awarded for completing the Technology Kingdom Plan.',
 'kingdom_influence', 'system', 'rare', '💻',
 'Genesis 1:28', 'Be fruitful and increase in number; fill the earth and subdue it.',
 'The mandate to subdue and steward the earth is the theological root of innovation itself — building and creating in service of God''s purposes, from the very first chapter of Scripture.',
 'Complete the Technology Kingdom Plan.',
 '{"type":"kingdom_plan_complete","plan_theme":"technology"}'::jsonb,
 25, false, 37),

('family_fruit', 'The Family Fruit',
 'Awarded for completing the Family Kingdom Plan.',
 'kingdom_influence', 'system', 'rare', '👨‍👩‍👧',
 'Psalm 127:3', 'Children are a heritage from the Lord, offspring a reward from him.',
 'Family is named as God''s own gift and heritage — one of the first and most enduring mountains of Kingdom influence a believer is entrusted with.',
 'Complete the Family Kingdom Plan.',
 '{"type":"kingdom_plan_complete","plan_theme":"family"}'::jsonb,
 25, false, 38),

('kingdom_fruit', 'The Kingdom Fruit',
 'Awarded for completing every Church Ministry Plan.',
 'kingdom_influence', 'system', 'epic', '⛪',
 'Matthew 16:18', 'And I tell you that you are Peter, and on this rock I will build my church, and the gates of Hades will not overcome it.',
 'Jesus Himself promises to build His church against every opposing force — completing every Church Ministry Plan is investing directly in the institution He said He would personally build.',
 'Complete all Church Ministry Plans.',
 '{"type":"all_church_ministry_plans_complete"}'::jsonb,
 50, false, 39),

-- SPECIAL ─────────────────────────────────────────────────────────────────────
('first_steps_fruit', 'The First Steps Fruit',
 'Awarded for the very first lesson you ever complete.',
 'special', 'system', 'common', '🌅',
 'Proverbs 4:18', 'The path of the righteous is like the morning sun, shining ever brighter till the full light of day.',
 'Every mature walk with God began with a first, small step at dawn — this fruit marks that beginning, however small it felt at the time.',
 'Complete your very first lesson.',
 '{"type":"first_lesson_submitted"}'::jsonb,
 10, false, 40),

('rooted_fruit', 'The Rooted Fruit',
 'Awarded for completing your very first full module.',
 'special', 'system', 'common', '🌱',
 'Colossians 2:7', 'Rooted and built up in him, strengthened in the faith as you were taught.',
 'Paul pictures growth as rooting — deep, quiet, unseen work before visible fruit shows. Finishing a first whole module is that root system taking hold.',
 'Complete your very first full module.',
 '{"type":"first_module_complete"}'::jsonb,
 10, false, 41),

('fruitful_fruit', 'The Fruitful Fruit',
 'Awarded for completing five modules total.',
 'special', 'system', 'rare', '🍎',
 'John 15:8', 'This is to my Father''s glory, that you bear much fruit, showing yourselves to be my disciples.',
 'Jesus ties bearing much fruit directly to being recognizably His disciple — five completed modules is a visible, growing harvest, not just a single fruit.',
 'Complete five modules total.',
 '{"type":"modules_complete_count","count":5}'::jsonb,
 25, false, 42),

('revival_fruit', 'The Revival Fruit',
 'Awarded for completing an entire prayer-focused Plan.',
 'special', 'system', 'epic', '🔥',
 'Acts 3:19', 'Repent, then, and turn to God, so that your sins may be wiped out, that times of refreshing may come from the Lord.',
 'Revival in Scripture follows repentance and turning to God — sustained, focused prayer is often exactly the soil times of refreshing grow out of.',
 'Complete an entire prayer-focused Plan.',
 '{"type":"plan_complete_by_theme","plan_theme":"prayer"}'::jsonb,
 50, true, 43),

('mission_fruit', 'The Mission Fruit',
 'Awarded for completing every evangelism-related Plan.',
 'special', 'system', 'epic', '✈️',
 'Isaiah 6:8', 'Here am I. Send me!',
 'Isaiah''s response to God''s call is immediate and total availability — completing every evangelism-focused Plan is that same "send me" posture worked out fully.',
 'Complete every evangelism-related Plan.',
 '{"type":"all_plans_complete_by_theme","plan_theme":"evangelism"}'::jsonb,
 50, true, 44),

('teacher_fruit', 'The Teacher Fruit',
 'Awarded for successfully mentoring three learners to module completion.',
 'special', 'system', 'epic', '📖',
 'James 3:1', 'Not many of you should become teachers, my fellow believers, because you know that we who teach will be judged more strictly.',
 'James takes teaching seriously precisely because of its weight and responsibility — successfully mentoring three learners through to real completion is teaching proven out, not just attempted.',
 'Successfully mentor three learners, each to module completion.',
 '{"type":"mentor_count_module_complete","count":3}'::jsonb,
 50, false, 45),

('berean_fruit', 'The Berean Fruit',
 'Awarded for examining every Scripture reference in a module.',
 'special', 'system', 'rare', '🔎',
 'Acts 17:11', 'They examined the Scriptures every day to see if what Paul said was true.',
 'The Bereans were praised specifically for checking every claim against Scripture themselves — opening and reading every verse reference in a module is that same careful, personal examination.',
 'Open every Scripture reference in any single module.',
 '{"type":"scripture_refs_opened_in_module"}'::jsonb,
 25, false, 46),

-- LEGENDARY ───────────────────────────────────────────────────────────────────
('barnabas_fruit', 'The Barnabas Fruit',
 'Awarded for a lifetime of encouraging others by name.',
 'legendary', 'peer', 'legendary', '👑',
 'Acts 11:23', 'When he arrived and saw what the grace of God had done, he was glad and encouraged them all to remain true to the Lord with all their hearts.',
 'Barnabas — literally "son of encouragement" — is remembered for one thing above all: showing up and genuinely encouraging people toward the Lord. Fifty learners encouraged is that same character, sustained over a long time.',
 'Encourage 50 different learners (confirmed by peers).',
 '{"type":"peer_verified_count","action":"encouragement","count":50}'::jsonb,
 100, true, 47),

('paul_fruit', 'The Paul Fruit',
 'Awarded for raising up disciple-makers, not just disciples.',
 'legendary', 'system', 'legendary', '👑',
 '2 Timothy 2:2', 'The things you have heard me say... entrust to reliable people who will also be qualified to teach others.',
 'Paul''s vision was never one generation deep — he entrusted truth to people who would themselves teach others. Raising up ten disciple-makers is that same four-generation vision realized.',
 'Raise up 10 disciple-makers — mentees who themselves go on to mentor others.',
 '{"type":"disciple_makers_count","count":10}'::jsonb,
 100, true, 48),

('epaphras_fruit', 'The Epaphras Fruit',
 'Awarded for months of faithful, hidden intercession for others.',
 'legendary', 'system', 'legendary', '👑',
 'Colossians 4:12', 'He is always wrestling in prayer for you, so that you may stand firm in all the will of God, mature and full assurance.',
 'Epaphras is barely mentioned in Scripture, yet Paul singles out his relentless, wrestling prayer for others — ninety consecutive days of praying for peers is that same quiet, hidden faithfulness.',
 'Consistently pray for peers over 90 consecutive days.',
 '{"type":"consecutive_prayer_days","count":90}'::jsonb,
 100, true, 49),

('lydia_fruit', 'The Lydia Fruit',
 'Awarded for helping a discipleship group take root and grow.',
 'legendary', 'system', 'legendary', '👑',
 'Acts 16:15', 'If you consider me a believer in the Lord, come and stay at my house. And she persuaded us.',
 'Lydia''s home became the anchor for the whole Philippian church — her hospitality and support gave a young community somewhere to grow. Supporting a discipleship group''s growth mirrors that same foundational role.',
 'Support the growth of a discipleship group.',
 '{"type":"supports_group_growth"}'::jsonb,
 100, true, 50),

('aquila_priscilla_fruit', 'The Aquila and Priscilla Fruit',
 'Awarded for discipling someone else side by side with another peer guide.',
 'legendary', 'system', 'legendary', '👑',
 'Acts 18:26', 'They invited him to their home and explained to him the way of God more adequately.',
 'Aquila and Priscilla always appear together in Scripture, discipling as a pair — co-mentoring alongside another peer guide is that same shared, partnered ministry.',
 'Mentor together with another peer guide (co-mentoring).',
 '{"type":"co_mentor_with_peer_guide"}'::jsonb,
 100, true, 51),

('stephen_fruit', 'The Stephen Fruit',
 'Awarded for completing the entire Core Curriculum and every Kingdom Plan.',
 'legendary', 'system', 'legendary', '👑',
 'Acts 6:8', 'Stephen, a man full of God''s grace and power, performed great wonders and signs among the people.',
 'Stephen is remembered as full — of grace, of the Spirit, of faith. Completing every Core lesson and every Kingdom Plan is the fullest, most complete picture this system has of a disciple''s formation.',
 'Complete every Core Curriculum lesson AND every Kingdom Plan.',
 '{"type":"all_core_and_kingdom_plans_complete"}'::jsonb,
 100, true, 52)

on conflict (fruit_key) do nothing;
