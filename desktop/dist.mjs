#!/usr/bin/env node
/**
 * Builds a double-clickable CLIPX AI installer for this OS (or a named one).
 *
 *   npm run desktop:dist            # current OS
 *   npm run desktop:dist:win        # .exe  (Windows; needs Windows or wine)
 *   npm run desktop:dist:mac        # .dmg  (needs macOS)
 *   npm run desktop:dist:linux      # .AppImage + .deb
 *
 * It is a thin wrapper so the only requirement is `npm install`: it builds the
 * web app if needed, installs the Electron tooling on first use, then runs
 * electron-builder. Output lands in `release/`.
 */
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"))[0];
const platform = wanted || (process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux");

// Ship only the binaries the target OS can run. electron-builder's node_modules
// matcher honours only negative patterns, and a platform-level `files` array
// replaces the global one, so these are merged into a generated config.
const PRUNE = {
  win: [
    "!node_modules/@next/swc-linux-x64-gnu/**",
    "!node_modules/@next/swc-linux-x64-musl/**",
    "!node_modules/@next/swc-linux-arm64-gnu/**",
    "!node_modules/@next/swc-linux-arm64-musl/**",
    "!node_modules/@next/swc-darwin-x64/**",
    "!node_modules/@next/swc-darwin-arm64/**",
    "!node_modules/@next/swc-win32-arm64-msvc/**",
    "!node_modules/ffprobe-static/bin/linux/**",
    "!node_modules/ffprobe-static/bin/darwin/**",
    "!node_modules/@img/sharp-linux*/**",
    "!node_modules/@img/sharp-darwin*/**",
    "!node_modules/@img/sharp-libvips-linux*/**",
    "!node_modules/@img/sharp-libvips-darwin*/**",
  ],
  mac: [
    "!node_modules/@next/swc-win32-x64-msvc/**",
    "!node_modules/@next/swc-win32-arm64-msvc/**",
    "!node_modules/@next/swc-win32-ia32-msvc/**",
    "!node_modules/@next/swc-linux-x64-gnu/**",
    "!node_modules/@next/swc-linux-x64-musl/**",
    "!node_modules/@next/swc-linux-arm64-gnu/**",
    "!node_modules/@next/swc-linux-arm64-musl/**",
    "!node_modules/ffprobe-static/bin/win32/**",
    "!node_modules/ffprobe-static/bin/linux/**",
    "!node_modules/@img/sharp-win32*/**",
    "!node_modules/@img/sharp-linux*/**",
    "!node_modules/@img/sharp-libvips-win32*/**",
    "!node_modules/@img/sharp-libvips-linux*/**",
  ],
  linux: [
    "!node_modules/@next/swc-linux-x64-musl/**",
    "!node_modules/@next/swc-win32-x64-msvc/**",
    "!node_modules/@next/swc-win32-arm64-msvc/**",
    "!node_modules/@next/swc-win32-ia32-msvc/**",
    "!node_modules/@next/swc-darwin-x64/**",
    "!node_modules/@next/swc-darwin-arm64/**",
    "!node_modules/ffprobe-static/bin/win32/**",
    "!node_modules/ffprobe-static/bin/darwin/**",
    "!node_modules/@img/sharp-win32*/**",
    "!node_modules/@img/sharp-darwin*/**",
    "!node_modules/@img/sharp-libvips-win32*/**",
    "!node_modules/@img/sharp-libvips-darwin*/**",
  ],
};

const CROSS = {
  win: { ok: ["win32"], tool: "wine (or build on Windows / use the GitHub Actions workflow)" },
  mac: { ok: ["darwin"], tool: "macOS (Apple does not allow .dmg creation elsewhere)" },
  linux: { ok: ["linux", "win32", "darwin"], tool: "Linux" },
};

function sh(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}\n`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", ...opts });
  return res.status === 0;
}

function has(moduleName) {
  const probe = spawnSync(process.execPath, ["-e", `require.resolve("${moduleName}/package.json")`], {
    cwd: ROOT,
    stdio: "ignore",
  });
  return probe.status === 0;
}

/**
 * The installer is only useful if the packaged tree really contains the app.
 * These checks run after electron-builder finishes, so a broken packaging
 * config fails loudly instead of shipping an installer that cannot start.
 */
function verifyPackaged(platform) {
  const outDir = path.join(ROOT, "release", `${platform === "win" ? "win" : platform === "mac" ? "mac" : "linux"}-unpacked`);
  const appDir = platform === "mac"
    ? path.join(outDir, "CLIPX AI.app", "Contents", "Resources", "app")
    : path.join(outDir, "resources", "app");
  const asar = path.join(path.dirname(appDir), "app.asar");

  // asar is disabled in the build config, so `app` is a plain directory.
  const base = fs.existsSync(appDir) ? appDir : null;
  const required = [
    "package.json",
    "server.mjs",
    "next.config.mjs",
    "runtime-package.json",
    "desktop/electron/main.cjs",
    "desktop/electron/workspace.cjs",
    "scripts/node-compat.mjs",
    ".next/BUILD_ID",
    "node_modules/next/package.json",
    "node_modules/sql.js/package.json",
    "node_modules/ws/package.json",
    "public/media/clips/demo-fps-clutch.mp4",
    "public/media/posters/fps-clutch.jpg",
  ];

  console.log("\nVerifying the packaged app…");
  if (!base) {
    console.log(`   ⚠ could not find ${outDir}${fs.existsSync(asar) ? " (found app.asar instead)" : ""}`);
    return false;
  }

  let ok = true;
  for (const file of required) {
    const exists = fs.existsSync(path.join(base, file));
    if (!exists) ok = false;
    console.log(`   ${exists ? "✅" : "❌"} ${file}`);
  }

  const ffmpeg = ["node_modules/ffmpeg-static/ffmpeg", "node_modules/ffmpeg-static/ffmpeg.exe"]
    .map((p) => path.join(base, p))
    .find((p) => fs.existsSync(p));
  console.log(`   ${ffmpeg ? "✅" : "⚠ "} bundled FFmpeg${ffmpeg ? "" : " (missing — video features disabled; run npm install --include=optional)"}`);

  const size = (() => {
    try {
      const out = execFileSync("du", ["-sh", base], { encoding: "utf8" });
      return out.split("\t")[0];
    } catch {
      return null;
    }
  })();
  if (size) console.log(`   size: ${size}`);
  return ok;
}

function main() {
  const target = CROSS[platform];
  if (!target) {
    console.error(`Unknown target "${platform}". Use win, mac or linux.`);
    process.exit(1);
  }

  if (!target.ok.includes(process.platform)) {
    console.error(
      `\n⚠  ${platform === "mac" ? ".dmg" : ".exe"} builds are only reliable on ${target.tool}.\n` +
        `   You are on ${process.platform}. Two alternatives:\n` +
        `     1. Run the “Desktop installers” GitHub Actions workflow (no local tooling needed).\n` +
        `     2. Use the launcher instead: npm run desktop  (no installer required).\n`
    );
    process.exit(1);
  }

  const needsBuild = !fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
  const needsTooling = !has("electron") || !has("electron-builder");

  if (dryRun) {
    console.log(`\nDry run — target: ${platform}`);
    console.log(`  production build: ${needsBuild ? "missing (would run npm run build)" : "present"}`);
    console.log(`  electron tooling: ${needsTooling ? "missing (would run npm i -D electron@33 electron-builder@25)" : "installed"}`);
    console.log(`  next step: npx electron-builder --${platform} --publish never\n`);
    process.exit(0);
  }

  // Keep the packaged runtime manifest in sync with the real version.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  fs.mkdirSync(path.join(ROOT, "desktop", "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "desktop", "runtime", "app-package.json"),
    JSON.stringify(
      { name: pkg.name, version: pkg.version, private: true, description: pkg.description, main: "server.mjs" },
      null,
      2
    ) + "\n"
  );

  if (needsBuild) {
    console.log("No production build yet — building it once…");
    if (!sh(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"])) {
      console.error("The web build failed; fix it before packaging.");
      process.exit(1);
    }
  }

  if (needsTooling) {
    console.log("Installing the Electron tooling (one-time, ~150 MB)…");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    if (!sh(npm, ["install", "--save-dev", "electron@33", "electron-builder@25"])) {
      console.error("Could not install electron / electron-builder — check your network or proxy.");
      process.exit(1);
    }
  }

  // A generated config so the per-OS pruning can extend the global `files`
  // list without replacing it.
  const config = { ...pkg.build, files: [...(pkg.build.files || ["**/*"]), ...(PRUNE[platform] || [])] };
  const configPath = path.join(ROOT, ".desktop-build.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const extra = process.argv.slice(2).filter((a) => a.startsWith("-") && a !== "--dry-run");
  if (!sh(npx, ["electron-builder", "--config", configPath, `--${platform}`, "--publish", "never", ...extra])) {
    console.error("\nPackaging failed. See the log above; `release/` may contain partial output.");
    process.exit(1);
  }

  const verified = verifyPackaged(platform);
  const release = path.join(ROOT, "release");
  const files = fs.existsSync(release)
    ? fs.readdirSync(release).filter((f) => /\.(exe|dmg|zip|AppImage|deb)$/i.test(f))
    : [];

  console.log("\n✅ Done. Installers:");
  if (files.length === 0) console.log("   (nothing found — check the log above)");
  for (const file of files) {
    const size = (fs.statSync(path.join(release, file)).size / 1_048_576).toFixed(0);
    console.log(`   ${path.join("release", file)}  (${size} MB)`);
  }
  console.log(verified ? "" : "\n⚠  The packaged app is missing expected files — see the checks above.\n");
  if (!verified) process.exitCode = 1;
}

main();
