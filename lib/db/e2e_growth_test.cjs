const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PVE = 'd11a6127-36c1-467e-820f-949778346804';

async function run() {
  await client.connect();

  const { rows: modules } = await client.query(`
    select m.id, m.title, count(l.id) as lesson_count
    from p2p_modules m join p2p_lessons l on l.module_id = m.id
    group by m.id, m.title
    having count(l.id) > 1
    order by count(l.id) asc
    limit 3
  `);
  console.log('Candidate modules:', modules.map(m => `${m.title} (${m.lesson_count} lessons)`));

  const mod = modules[0];
  const { rows: lessons } = await client.query(`select id, title from p2p_lessons where module_id = $1 order by order_index`, [mod.id]);

  const lessonIds = lessons.map(l => l.id);
  await client.query(`delete from p2p_lesson_progress where user_id = $1 and lesson_id = any($2::uuid[])`, [PVE, lessonIds]);
  await client.query(`delete from p2p_growth_events where user_id = $1 and created_at > now() - interval '1 minute'`, [PVE]);

  console.log(`\nTesting module "${mod.title}" with ${lessons.length} lessons for PVE...`);

  for (let i = 0; i < lessons.length; i++) {
    const l = lessons[i];
    await client.query(`
      insert into p2p_lesson_progress (user_id, lesson_id, completed, progress_percent, updated_at)
      values ($1, $2, true, 100, now())
      on conflict (user_id, lesson_id) do update set completed = true, updated_at = now()
    `, [PVE, l.id]);
    console.log(`  Completed lesson ${i + 1}/${lessons.length}: ${l.title}`);
  }

  const { rows: events } = await client.query(`
    select event_type, label, score_before, score_after, created_at
    from p2p_growth_events
    where user_id = $1
    order by created_at asc
  `, [PVE]);

  console.log('\nGrowth events logged:');
  events.forEach(e => console.log(`  [${e.event_type}] "${e.label}" (score ${e.score_before} -> ${e.score_after})`));

  const moduleEvent = events.find(e => e.event_type === 'module_completed' && e.label.includes(mod.title));
  if (!moduleEvent) throw new Error('FAIL: no module_completed event found for the module title');
  console.log(`\n✅ module_completed event confirmed: "${moduleEvent.label}"`);

  const lessonEvents = events.filter(e => e.event_type === 'lesson_completed');
  if (lessonEvents.length !== lessons.length) throw new Error(`FAIL: expected ${lessons.length} lesson_completed events, got ${lessonEvents.length}`);
  console.log(`✅ ${lessonEvents.length} lesson_completed events confirmed`);

  const { rows: [profileRow] } = await client.query(`select growth_level from p2p_profiles where id = $1`, [PVE]);
  console.log(`✅ profile.growth_level updated to: ${profileRow.growth_level}`);

  // Test disciple_gained event too
  const { rows: mentors } = await client.query(`select id from p2p_profiles where id != $1 limit 1`, [PVE]);
  if (mentors[0]) {
    await client.query(`delete from p2p_discipleship_links where mentor_id = $1 and disciple_id = $2`, [PVE, mentors[0].id]);
    await client.query(`insert into p2p_discipleship_links (mentor_id, disciple_id, active) values ($1, $2, true)`, [PVE, mentors[0].id]);
    const { rows: [discEvent] } = await client.query(`
      select event_type, label from p2p_growth_events where user_id = $1 and event_type = 'disciple_gained' order by created_at desc limit 1
    `, [PVE]);
    console.log(`✅ disciple_gained event confirmed: "${discEvent?.label}"`);
    await client.query(`delete from p2p_discipleship_links where mentor_id = $1 and disciple_id = $2`, [PVE, mentors[0].id]);
  }

  await client.end();
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
