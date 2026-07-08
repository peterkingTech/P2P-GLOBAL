---
name: P2P Admin Routing
description: How /admin/* routes are guarded in the Expo app, including the AuthGate bypass pattern for the admin login screen and the two-layer guard architecture.
---

## The two-layer guard

1. **Root `app/_layout.tsx` AuthGate** — redirects unauthenticated users to onboarding for non-auth, non-admin routes. Critically, it skips ANY `segments[0] === "admin"` route so the admin layout can handle its own redirects.

2. **`app/admin/_layout.tsx`** — secondary guard for authenticated users. If `pathname === "/admin/login"`, renders a bare wrapper with no chrome so the login screen can work for both logged-out and logged-in users. Otherwise checks `profile.role` against the real DB enum (`peer_guide`/`church_leader`/`regional_director`/`global_admin`/`super_admin`; `student` = not admin) and redirects to `/(tabs)` if the role isn't one of those.

**Why:** The root AuthGate can't know whether a given route needs admin-login vs onboarding — delegating the decision to the admin layout is the clean split. If the root gate intercepted `/admin/*`, logged-out users would hit onboarding instead of the admin login page.

**How to apply:** If adding new unauthenticated-accessible routes outside `(auth)`, add their segment to the bypass condition in AuthGate (e.g. `segments[0] === "admin"` covers all admin sub-routes).

## Admin login flow

- `app/admin/login.tsx` signs in via Supabase, then immediately fetches `p2p_profiles.role` using `supabase.auth.getSession()` to get the userId.
- If role is NOT one of `peer_guide`/`church_leader`/`regional_director`/`global_admin`/`super_admin`: calls `supabase.auth.signOut()` and shows an amber "No admin access" box (not a red error — the auth itself succeeded, only the role check failed).
- If role IS admin: calls `router.replace("/admin/curriculum")`.
- Entry point: subtle "Admin sign in" link with shield icon at the bottom of `app/(auth)/login.tsx`.

## "Exit Admin" control

- In `app/admin/_layout.tsx` top bar, right side: `router.replace("/(tabs)")`. Labeled "Exit Admin" with an exit icon. Does NOT sign the user out — they return to the normal app still authenticated.

## Express admin routes

- All `/api/admin/*` routes protected by `src/middleware/adminAuth.ts`.
- Middleware reads `Authorization: Bearer <supabase-jwt>`, calls `supabase.auth.getUser(token)`, then checks `p2p_profiles.role`. Returns 401/403 on failure.
- Note: mobile admin screens call Supabase directly (not the Express API), so this middleware protects any external/tooling callers.

## Role vocabulary correction (2026-07-08)

The app was originally written against an invented role vocabulary (`seeker`/`disciple`/`mentor`/`elder`) that never matched the deployed Postgres enum. Fixed in two passes:
1. First aligned app code to the then-live enum: `student`/`peer_guide`/`church_leader`/`regional_director`/`global_admin`/`super_admin`.
2. Then the live enum itself was found to have drifted from the project blueprint, so it was migrated (see `migrations/003_fix_role_enum.sql`) to the blueprint's six roles: `student`/`peer_guide`/`church_leader`/`regional_admin`/`moderator`/`super_admin` — renaming `regional_director`→`regional_admin`, adding `moderator`, and folding `global_admin` into `super_admin` (Postgres enums can't drop a value, so the type was recreated). App code (AuthContext.tsx, admin/_layout.tsx, admin/login.tsx, adminAuth.ts middleware, forest.tsx role colors), the Drizzle schema, and openapi.yaml (+ regenerated codegen) were all updated to match.

**Final canonical role list: `student`, `peer_guide`, `church_leader`, `regional_admin`, `moderator`, `super_admin`.** Admin access = any role except `student`.
**Why:** the blueprint/enum is the source of truth; app code must conform to it, not the other way around. Enum changes with existing data require checking row counts first and recreating (not just renaming) the Postgres type to remove a value.
**How to apply:** any new role-based UI/gating must use the 6 roles above — never reintroduce `seeker`/`disciple`/`mentor`/`elder`/`regional_director`/`global_admin`.
