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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"))[0];
const platform = wanted || (process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux");

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

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  if (!sh(npx, ["electron-builder", `--${platform}`, "--publish", "never"])) {
    console.error("\nPackaging failed. See the log above; `release/` may contain partial output.");
    process.exit(1);
  }

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
  console.log("");
}

main();
