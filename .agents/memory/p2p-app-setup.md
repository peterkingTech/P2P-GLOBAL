---
name: P2P App Setup
description: Key decisions and gotchas for the P2P Global Bible Study Network monorepo setup.
---

## Supabase Table Names
All tables use the `p2p_` prefix — e.g., `p2p_profiles` (NOT `users`), `p2p_prayer_requests` (NOT `prayers`), `p2p_sessions` (NOT `sessions`). The AuthContext originally queried `users` — this was corrected to `p2p_profiles`.

**Why:** The live Supabase project uses `p2p_` prefixed tables. Querying the wrong name silently returns `null` (table 404).

## SUPABASE_DB_URL Secret
The `SUPABASE_DB_URL` secret is currently set to the Supabase **HTTP project URL** (`https://omkqkasniakcnmfcwrvs.supabase.co`), NOT the PostgreSQL connection string. 

**Impact:** `lib/db` (Drizzle + pg Pool) cannot connect with this value — it needs the Transaction Pooler string (`postgres://...@aws-0-*.pooler.supabase.com:6543/postgres`).

**Workaround applied:** `artifacts/api-server/src/lib/supabase.ts` detects an HTTP URL and uses it as the Supabase JS client base URL instead of as a postgres connection string. All current routes use `@supabase/supabase-js` (not Drizzle) to avoid needing the postgres URL.

**Action needed:** User must update `SUPABASE_DB_URL` to the Postgres Transaction Pooler URL before Drizzle-based queries can work.

## Metro + pnpm Workspace Symlinks
Metro (Expo bundler) doesn't follow pnpm's symlinked `node_modules` by default. The fix in `artifacts/mobile/metro.config.js`:
- `config.watchFolders = [workspaceRoot]`
- `config.resolver.nodeModulesPaths` includes both local and workspace root `node_modules`
- `config.resolver.unstable_enableSymlinks = true`

**Why:** pnpm installs packages via symlinks into `.pnpm/` at the workspace root. Metro won't resolve packages that aren't in the project-local `node_modules` unless explicitly told to look at the workspace root.

## Supabase Auth + Anon Key
The Supabase anon key is embedded in `artifacts/mobile/contexts/AuthContext.tsx` (public/safe, standard Supabase pattern). The API server also uses this key via `artifacts/api-server/src/lib/supabase.ts`. RLS policies control access.

## Express Route Security Note
API routes currently have NO authentication/authorization middleware — they rely entirely on Supabase RLS for access control. The notification "mark as read" route was scoped to both `id` AND `user_id` to prevent cross-user modification. Production use requires auth middleware before launch.
