// Side-effect-only module — must be the FIRST import in any script that
// needs artifacts/api-server/.env loaded before other modules construct
// Supabase clients at their own top level (e.g. lib/translationEngine.ts).
//
// Under real ESM ("type": "module"), ALL static imports in a file are fully
// resolved and evaluated — in encounter order — before any of that file's
// own top-level statements run. So env-loading code written *before* other
// imports but as a regular statement (not an import) still runs *after*
// those imports finish evaluating, which is too late for a module that
// reads process.env at its own top level. Importing this file first, with
// no other statements ahead of it, is what actually guarantees ordering.
//
// This codebase deliberately does not use the `dotenv` package anywhere
// (see .env.example's own header comment) — env vars are loaded via the
// shell (`set -a && source .env && set +a`) or Node's --env-file flag. This
// keeps that same convention (no new dependency) while still letting a
// script "just work" when invoked bare.
import fs from "fs";
import path from "path";

const envPath = path.resolve(import.meta.dirname, "../../.env");
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
