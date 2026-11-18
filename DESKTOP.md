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

### Where does the `.exe` come from?

GitHub only shows a workflow's **Run workflow** button when the workflow file is on
the repo's default branch, so pick one:

**A. You have a Windows PC (no GitHub needed)**

```bat
git clone https://github.com/reedmad4-netizen/al-cuts.git
cd al-cuts
git checkout arena/5af5ddc6-al-cuts
npm install
npm run build
npm run desktop:dist:win
```

`npm run desktop:dist:win` installs the Electron tooling on first use, packages the
app, and prints the result:

```
✅ Done. Installers:
   release\CLIPX-AI-1.7.0-x64.exe  (280 MB)   ← double-click to install
   release\CLIPX-AI-1.7.0-x64.exe  (portable)
```

**B. Merge this branch into `main`, then use the Actions button**

1. Merge PR #1 (or just the desktop commits) into `main`.
2. **Actions → Desktop installers → Run workflow** (branch: any).
3. Wait ~10–15 min; open the finished run → **Artifacts → `clipx-ai-win`** →
   download the `.zip` → unzip → `CLIPX-AI-<version>-x64.exe`.

**C. Push a `v*` tag — no merge needed, files land on the Releases page**

```bash
git tag v1.7.0 && git push origin v1.7.0
```

The workflow runs on the tag, builds all three OSes, and attaches the installers to
a (draft) **Releases → v1.7.0** entry — a direct download link for the `.exe`,
`.dmg` and `.AppImage`. Publish the draft release to make the links public.

> Building the Windows `.exe` on Linux/macOS needs wine; a macOS `.dmg` can only be
> built on macOS. That is why the workflow exists.

---

## Verifying the desktop packaging

```bash
npm run desktop:selftest
```

18 checks, no GUI required:

```
launcher
  ✅ launcher starts the server and reaches health
  ✅ launcher shuts the server down again
  ✅ no orphaned server after the window closes
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
  ✅ static public assets reach the app
  ✅ runtime manifest in the workspace
  ✅ health reports the app version
  ✅ demo login works from the packaged app
  ✅ the app writes its database into the workspace
```

`npm run desktop:check` is the smaller version (start → health → stop).

If `release/` contains an unpacked build (`release/win-unpacked`, `…/linux-unpacked`,
`…/CLIPX AI.app`), the self-test automatically validates **that artifact** instead of
the source tree — the checks read "testing the packaged app".

`npm run desktop:dist` also verifies the packaged tree after building (package.json,
`server.mjs`, `.next/BUILD_ID`, `node_modules/next`, the demo clips, the Electron
entry point) and prints the size, so a broken packaging config fails loudly instead
of shipping an installer that cannot start.

### Packaging details worth knowing

- **`asar` is off.** The app server runs as a child process and needs a real
  `node_modules` directory it can link into its writable workspace; a plain
  directory is the simple, verifiable option. Cost: a few thousand loose files.
- **The app directory only contains** the Electron entry point, `package.json`,
  the production dependencies, `.next` (without its 187 MB build cache), the demo
  clips/posters, `scripts/`, `server.mjs` and `next.config.mjs`. Everything else in
  the repo (`src/`, `public/media/generated`, `exports/`, `data/`) stays out.
- **Other platforms' binaries are pruned** per target — Next's SWC and sharp ship
  one package per OS/arch, and `ffprobe-static` ships every platform. Without
  pruning the app directory is ~1.7 GB; with it, ~530 MB (installer compresses to
  roughly 180–250 MB).
- **Bundled FFmpeg**: `ffmpeg-static`/`ffprobe-static` are installed as optional
  dependencies, and the Electron shell passes their paths to the server, so video
  features work without the user installing FFmpeg.
- **The workspace manifest is `runtime-package.json`**, not `app/package.json`.
  Listing the project's `package.json` in `extraResources` is a known
  electron-builder bug ([#4160](https://github.com/electron-userland/electron-builder/issues/4160))
  that makes packaging fail with *Application "package.json" … does not exist*.

Quick check without building an installer (≈20 s):

```bash
npx electron-builder --config .desktop-build.json --win --dir
```

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
