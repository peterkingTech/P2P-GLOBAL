// Cross-platform dev launcher — replaces a package.json script that
// interpolated $REPLIT_EXPO_DEV_DOMAIN/$REPLIT_DEV_DOMAIN/$REPL_ID/$PORT via
// raw shell `$VAR` syntax. That only works in a POSIX shell with those vars
// already set (i.e. inside a Replit workspace) — anywhere else (Windows,
// any non-Replit host) it either fails outright or silently produces
// broken values like EXPO_PACKAGER_PROXY_URL=https:// with nothing after it.
//
// Outside Replit this just runs a plain `expo start` on a sensible default
// port. Inside Replit, the same Replit-provided env vars still work exactly
// as before — nothing lost, just no longer required.
const { spawn } = require("child_process");

const port = process.env.PORT || "8081";
const env = { ...process.env, CI: "1" };

if (process.env.REPLIT_DEV_DOMAIN) {
  env.EXPO_PACKAGER_PROXY_URL = `https://${process.env.REPLIT_EXPO_DEV_DOMAIN || process.env.REPLIT_DEV_DOMAIN}`;
  env.EXPO_PUBLIC_DOMAIN = process.env.REPLIT_DEV_DOMAIN;
  env.REACT_NATIVE_PACKAGER_HOSTNAME = process.env.REPLIT_DEV_DOMAIN;
  if (process.env.REPL_ID) env.EXPO_PUBLIC_REPL_ID = process.env.REPL_ID;
}

const child = spawn(
  "pnpm",
  ["exec", "expo", "start", "--localhost", "--port", port, "--clear"],
  { stdio: "inherit", env, shell: process.platform === "win32" }
);

child.on("exit", (code) => process.exit(code ?? 0));
