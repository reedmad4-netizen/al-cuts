#!/usr/bin/env node
/**
 * CLIPX AI — desktop launcher.
 *
 * Turns the web app into a double-clickable desktop app without shipping a
 * second runtime: it starts the production server on a free port, waits until
 * it is actually healthy, then opens a *chromeless* app window (Edge/Chrome
 * `--app=`), and shuts the server down again when that window closes.
 *
 * Why not Electron here? Electron is a 100 MB download that needs its own
 * packaging step per OS. This launcher reuses the browser engine already on the
 * machine, starts in under a second, and keeps the app.local feel: no tabs, no
 * address bar, its own icon and its own profile directory.
 *
 * Usage:
 *   node desktop/launch.mjs                 # normal desktop launch
 *   node desktop/launch.mjs --no-open       # just run the server
 *   node desktop/launch.mjs --check         # start, verify health, stop (CI)
 *   node desktop/launch.mjs --port 4100
 *   node desktop/launch.mjs --dev           # development server instead
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DEV = has("--dev");
const NO_OPEN = has("--no-open");
const CHECK = has("--check");
const REQUESTED_PORT = Number(valueOf("--port", 0)) || 0;

const DATA_DIR = path.join(ROOT, "data");
const LOG_FILE = path.join(DATA_DIR, "desktop.log");

function log(line) {
  const stamp = new Date().toISOString().slice(11, 19);
  const text = `[${stamp}] ${line}`;
  console.log(text);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never break the app */
  }
}

/** Asks the OS for a port that is free right now. */
function findFreePort(preferred) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      // Preferred port busy → ask for any free one instead.
      const fallback = net.createServer();
      fallback.unref();
      fallback.once("error", reject);
      fallback.listen(0, "127.0.0.1", () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
    server.listen(preferred || 0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * The server is "up" as soon as /api/health answers JSON. That endpoint returns
 * 503 when FFmpeg is missing — that is a usable app with video disabled, not a
 * failed start, so it must not keep the launcher waiting.
 */
async function waitForHealth(port, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const body = await res.json().catch(() => null);
      if (body && typeof body === "object") return body;
      lastError = `HTTP ${res.status} without a JSON body`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`Server did not become healthy: ${lastError}`);
}

/** Finds a video toolchain the app can use, preferring bundled binaries. */
function findMediaTools() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const env = {
    ffmpeg: process.env.FFMPEG_PATH,
    ffprobe: process.env.FFPROBE_PATH,
  };
  const bundled = {
    ffmpeg: path.join(ROOT, "node_modules", "ffmpeg-static", `ffmpeg${exe}`),
    ffprobe: path.join(ROOT, "node_modules", "ffprobe-static", "bin", process.platform, process.arch, `ffprobe${exe}`),
  };
  const exists = (p) => {
    try {
      return Boolean(p) && fs.existsSync(p);
    } catch {
      return false;
    }
  };
  return {
    ffmpeg: exists(env.ffmpeg) ? env.ffmpeg : exists(bundled.ffmpeg) ? bundled.ffmpeg : "",
    ffprobe: exists(env.ffprobe) ? env.ffprobe : exists(bundled.ffprobe) ? bundled.ffprobe : "",
  };
}

function ensureBuild() {
  if (DEV) return;
  if (fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) return;

  log("No production build found — building once (this takes ~1 minute)…");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawn(npm, ["run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return new Promise((resolve, reject) => {
    result.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Build failed (exit ${code})`))
    );
    result.on("error", reject);
  });
}

/** Chromium-based browsers that support `--app=` (no tabs, no URL bar). */
function candidateBrowsers() {
  const fromEnv = process.env.CLIPX_BROWSER;
  const list = fromEnv ? [fromEnv] : [];

  if (process.platform === "win32") {
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] || "";
    list.push(
      path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
    );
  } else if (process.platform === "darwin") {
    list.push(
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else {
    list.push(
      "/usr/bin/microsoft-edge",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/brave-browser",
      "/snap/bin/chromium"
    );
  }
  return list.filter(Boolean);
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function fallbackBrowserCommand(url) {
  if (process.platform === "darwin") return { cmd: "open", args: [url] };
  if (process.platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", url] };
  return { cmd: "xdg-open", args: [url] };
}

const state = { server: null, browser: null, stopping: false };

function stopAll(exitCode = 0) {
  if (state.stopping) return;
  state.stopping = true;
  try {
    state.browser?.kill();
  } catch {
    /* already gone */
  }
  const server = state.server;
  if (!server || server.exitCode !== null || server.signalCode !== null) {
    process.exit(exitCode);
  }

  log("Shutting down the app server…");

  // Stay alive until the child process is really gone. Exiting first would
  // orphan `server.mjs`, which keeps the port bound and the clips locked.
  let done = false;
  let forceKill = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (forceKill) clearTimeout(forceKill);
    process.exit(exitCode);
  };

  server.once("exit", finish);
  server.once("error", finish);

  forceKill = setTimeout(() => {
    try {
      server.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    setTimeout(finish, 750);
  }, 2500);

  try {
    server.kill("SIGTERM");
  } catch {
    finish();
  }
}

async function main() {
  await ensureBuild();

  const port = await findFreePort(REQUESTED_PORT);
  const url = `http://127.0.0.1:${port}`;
  const mode = DEV ? "--dev" : "--prod";

  log(`Starting CLIPX AI (${mode === "--dev" ? "development" : "production"}) on ${url}`);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

  const tools = findMediaTools();

  state.server = spawn(process.execPath, ["server.mjs", mode], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: DEV ? "development" : "production",
      ...(tools.ffmpeg ? { FFMPEG_PATH: tools.ffmpeg } : {}),
      ...(tools.ffprobe ? { FFPROBE_PATH: tools.ffprobe } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  state.server.stdout.on("data", (chunk) => logStream.write(chunk));
  state.server.stderr.on("data", (chunk) => logStream.write(chunk));
  state.server.on("exit", (code) => {
    if (!state.stopping) {
      log(`Server exited unexpectedly (code ${code}) — see data/desktop.log`);
      process.exit(code ?? 1);
    }
  });

  const health = await waitForHealth(port);
  log(`Server ready — v${health.version ?? "?"} on ${url}`);
  if (!health.media?.ready) {
    log(
      "WARNING: FFmpeg/FFprobe were not found, so clip capture and rendering are disabled. " +
        "Install FFmpeg (or run `npm install --include=optional`), then start again."
    );
  }

  if (CHECK) {
    // Used by tests/CI: prove the desktop bootstrap works, then leave.
    console.log(JSON.stringify({ ok: true, port, url, health }, null, 2));
    stopAll(0);
    return;
  }

  if (NO_OPEN) {
    log(`Open ${url} in your browser. Press Ctrl+C to quit.`);
    process.on("SIGINT", () => stopAll(0));
    process.on("SIGTERM", () => stopAll(0));
    return;
  }

  const browserPath = firstExisting(candidateBrowsers());
  const profileDir = path.join(
    process.env.LOCALAPPDATA || process.env.XDG_CONFIG_HOME || os.homedir(),
    "CLIPX AI",
    "window"
  );
  fs.mkdirSync(profileDir, { recursive: true });

  if (browserPath) {
    // A dedicated profile keeps the app window clean: no extensions, history or
    // tabs from the user's normal browsing.
    state.browser = spawn(
      browserPath,
      [
        `--app=${url}`,
        "--window-size=1440,900",
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate",
      ],
      { stdio: "ignore", detached: false }
    );
    log(`App window opened with ${path.basename(browserPath)}`);

    state.browser.on("exit", () => {
      log("App window closed.");
      stopAll(0);
    });
  } else {
    const { cmd, args } = fallbackBrowserCommand(url);
    log(`No Edge/Chrome found — opening in the default browser instead (${url}).`);
    state.browser = spawn(cmd, args, { stdio: "ignore" });
    state.browser.on("exit", () => {
      // The user's browser stays open independently, so keep the server alive
      // until this launcher is closed with Ctrl+C.
      log(`App is still running at ${url}. Press Ctrl+C to quit.`);
    });
  }

  process.on("SIGINT", () => stopAll(0));
  process.on("SIGTERM", () => stopAll(0));
  process.on("uncaughtException", (err) => {
    log(`Launcher error: ${err.message}`);
    stopAll(1);
  });
}

main().catch((err) => {
  log(`Failed to start: ${err.message}`);
  process.exit(1);
});
