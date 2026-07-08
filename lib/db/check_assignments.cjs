const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await client.connect();
  for (const t of ['p2p_assignments','p2p_lesson_blocks','p2p_content_approvals','p2p_enrollments','p2p_groups','p2p_group_members']) {
    const cols = await client.query(`select column_name, data_type from information_schema.columns where table_name=$1 order by ordinal_position;`, [t]);
    console.log(`\n== ${t} ==`);
    console.log(cols.rows.map(r=>`${r.column_name} (${r.data_type})`).join(', '));
    const count = await client.query(`select count(*) from ${t}`);
    console.log('row count:', count.rows[0].count);
  }
  await client.end();
})();
