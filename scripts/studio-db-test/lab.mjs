// Shared local lab: runs the REAL API routes against a PGlite database.
//
// makeTranslator(db, role, uid) turns supabase-js calls into SQL run AS that
// Postgres role (service_role for the API's reads; authenticated + uid for a
// signed-in user's client), so the migration's real grants, RLS and
// auth.uid() apply. rpc() uses named arguments, so parameter names must match
// the SQL functions exactly. bundleApp() bundles routes/studio.ts,
// routes/kingdomStories.ts and the scheduler with the Supabase client replaced
// by the translator and auth resolved from a synthetic token (= user id).
// Local testing only — never contacts a real backend.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function makeTranslator(db, role, uid = null) {
  let chain = Promise.resolve();
  const run = (sql, params) => {
    // Serialize: one PGlite connection, role switched per statement.
    const p = chain.then(async () => {
      await db.exec(`set test.uid = '${uid ?? ""}'; set role ${role};`);
      try { return await db.query(sql, params); } finally { await db.exec("reset role;"); }
    });
    chain = p.catch(() => {});
    return p;
  };
  const SETOF = new Set(["p2p_studio_claim_due_jobs", "p2p_studio_stale_approvals"]);
  return {
    from(table) {
      const q = { op: "select", cols: "*", filters: [], order: null, limit: null, offset: null, payload: null, single: false, maybe: false, returning: false, count: false, head: false };
      const where = (params) => q.filters.length ? " where " + q.filters.map(([op, c, v]) => {
        if (op === "in") { params.push(v); return `${c} = any($${params.length})`; }
        if (op === "notin") { params.push(v); return `not (${c} = any($${params.length}))`; }
        params.push(v);
        const sqlOp = { eq: "=", gte: ">=", lt: "<", lte: "<=", gt: ">", ilike: "ilike", like: "like" }[op];
        return `${c} ${sqlOp} $${params.length}`;
      }).join(" and ") : "";
      const exec = async () => {
        const params = [];
        let sql;
        if (q.op === "select") {
          const w = where(params);
          sql = `select ${q.cols} from ${table}${w}${q.order ? ` order by ${q.order[0]} ${q.order[1] ? "asc" : "desc"}` : ""}${q.limit != null ? ` limit ${q.limit}` : ""}${q.offset ? ` offset ${q.offset}` : ""}`;
          try {
            const rows = q.head ? [] : (await run(sql, params)).rows;
            let count = null;
            if (q.count) { const cp = []; const cw = where(cp); count = Number((await run(`select count(*)::int n from ${table}${cw}`, cp)).rows[0].n); }
            if (q.single || q.maybe) {
              if (q.single && rows.length !== 1) return { data: null, error: { code: "PGRST116", message: "expected one row" }, count };
              return { data: rows[0] ?? null, error: null, count };
            }
            return { data: q.head ? null : rows, error: null, count };
          } catch (e) { return { data: null, error: { code: e.code, message: e.message }, count: null }; }
        }
        if (q.op === "update") {
          const sets = Object.entries(q.payload).map(([k, v]) => { params.push(v); return `${k} = $${params.length}`; });
          sql = `update ${table} set ${sets.join(", ")}${where(params)}${q.returning ? ` returning ${q.cols}` : ""}`;
        } else if (q.op === "insert") {
          const keys = Object.keys(q.payload);
          keys.forEach((k) => params.push(q.payload[k]));
          sql = `insert into ${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})${q.returning ? ` returning ${q.cols}` : ""}`;
        } else if (q.op === "delete") {
          sql = `delete from ${table}${where(params)}`;
        }
        try {
          const rows = (await run(sql, params)).rows;
          if (q.single || q.maybe) {
            if (q.single && rows.length !== 1) return { data: null, error: { code: "PGRST116", message: "expected one row" } };
            return { data: rows[0] ?? null, error: null };
          }
          return { data: rows, error: null };
        } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
      };
      const c = {
        select(cols = "*", opts) { q.cols = cols.replace(/\s+/g, ""); if (opts?.count) q.count = true; if (opts?.head) q.head = true; if (q.op !== "select") q.returning = true; return c; },
        eq(k, v) { q.filters.push(["eq", k, v]); return c; },
        in(k, v) { q.filters.push(["in", k, v]); return c; },
        not(k, op, v) { if (op !== "in") throw new Error("translator: only not(..., 'in', ...)"); q.filters.push(["notin", k, String(v).replace(/^\(|\)$/g, "").split(",").filter(Boolean)]); return c; },
        gte(k, v) { q.filters.push(["gte", k, v]); return c; },
        gt(k, v) { q.filters.push(["gt", k, v]); return c; },
        lt(k, v) { q.filters.push(["lt", k, v]); return c; },
        lte(k, v) { q.filters.push(["lte", k, v]); return c; },
        ilike(k, v) { q.filters.push(["ilike", k, v]); return c; },
        like(k, v) { q.filters.push(["like", k, v]); return c; },
        order(k, o) { q.order = [k, o?.ascending !== false]; return c; },
        limit(n) { q.limit = n; return c; },
        range(a, b) { q.offset = a; q.limit = b - a + 1; return c; },
        update(p) { q.op = "update"; q.payload = p; return c; },
        insert(p) { q.op = "insert"; q.payload = p; return c; },
        delete() { q.op = "delete"; return c; },
        single() { q.single = true; return c; },
        maybeSingle() { q.maybe = true; return c; },
        then(res, rej) { exec().then(res, rej); },
      };
      return c;
    },
    async rpc(fn, args = {}) {
      const keys = Object.keys(args);
      const named = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
      try {
        if (SETOF.has(fn)) return { data: (await run(`select * from ${fn}(${named})`, keys.map((k) => args[k]))).rows, error: null };
        return { data: (await run(`select ${fn}(${named}) as r`, keys.map((k) => args[k]))).rows[0].r, error: null };
      } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
    },
    storage: { from: () => ({ remove: async () => ({ data: null, error: null }) }) },
  };
}

/** Bundles the real API pieces with Supabase replaced by translators over `db`. */
export async function bundleApp({ apiRoot, tmpDir, db, extraRoutes = "" }) {
  const require = createRequire(path.join(apiRoot, "package.json"));
  const { build } = require("esbuild");
  const roleOf = Object.fromEntries((await db.query(`select id, role from p2p_profiles`)).rows.map((r) => [r.id, r.role]));
  globalThis.__studioLab = {
    service: makeTranslator(db, "service_role"),
    asUser: (token) => makeTranslator(db, "authenticated", roleOf[token] ? token : null),
    getUser: async (t) => (roleOf[t] ? { data: { user: { id: t } }, error: null } : { data: { user: null }, error: { message: "bad" } }),
    roleOf: (t) => roleOf[t],
    logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
  };
  const posix = (p) => p.replace(/\\/g, "/");
  const plugin = { name: "lab", setup(b) {
    b.onResolve({ filter: /(^|\/)lib\/supabase$|^\.\.?\/supabase$/ }, () => ({ path: "supabase", namespace: "lab" }));
    b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: "logger", namespace: "lab" }));
    b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "sbjs", namespace: "lab" }));
    b.onLoad({ filter: /.*/, namespace: "lab" }, (a) => ({ loader: "js", contents: {
      supabase: `const L = globalThis.__studioLab; export const supabaseServiceRole = L.service; export const supabaseAsUser = (t) => L.asUser(t);
        export const supabase = { auth: { getUser: (t) => L.getUser(t) } };
        export async function verifyCaller(req) { const h = req.headers.authorization || ""; const t = h.startsWith("Bearer ") ? h.slice(7) : null; return t && L.roleOf(t) ? t : null; }`,
      logger: "export const logger = globalThis.__studioLab.logger;",
      sbjs: `export function createClient(url, key, opts) { const t = (opts?.global?.headers?.Authorization ?? "").replace("Bearer ", ""); const role = globalThis.__studioLab.roleOf(t);
        const c = { from: () => c, select: () => c, eq: () => c, single: async () => (role ? { data: { role }, error: null } : { data: null, error: { message: "none" } }) }; return c; }`,
    }[a.path] }));
  } };
  const entry = path.join(tmpDir, "lab-entry.ts");
  writeFileSync(entry, `import express from "express";
import studio from ${JSON.stringify(posix(path.join(apiRoot, "src/routes/studio.ts")))};
import stories from ${JSON.stringify(posix(path.join(apiRoot, "src/routes/kingdomStories.ts")))};
import wins from ${JSON.stringify(posix(path.join(apiRoot, "src/routes/kingdomWins.ts")))};
export { setWinsTranslatorForTests } from ${JSON.stringify(posix(path.join(apiRoot, "src/lib/winsTranslation.ts")))};
export { runStudioScheduler } from ${JSON.stringify(posix(path.join(apiRoot, "src/lib/studio/runtime.ts")))};
export const app = express();
${extraRoutes}
app.use(express.json());
app.use("/api/studio", studio);
app.use("/api/kingdom-stories", stories);
app.use("/api/kingdom-wins", wins);
`);
  const out = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [plugin],
    nodePaths: [path.join(apiRoot, "node_modules")], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  const file = path.join(tmpDir, "lab-app.mjs");
  writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}
