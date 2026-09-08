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
const sorted = [TEST3_ID, NOX_ID].sort();
const channelName = `p2p_${sorted[0]}_${sorted[1]}`;

const client = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const insert = await client.query(
    `INSERT INTO p2p_call_logs (channel_name, call_type, initiated_by, participants, status)
     VALUES ($1, 'audio', $2, $3::jsonb, 'initiated')
     RETURNING id, participants, status, channel_name`,
    [channelName, TEST3_ID, JSON.stringify([TEST3_ID, NOX_ID])]
  );
  const row = insert.rows[0];
  console.log("Inserted call log:", JSON.stringify(row, null, 2));

  // Immediately call the REAL production /calls/token endpoint, zero delay,
  // exactly as Nox's client would, for the recipient's userId.
  const res = await fetch("https://workspaceapi-server-production-6d56.up.railway.app/api/calls/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelName, uid: 1032289649, userId: NOX_ID }),
  });
  const body = await res.json();
  console.log("Token endpoint status:", res.status);
  console.log("Token endpoint response:", JSON.stringify(body, null, 2));

  // Clean up - end this diagnostic call log so it doesn't linger.
  await client.query(`UPDATE p2p_call_logs SET status = 'missed', ended_at = now() WHERE id = $1`, [row.id]);
  console.log("Cleaned up diagnostic call log.");
} finally {
  await client.end();
}
