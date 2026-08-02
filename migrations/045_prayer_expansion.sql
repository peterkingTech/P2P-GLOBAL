-- 045: Prayer tab expansion ("The Upper Room" sanctuary) — prayer library
-- (Sinner's Prayer, grace/mercy, favour, healing, confessions), personal
-- confession builder, and a private prayer journal.
--
-- Renumbered from the Prompt 5 spec's 044 — 044 was already used for Peer
-- Circles (Prompt 4).
--
-- "Live Prayer Rooms" (Step 3, Section 6 — "keep as built") does not
-- actually exist anywhere in this codebase; it only ever appeared as
-- onboarding marketing copy ("Join live prayer rooms..." in the slide4Sub
-- string). There is nothing to keep, so this migration and the prayer.tsx
-- rebuild below do not add a placeholder for it.

create table if not exists p2p_prayer_library (
  id                  uuid primary key default gen_random_uuid(),
  category            text not null,   -- 'sinners_prayer'|'grace_mercy'|'favour'|'healing'|'confession'|'declaration'
  subcategory         text,
  title               text not null,
  prayer_text         text not null,
  scripture_reference text,
  scripture_text      text,
  language_code       text not null default 'en',
  display_order       integer,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique(title, language_code)
);

create index if not exists idx_p2p_prayer_library_category on p2p_prayer_library(category, language_code) where is_active;

create table if not exists p2p_personal_confessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  title                 text not null default 'My Confession',
  confession_lines      jsonb not null default '[]', -- array of {scripture_ref, text, declaration}
  morning_notification  boolean not null default false,
  notification_time     time,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Table may already exist (live) from an earlier run of this same migration,
-- created before this constraint was added — apply it idempotently rather
-- than relying on CREATE TABLE IF NOT EXISTS, which is a no-op once the
-- table exists. Needed for the upsert(..., {onConflict:"user_id"}) pattern
-- every "My Confession" write uses (there is exactly one per user).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'p2p_personal_confessions_user_id_key'
  ) then
    alter table p2p_personal_confessions add constraint p2p_personal_confessions_user_id_key unique (user_id);
  end if;
end $$;

create table if not exists p2p_prayer_journal (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  prayer_text   text not null,
  category      text,
  is_answered   boolean not null default false,
  answered_at   timestamptz,
  answer_notes  text,
  is_private    boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists idx_p2p_prayer_journal_user on p2p_prayer_journal(user_id, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table p2p_prayer_library enable row level security;
alter table p2p_personal_confessions enable row level security;
alter table p2p_prayer_journal enable row level security;

drop policy if exists "Anyone can read the prayer library" on p2p_prayer_library;
create policy "Anyone can read the prayer library" on p2p_prayer_library
  for select using (is_active);

drop policy if exists "Users manage their own confession" on p2p_personal_confessions;
create policy "Users manage their own confession" on p2p_personal_confessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage their own journal" on p2p_prayer_journal;
create policy "Users manage their own journal" on p2p_prayer_journal
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Seed: English prayer library ─────────────────────────────────────────────

insert into p2p_prayer_library (category, title, prayer_text, scripture_reference, scripture_text, display_order) values

('sinners_prayer', 'A Prayer of Commitment',
 'Lord Jesus, I come to You just as I am. I confess that I have sinned and fallen short of Your glory. I believe You died for my sins and rose from the dead. I ask You to forgive me and come into my heart. I surrender my life to You today. Thank You for saving me. Amen.',
 'Romans 10:9-10', 'If you declare with your mouth, "Jesus is Lord," and believe in your heart that God raised him from the dead, you will be saved. For it is with your heart that you believe and are justified, and it is with your mouth that you profess your faith and are saved.',
 1),

('grace_mercy', 'Prayer for Mercy',
 'Have mercy on me, O God, according to Your unfailing love. According to Your great compassion, blot out my transgressions and wash away all my iniquity. I bring You nothing but my need for You. Thank You that Your mercy meets me exactly where I am. Amen.',
 'Psalm 51:1-3', 'Have mercy on me, O God, according to your unfailing love; according to your great compassion blot out my transgressions. Wash away all my iniquity and cleanse me from my sin. For I know my transgressions, and my sin is always before me.',
 1),

('grace_mercy', 'Prayer for Grace in Weakness',
 'Lord, I feel the weight of my own weakness today. But You have said that Your grace is sufficient for me, and that Your power is made perfect in weakness. So I will boast gladly in my weaknesses, so that Your power may rest on me. Be strong in me where I am weak. Amen.',
 '2 Corinthians 12:9', 'But he said to me, "My grace is sufficient for you, for my power is made perfect in weakness." Therefore I will boast all the more gladly about my weaknesses, so that Christ''s power may rest on me.',
 2),

('grace_mercy', 'Prayer for Forgiveness',
 'Father, I confess before You what I have carried in silence. Thank You that when I confess my sins, You are faithful and just to forgive me and to cleanse me from all unrighteousness. I receive that forgiveness now, and I let go of the shame that came with it. Amen.',
 '1 John 1:9', 'If we confess our sins, he is faithful and just and will forgive us our sins and purify us from all unrighteousness.',
 3),

('grace_mercy', 'Prayer for a Fresh Start',
 'Lord, because of Your great love I am not consumed, for Your compassions never fail. They are new every morning; great is Your faithfulness. Thank You that today is a fresh start, untouched by yesterday''s failures. I receive Your mercy, new again this morning. Amen.',
 'Lamentations 3:22-23', 'Because of the LORD''s great love we are not consumed, for his compassions never fail. They are new every morning; great is your faithfulness.',
 4),

('favour', 'Prayer for Favour at Work',
 'Lord, let love and faithfulness never leave me — let me bind them around my neck and write them on the tablet of my heart. Then I will win favour and a good name in the sight of God and man. Go before me in my work today, and let Your favour rest on everything I put my hand to. Amen.',
 'Proverbs 3:3-4', 'Let love and faithfulness never leave you; bind them around your neck, write them on the tablet of your heart. Then you will win favor and a good name in the sight of God and man.',
 1),

('favour', 'Prayer for Favour in Relationships',
 'Father, just as Jesus grew in wisdom and stature, and in favour with God and man, I ask that You would grow me in the same way. Let my relationships be marked by Your favour — let people see You in me, and let that draw them closer to You, not further away. Amen.',
 'Luke 2:52', 'And Jesus grew in wisdom and stature, and in favor with God and man.',
 2),

('favour', 'Prayer for Breakthrough',
 'Lord, You said You would go before me and level the mountains; You would break down gates of bronze and cut through bars of iron. I ask for that same breakthrough now, over the obstacles standing between me and what You have called me to. Go ahead of me, Lord. Amen.',
 'Isaiah 45:2-3', 'I will go before you and will level the mountains; I will break down gates of bronze and cut through bars of iron. I will give you hidden treasures, riches stored in secret places, so that you may know that I am the LORD.',
 3),

('favour', 'Prayer of Thanksgiving for Favour',
 'Lord, You bless the righteous; You surround them with Your favour as with a shield. Thank You for the favour You have already shown me — for doors opened, for people placed in my path, for grace I did not earn. I receive it with gratitude, and I ask You to keep surrounding me still. Amen.',
 'Psalm 5:12', 'Surely, LORD, you bless the righteous; you surround them with your favor as with a shield.',
 4),

('healing', 'Prayer for Physical Healing',
 'Lord, Your word says that by Jesus'' wounds I am healed, and that the prayer offered in faith will make the sick person well. I bring my body before You now and ask for Your healing touch. Where there is pain, bring peace; where there is sickness, bring wholeness. I trust You as my Healer. Amen.',
 'James 5:14-15; Isaiah 53:5', 'Is anyone among you sick? Let them call the elders of the church to pray over them... And the prayer offered in faith will make the sick person well; the Lord will raise them up. / He was pierced for our transgressions, he was crushed for our iniquities; the punishment that brought us peace was on him, and by his wounds we are healed.',
 1),

('healing', 'Prayer for Emotional Healing',
 'Lord, You are close to the brokenhearted and You save those who are crushed in spirit. My heart feels heavy today, but I bring it to You just as it is. Meet me in this place. Bind up what is broken and let me feel Your nearness. Amen.',
 'Psalm 34:18', 'The LORD is close to the brokenhearted and saves those who are crushed in spirit.',
 2),

('healing', 'Prayer for Mental Peace',
 'Lord, I bring my anxiety to You instead of carrying it alone. In every situation, by prayer and petition, with thanksgiving, I present my requests to You. Thank You that Your peace, which transcends all understanding, will guard my heart and mind in Christ Jesus. Amen.',
 'Philippians 4:6-7', 'Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.',
 3),

('healing', 'Prayer for Healing of Relationships',
 'Lord, teach me to bear with others and forgive whatever grievances I may have, just as You forgave me. Heal what is broken between me and those I love. Where I need to forgive, give me the grace to do it fully; where I need to be forgiven, soften the hearts of those I have hurt. Amen.',
 'Colossians 3:13', 'Bear with each other and forgive one another if any of you has a grievance against someone. Forgive as the Lord forgave you.',
 4),

('confession', 'Health Confession', 'By His stripes I am healed.', 'Isaiah 53:5', 'But he was pierced for our transgressions, he was crushed for our iniquities; the punishment that brought us peace was on him, and by his wounds we are healed.', 1),
('confession', 'Identity Confession', 'I am more than a conqueror.', 'Romans 8:37', 'No, in all these things we are more than conquerors through him who loved us.', 2),
('confession', 'Prosperity Declaration', 'My God shall supply all my needs.', 'Philippians 4:19', 'And my God will meet all your needs according to the riches of his glory in Christ Jesus.', 3),
('confession', 'Peace Declaration', 'The peace of God guards my heart.', 'Philippians 4:7', 'And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.', 4),
('confession', 'Purpose Declaration', 'I know the plans God has for me.', 'Jeremiah 29:11', '"For I know the plans I have for you," declares the LORD, "plans to prosper you and not to harm you, plans to give you hope and a future."', 5),
('confession', 'Favour Declaration', 'Favour surrounds me like a shield.', 'Psalm 5:12', 'Surely, LORD, you bless the righteous; you surround them with your favor as with a shield.', 6),
('confession', 'Protection Declaration', 'No weapon formed against me shall prosper.', 'Isaiah 54:17', 'No weapon forged against you will prevail, and you will refute every tongue that accuses you.', 7),
('confession', 'Wisdom Declaration', 'I have the mind of Christ.', '1 Corinthians 2:16', '"For who has known the mind of the Lord that they may instruct him?" But we have the mind of Christ.', 8),
('confession', 'Strength Declaration', 'I can do all things through Christ.', 'Philippians 4:13', 'I can do all this through him who gives me strength.', 9)

on conflict (title, language_code) do nothing;
