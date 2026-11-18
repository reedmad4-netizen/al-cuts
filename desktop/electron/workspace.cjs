/**
 * Prepares a writable workspace for the packaged desktop app.
 *
 * An installed app lives in a read-only directory (Program Files, /Applications,
 * an AppImage mount), but Next.js needs to write `data/`, `public/media` and
 * `exports/` next to its working directory. So on first launch we build a small
 * workspace in the user's app-data folder:
 *
 *   workspace/server.mjs, scripts/, package.json   ← copied (tiny)
 *   workspace/.next, workspace/node_modules        ← linked (huge, read-only)
 *   workspace/public/media/...                     ← real dirs, seeded with the
 *                                                    demo samples, then writable
 *   workspace/data, workspace/exports              ← real dirs, user content
 *
 * Linking instead of copying keeps first-run setup to a fraction of a second and
 * avoids duplicating ~300 MB of dependencies on every update.
 */
const fs = require("node:fs");
const path = require("node:path");

const VERSION = require("../version.cjs").VERSION;

function linkDir(target, linkPath) {
  fs.rmSync(linkPath, { recursive: true, force: true });
  // Windows junctions work without admin rights; POSIX symlinks are the norm.
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function copyIfNewer(from, to) {
  try {
    const src = fs.statSync(from);
    const dst = fs.existsSync(to) ? fs.statSync(to) : null;
    if (dst && dst.mtimeMs >= src.mtimeMs && dst.size === src.size) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  } catch {
    /* a missing optional file is not fatal */
  }
}

function copyTree(from, to, filter = () => true) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (!filter(src, entry)) continue;
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyTree(src, dst, filter);
    } else if (entry.isFile()) {
      copyIfNewer(src, dst);
    }
  }
}

/**
 * @param {{appDir: string, userDataDir: string, version?: string}} options
 * @returns {{workspace: string, reinstalled: boolean, reused: boolean}}
 */
function prepareWorkspace({ appDir, userDataDir, version = VERSION }) {
  const workspace = path.join(userDataDir, "workspace");
  const stampPath = path.join(workspace, ".version");
  const stamp = fs.existsSync(stampPath)
    ? fs.readFileSync(stampPath, "utf8").trim()
    : "";

  const upToDate = stamp === version && fs.existsSync(path.join(workspace, "server.mjs"));
  fs.mkdirSync(workspace, { recursive: true });

  // --- code (cheap to copy, must refresh on every version) ---
  const code = ["server.mjs", "next.config.mjs", "package.json"];
  for (const file of code) {
    const from = path.join(appDir, file);
    if (!fs.existsSync(from)) continue;
    copyIfNewer(from, path.join(workspace, file));
  }
  copyTree(path.join(appDir, "scripts"), path.join(workspace, "scripts"));

  // --- dependencies and build output (link, unless already linked) ---
  for (const dir of [".next", "node_modules"]) {
    const target = path.join(appDir, dir);
    if (!fs.existsSync(target)) continue;
    const linkPath = path.join(workspace, dir);
    const ok =
      fs.existsSync(linkPath) &&
      (() => {
        try {
          return fs.realpathSync(linkPath) === fs.realpathSync(target);
        } catch {
          return false;
        }
      })();
    if (!ok) linkDir(target, linkPath);
  }

  // --- writable media directory, seeded once with the bundled demo samples ---
  const mediaDirs = ["clips", "streams", "generated", "posters", "uploads"];
  const mediaRoot = path.join(workspace, "public", "media");
  for (const dir of mediaDirs) fs.mkdirSync(path.join(mediaRoot, dir), { recursive: true });

  // Everything else under public/ (favicons, images, robots.txt…) is read-only
  // static content: link it so the app can serve it without copying, while
  // public/media above stays a real writable directory.
  const publicSrc = path.join(appDir, "public");
  if (fs.existsSync(publicSrc)) {
    for (const entry of fs.readdirSync(publicSrc, { withFileTypes: true })) {
      if (entry.name === "media") continue;
      const src = path.join(publicSrc, entry.name);
      const dst = path.join(workspace, "public", entry.name);
      if (fs.existsSync(dst)) continue;
      if (entry.isDirectory()) linkDir(src, dst);
      else if (entry.isFile()) copyIfNewer(src, dst);
    }
  }

  if (!upToDate) {
    for (const dir of ["generated", "posters"]) {
      const from = path.join(appDir, "public", "media", dir);
      if (!fs.existsSync(from)) continue;
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        copyIfNewer(path.join(from, entry.name), path.join(mediaRoot, dir, entry.name));
      }
    }
  }

  fs.mkdirSync(path.join(workspace, "data"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "exports"), { recursive: true });

  if (!upToDate) fs.writeFileSync(stampPath, version, "utf8");

  return { workspace, reinstalled: !upToDate, reused: upToDate };
}

module.exports = { prepareWorkspace, VERSION };
