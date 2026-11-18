# CLIPX AI as a desktop app

Two ways to get a double-clickable app. Both run exactly the same code as the web
version — the desktop build just starts the server for you, on a free local port,
and shows it in its own window.

| | **Launcher** (works today) | **Installer** (.exe / .dmg / AppImage) |
|---|---|---|
| Needs | Node.js (already required to run this project) | nothing — bundles its own runtime |
| Size | ~0 MB extra | ~250–400 MB |
| Window | Edge/Chrome in app mode (no tabs, no address bar) | native Electron window |
| Build here | ✅ works, tested | ⚠️ needs a machine with Electron downloads (or CI) |
| Start | `npm run desktop` or the shortcut | install and double-click |

---

## 1. Launcher (recommended, no build step)

```bash
npm run desktop
```

That starts the production server on a free port, waits for `/api/health`, opens a
chromeless app window, and **stops the server when you close the window**. If
there is no production build yet, the first run builds it automatically.

### Make it double-clickable

```bash
npm run desktop:shortcut
```

| OS | What gets created |
|---|---|
| Windows | `CLIPX AI.lnk` on your Desktop → runs `desktop/CLIPX AI.vbs` (no console window), with the app icon |
| macOS | `~/Applications/CLIPX AI.app` |
| Linux | `~/.local/share/applications/clipx-ai.desktop` **and** a copy on your Desktop |

You can also just double-click the file that ships in `desktop/`:

- **Windows** — `desktop\CLIPX AI.vbs` (hidden console) or `CLIPX AI.bat` (shows logs)
- **macOS / Linux** — `desktop/CLIPX AI.command`

### What it does under the hood

```
desktop/launch.mjs
  ├── ensures .next/build (runs `npm run build` once if missing)
  ├── picks a free port, starts `node server.mjs --prod` with that PORT
  ├── waits for /api/health to answer JSON (any status — 503 only means no FFmpeg)
  ├── finds Edge/Chrome/Brave and opens  --app=http://127.0.0.1:<port>
  │     with a dedicated profile in %LOCALAPPDATA%/CLIPX AI/window
  └── when the window closes → SIGTERM the server
```

Flags: `--port 4100`, `--dev`, `--no-open` (server only), `--check` (start,
verify, exit — used by tests).

Logs go to `data/desktop.log`.

---

## 2. Installer (Electron)

The packaged app is a normal Electron shell around the same server:

- `desktop/electron/main.cjs` — window, menu, single-instance lock, external links
  opened in the real browser, clean shutdown.
- `desktop/electron/workspace.cjs` — builds a **writable workspace** in the user's
  app-data folder on first launch: `server.mjs`, `scripts/`, `package.json` are
  copied; `.next` and `node_modules` are linked (junctions on Windows, symlinks
  elsewhere) because they are large and read-only; `public/media`, `data/` and
  `exports/` are real writable directories seeded once with the demo clips.
  That way an install under `Program Files` still works, and your clips survive
  app updates.
- `desktop/electron/main.cjs` starts the server with Electron's own bundled Node
  (`ELECTRON_RUN_AS_NODE=1`), so **no system Node is required** on the user's PC.

### Build it

```bash
npm i -D electron@33 electron-builder@25
npm run build
npm run desktop:dist:win     # or :mac / :linux, or `desktop:dist` for the host OS
```

Installers land in `release/`:

| OS | Output |
|---|---|
| Windows | `CLIPX-AI-<version>-x64.exe` (NSIS installer) + a portable `.exe` |
| macOS | `.dmg` and `.zip` |
| Linux | `.AppImage` and `.deb` |

Cross-building caveats: a Windows installer must be built **on Windows** (or in CI)
unless wine is installed; macOS `.dmg` must be built on macOS. Unsigned builds
show SmartScreen/Gatekeeper warnings — expected for an unsigned app.

### Build them without a dev machine

`.github/workflows/desktop.yml` builds all three OSes and uploads the installers as
artifacts:

1. Push this branch to GitHub.
2. **Actions → Desktop installers → Run workflow**.
3. Download `clipx-ai-win` → `CLIPX-AI-<version>-x64.exe`.

Tagging `v1.7.0` runs it automatically.

---

## Verifying the desktop packaging

```bash
npm run desktop:selftest
```

14 checks, no GUI required:

```
launcher
  ✅ launcher starts the server and reaches health
  ✅ launcher shuts the server down again
packaged workspace
  ✅ fresh install detected
  ✅ server entry copied
  ✅ runtime shim copied
  ✅ .next linked to the app
  ✅ node_modules linked to the app
  ✅ media directories are writable
  ✅ demo media seeded
  ✅ second launch reuses the workspace
  ✅ server starts from the workspace
  ✅ health reports the app version
  ✅ demo login works from the packaged app
  ✅ the app writes its database into the workspace
```

`npm run desktop:check` is the smaller version (start → health → stop).

---

## FAQ

**Do I need Node.js for the launcher?** Yes — it's already how you run the app.
Use the Electron installer if you want a machine with nothing installed.

**Where are my clips and settings?** Launcher: `data/` and `public/media/` in the
project folder. Installer: the app-data workspace (`%APPDATA%\CLIPX AI\workspace`
on Windows, `~/Library/Application Support/CLIPX AI/workspace` on macOS,
`~/.config/CLIPX AI/workspace` on Linux).

**“FFmpeg/FFprobe not found” warning at start.** Video capture is disabled until
FFmpeg is available: install it, or run `npm install --include=optional`, or set
`FFMPEG_PATH` / `FFPROBE_PATH`. The launcher auto-detects the bundled binaries.

**Does it work offline?** Yes for clipping and rendering. Instagram/YouTube
uploads need internet, obviously.

**Can I run it on another machine without Node?** Only with the Electron build.
