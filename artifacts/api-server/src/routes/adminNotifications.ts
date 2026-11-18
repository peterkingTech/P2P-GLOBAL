// ADMIN CENTRE NOTIFICATIONS — API (owner brief 2026-11-18). Mounted at /api/admin/notifications, before /admin.
// Every route: requireAdmin (the existing Admin Centre authentication) — the caller's ROLES decide which modules'
// notifications they get (lib/adminNotifications MODULES, the same roles as the sidebar and each module's API).
//   GET  /summary                       unread, action required, critical, assigned to me, overdue, sidebar badges, recent
//   GET  /?filter=&module=&before=      the list (newest first, paginated)
//   POST /read · /unread · /action · /archive   { ids: [...] | "all" }  (this admin's own view; never resolves the item)
//   GET  /prefs · PUT /prefs            categories (security + crisis mandatory) and sound
//   POST /sweep                         run the detection now (super_admin) — normally every minute by cron
import { Router, type Request, type Response } from "express";
import { requireAdmin, requireRole } from "../middleware/adminAuth";
import { audit } from "../lib/adminIdentity";
import { getPrefs, list, mark, MODULES, savePrefs, summary, sweep, type Filter, type ModuleId } from "../lib/adminNotifications";

const router = Router();
router.use(requireAdmin);
const who = (req: Request) => ({ id: (req as any).adminUserId as string, roles: (((req as any).adminRoles as string[] | undefined) ?? [(req as any).adminRole]).filter(Boolean) as string[] });
const fail = (res: Response) => res.status(500).json({ error: "Notifications aren't available right now." });
let firstSweep: Promise<unknown> | null = null;
const ensureSwept = () => (firstSweep ??= sweep().catch(() => null)); // a fresh server answers with real data at once

router.get("/summary", async (req, res) => {
  try { await ensureSwept(); const a = who(req); return res.json(await summary(a.id, a.roles)); } catch { return fail(res); }
});
router.get("/", async (req, res) => {
  try {
    await ensureSwept();
    const a = who(req);
    const filter = (["all", "unread", "action", "assigned", "important", "resolved"].includes(String(req.query.filter)) ? req.query.filter : "all") as Filter;
    const module = (Object.keys(MODULES).includes(String(req.query.module)) ? req.query.module : null) as ModuleId | null;
    const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
    return res.json(await list(a.id, a.roles, { filter, module, before, limit: Number(req.query.limit) || 30 }));
  } catch { return fail(res); }
});
for (const what of ["read", "unread", "action", "archive"] as const) {
  router.post(`/${what}`, async (req, res) => {
    try {
      const a = who(req);
      const ids = req.body?.ids === "all" ? "all" : Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 500) : [];
      if (ids !== "all" && !ids.length) return res.status(400).json({ error: "Choose notifications." });
      if (ids === "all" && what !== "read") return res.status(400).json({ error: "Only 'mark all as read' applies to all." });
      const out = await mark(a.id, a.roles, ids, what);
      if (what === "archive" || what === "action") await audit({ adminUserId: a.id, adminRole: a.roles[0] ?? null, action: `notifications.${what}`, targetType: "admin_notification", detail: { count: out.updated } });
      return res.json(out);
    } catch { return fail(res); }
  });
}
router.get("/prefs", async (req, res) => { try { return res.json({ prefs: await getPrefs(who(req).id) }); } catch { return fail(res); } });
router.put("/prefs", async (req, res) => { try { return res.json({ prefs: await savePrefs(who(req).id, req.body?.prefs) }); } catch { return fail(res); } });
router.post("/sweep", requireRole("super_admin"), async (_req, res) => { try { return res.json(await sweep()); } catch { return fail(res); } });

export default router;
