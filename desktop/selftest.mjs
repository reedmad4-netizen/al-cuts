#!/usr/bin/env node
/**
 * Desktop self-test — proves the packaging logic works without a GUI.
 *
 * 1. `launch.mjs --check` starts the real server, waits for health, stops it.
 * 2. The packaged-app workspace (used by the Electron build) is created from
 *    this repo, then a server is started *from that workspace* to prove the
 *    linked `.next`/`node_modules` and writable `data/`, `public/media` work.
 *
 * Run: npm run desktop:selftest
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { prepareWorkspace } = require("./electron/workspace.cjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitHealth(port, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const body = await res.json().catch(() => null);
      if (body) return body;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

function portIsFree(port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      const done = (free) => {
        socket.destroy();
        if (free) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(attempt, 250);
      };
      socket.once("connect", () => done(false));
      socket.once("error", () => done(true));
      socket.setTimeout(1000, () => done(true));
    };
    attempt();
  });
}

/**
 * When `npm run desktop:dist*` has produced an unpacked app, test *that* — it is
 * the thing users install. Falls back to the source tree.
 */
function findPackagedApp() {
  const release = path.join(ROOT, "release");
  if (!fs.existsSync(release)) return null;
  for (const dir of fs.readdirSync(release)) {
    const candidates = [
      path.join(release, dir, "resources", "app"),
      path.join(release, dir, "CLIPX AI.app", "Contents", "Resources", "app"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, "server.mjs"))) return candidate;
    }
  }
  return null;
}

function runLauncherCheck() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["desktop/launch.mjs", "--check"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => resolve({ code, out }));
  });
}

async function main() {
  console.log("\nDesktop self-test\n");
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.error("No production build — run `npm run build` first.");
    process.exit(1);
  }

  // ---- 1. launcher ----
  console.log("launcher");
  const launcher = await runLauncherCheck();
  check("launcher starts the server and reaches health", launcher.code === 0, `exit ${launcher.code}`);
  check(
    "launcher shuts the server down again",
    /Shutting down the app server/.test(launcher.out)
  );

  // The launcher must not exit before the child is gone, otherwise the server
  // keeps the port bound (and the window would look closed while it still runs).
  // --check prints a pretty-printed JSON summary; scrape the port from it.
  const reportedPort = Number((launcher.out.match(/"port":\s*(\d+)/) || [])[1]) || 0;
  check(
    "no orphaned server after the window closes",
    reportedPort ? await portIsFree(reportedPort) : false,
    reportedPort ? `port ${reportedPort} still listening` : "launcher did not report a port"
  );

  // ---- 2. packaged workspace ----
  console.log("\npackaged workspace");
  const userDataDir = path.join(os.tmpdir(), "clipx-desktop-selftest");
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const packagedApp = findPackagedApp();
  const appDir = packagedApp || ROOT;
  check(
    "testing the packaged app" + (packagedApp ? "" : " (none built — using the source tree)"),
    true,
    ""
  );

  // A marker file proves non-media static assets reach the packaged workspace.
  const marker = path.join(appDir, "public", "desktop-selftest-marker.txt");
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, "static asset probe\n");

  const first = prepareWorkspace({ appDir, userDataDir });
  const ws = first.workspace;
  const realpath = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return "";
    }
  };

  check("fresh install detected", first.reinstalled === true);
  check("server entry copied", fs.existsSync(path.join(ws, "server.mjs")));
  check("runtime shim copied", fs.existsSync(path.join(ws, "scripts", "node-compat.mjs")));
  check(".next linked to the app", realpath(path.join(ws, ".next")) === realpath(path.join(appDir, ".next")));
  check(
    "node_modules linked to the app",
    realpath(path.join(ws, "node_modules")) === realpath(path.join(appDir, "node_modules"))
  );
  check(
    "static public assets reach the app",
    fs.existsSync(path.join(ws, "public", "desktop-selftest-marker.txt"))
  );
  check(
    "media directories are writable",
    (() => {
      try {
        const probe = path.join(ws, "public", "media", "clips", ".probe");
        fs.writeFileSync(probe, "x");
        fs.rmSync(probe);
        return true;
      } catch {
        return false;
      }
    })()
  );
  check(
    "demo media seeded",
    ["clips", "posters", "streams"].some(
      (dir) => fs.readdirSync(path.join(ws, "public", "media", dir)).length > 0
    )
  );
  check(
    "runtime manifest in the workspace",
    (() => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(ws, "package.json"), "utf8"));
        return Boolean(manifest.version);
      } catch {
        return false;
      }
    })()
  );

  const second = prepareWorkspace({ appDir, userDataDir });
  check("second launch reuses the workspace", second.reused === true);

  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs", "--prod"], {
    cwd: ws,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  const health = await waitHealth(port);
  check("server starts from the workspace", Boolean(health), log.slice(-300));
  if (health) {
    check("health reports the app version", Boolean(health.version), JSON.stringify(health).slice(0, 120));

    // Writes only happen on real use, so make the app do some: sign in (creates
    // the session key + demo user) and then check the files landed in the
    // workspace rather than beside the (read-only) install directory.
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/demo`, {
      method: "POST",
    }).catch(() => null);
    check("demo login works from the packaged app", login?.ok === true, `HTTP ${login?.status}`);
    check(
      "the app writes its database into the workspace",
      fs.existsSync(path.join(ws, "data", "clipx.db")),
      fs.readdirSync(path.join(ws, "data")).join(",")
    );
  }
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(marker, { force: true });

  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? `\n✅ PASS — ${results.length} checks\n`
      : `\n❌ FAIL — ${failed} of ${results.length} checks failed\n`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Self-test crashed:", err);
  process.exit(1);
});
