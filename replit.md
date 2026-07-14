## MANDATORY: Git sync discipline (read this before any work)

At the START of every single session, before making any code or database changes:
1. Run `git fetch origin` and `git status` to check if origin/main has commits not yet in this local checkout.
2. If it does, pull and merge (`git pull origin main --no-rebase`) BEFORE starting any new work — never start building on a stale local checkout.
3. If a migration file number collision is found during this check, STOP and report it before proceeding — do not auto-renumber or resolve silently, the user needs to confirm the resolution plan first (per the process that worked correctly in our last sync).

At the END of every single session, after completing requested work:
1. Commit all changes with a clear, specific message describing what was done.
2. Push to origin/main.
3. Confirm the push succeeded and report the final commit hash.

This applies regardless of which tool (Claude Code or Replit Agent) is being used in a given session — both read this file and must follow this rule without being asked each time.

# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
