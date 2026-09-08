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

const client = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const def = await client.query("SELECT prosrc FROM pg_proc WHERE proname = 'p2p_start_direct_conversation'");
  const src = def.rows[0]?.prosrc ?? "(not found)";
  console.log("Function contains 'p2p_connection_requests':", src.includes("p2p_connection_requests"));
  console.log("Function contains 'request_type':", src.includes("request_type"));

  const req = await client.query(
    "SELECT id, from_user_id, to_user_id, request_type, status FROM p2p_connection_requests WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)",
    ["ab1056bc-2585-43f0-be4e-e3ee76d2a898", "ca2a9381-e498-437e-aa43-3f3a268750b9"]
  );
  console.log("Connection request rows:", JSON.stringify(req.rows, null, 2));

  // Directly call the function as if we were Test3, bypassing auth.uid() by testing the query logic manually
  const test = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM p2p_connection_requests cr
       WHERE cr.status = 'accepted' AND cr.request_type = 'connect'
         AND ((cr.from_user_id = $1 AND cr.to_user_id = $2)
           OR (cr.from_user_id = $2 AND cr.to_user_id = $1))
     ) as eligible`,
    ["ab1056bc-2585-43f0-be4e-e3ee76d2a898", "ca2a9381-e498-437e-aa43-3f3a268750b9"]
  );
  console.log("Eligibility check result:", test.rows[0]);
} finally {
  await client.end();
}
