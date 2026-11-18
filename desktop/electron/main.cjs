/**
 * Electron entry point — the packaged "real installer" flavour of the desktop
 * app (double-click .exe / .dmg). It starts the app's own server on a free port
 * inside a writable workspace, then shows it in a native window.
 *
 * Build it with: npm run desktop:dist  (see DESKTOP.md)
 */
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { prepareWorkspace } = require("./workspace.cjs");

const APP_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "app")
  : path.resolve(__dirname, "..", "..");

let serverProcess = null;
let mainWindow = null;

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

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (await res.json().catch(() => null)) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

async function startServer() {
  const { workspace } = prepareWorkspace({
    appDir: APP_DIR,
    userDataDir: app.getPath("userData"),
  });

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, ["server.mjs", "--prod"], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      // Electron's bundled Node runtime instead of a system Node install.
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logFile = path.join(workspace, "data", "desktop.log");
  serverProcess.stdout.on("data", (d) => fs.appendFileSync(logFile, d));
  serverProcess.stderr.on("data", (d) => fs.appendFileSync(logFile, d));
  serverProcess.on("exit", (code) => {
    if (code && code !== 0 && mainWindow) {
      dialog.showErrorBox(
        "CLIPX AI stopped",
        `The app server exited (code ${code}). Details: ${logFile}`
      );
    }
  });

  const ready = await waitForServer(url);
  if (!ready) throw new Error(`Server did not start. See ${logFile}`);
  return url;
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill("SIGTERM");
  setTimeout(() => {
    try {
      serverProcess?.kill("SIGKILL");
    } catch {
      /* gone */
    }
  }, 2000).unref?.();
}

function buildMenu(url) {
  return Menu.buildFromTemplate([
    {
      label: "CLIPX AI",
      submenu: [
        { label: "Open in browser", click: () => shell.openExternal(url) },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "Edit", submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "View",
      submenu: [
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { role: "toggleDevTools" },
      ],
    },
  ]);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const url = await startServer();
      mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 720,
        backgroundColor: "#0B0B0F",
        title: "CLIPX AI",
        autoHideMenuBar: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      });
      Menu.setApplicationMenu(buildMenu(url));
      // External links (YouTube/Instagram permalinks) belong outside the app.
      mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
        shell.openExternal(target);
        return { action: "deny" };
      });
      await mainWindow.loadURL(url);
      mainWindow.on("closed", () => {
        mainWindow = null;
      });
    } catch (err) {
      dialog.showErrorBox("CLIPX AI could not start", String(err.message || err));
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    stopServer();
    app.quit();
  });
  app.on("before-quit", stopServer);
}
