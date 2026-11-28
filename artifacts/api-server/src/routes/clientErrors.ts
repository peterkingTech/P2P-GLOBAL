// App error reports (2026-11-28). When a screen (or the film player) fails to render on a phone, the app's error
// boundary sends the error here so it shows in the server log — iPhone JavaScript errors are otherwise invisible to us.
// Nothing is stored in the database. No personal data: the screen's route name, the error message, the first lines of
// the stack, platform and app version. Mounted at /api/client-errors; works signed in or out.
import { Router } from "express";

const router = Router();
const recent = new Map<string, number[]>();   // ip → timestamps (at most 30 reports per 10 minutes per address)
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").slice(0, n) : "");

router.post("/", (req, res) => {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (list.length >= 30) return res.status(429).json({ ok: false });
  list.push(now); recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  const b = req.body ?? {};
  console.error(`[client-error] where=${clip(b.where, 80)} platform=${clip(b.platform, 20)} app=${clip(b.appVersion, 30)} message=${clip(b.message, 400)} stack=${clip(b.stack, 900)}`);
  return res.json({ ok: true });
});

export default router;
