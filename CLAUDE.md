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
