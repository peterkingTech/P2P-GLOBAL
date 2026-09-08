import { readFileSync } from "fs";
import { Client } from "pg";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", "..", "artifacts", "api-server", ".env");
const env = {};
readFileSync(envPath, "utf8").split("\n").forEach((line) => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
});

const TEST3_ID = "ab1056bc-2585-43f0-be4e-e3ee76d2a898";
const NOX_ID = "ca2a9381-e498-437e-aa43-3f3a268750b9";

const client = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  // Simulate Supabase's auth.uid() by setting the same JWT claim it reads from,
  // exactly as PostgREST does per-request. This calls the REAL function,
  // as Postgres actually executes it, with no shortcuts.
  await client.query(`SET request.jwt.claims = '{"sub":"${TEST3_ID}","role":"authenticated"}'`);
  await client.query(`SET ROLE authenticated`);
  try {
    const result = await client.query(`SELECT p2p_start_direct_conversation($1::uuid) as conversation_id`, [NOX_ID]);
    console.log("SUCCESS - conversation id:", result.rows[0].conversation_id);
  } catch (e) {
    console.log("RPC RAISED:", e.message);
    console.log("Detail:", e.detail);
    console.log("Hint:", e.hint);
    console.log("Code:", e.code);
  }
} finally {
  await client.query(`RESET ROLE`).catch(() => {});
  await client.end();
}
