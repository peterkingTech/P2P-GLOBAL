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
  const res = await client.query("SELECT id, email FROM auth.users WHERE id = $1", ["ab1056bc-2585-43f0-be4e-e3ee76d2a898"]);
  console.log(JSON.stringify(res.rows));
} finally {
  await client.end();
}
