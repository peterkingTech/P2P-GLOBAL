const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await client.connect();
  const tables = await client.query(`
    select table_name from information_schema.tables
    where table_schema='public' and table_name like 'p2p_%'
    order by table_name;
  `);
  console.log('TABLES:', tables.rows.map(r=>r.table_name).join(', '));

  const profileCols = await client.query(`
    select column_name, data_type, column_default
    from information_schema.columns
    where table_name='p2p_profiles'
    order by ordinal_position;
  `);
  console.log('\nP2P_PROFILES COLUMNS:');
  console.log(profileCols.rows.map(r=>`${r.column_name} (${r.data_type}) default=${r.column_default}`).join('\n'));
  await client.end();
})();
