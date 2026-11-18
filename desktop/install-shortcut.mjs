#!/usr/bin/env node
/**
 * Creates a desktop shortcut / app entry for CLIPX AI on the current OS.
 *
 *   npm run desktop:shortcut
 *
 * - Windows: a .lnk on the Desktop pointing at `wscript` + "CLIPX AI.vbs" (so no
 *   console flashes), with the app icon.
 * - macOS: a minimal ~/Applications/CLIPX AI.app bundle that runs the launcher.
 * - Linux: a .desktop entry in ~/.local/share/applications and on the Desktop.
 *
 * It only writes shortcuts; nothing else on the machine is modified.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = path.join(ROOT, "desktop", "launch.mjs");
const ICON_PNG = path.join(ROOT, "desktop", "icon.png");
const ICON_ICO = path.join(ROOT, "desktop", "icon.ico");
const HOME = os.homedir();

function desktopDir() {
  const candidates = [
    process.env.XDG_DESKTOP_DIR,
    path.join(HOME, "Desktop"),
    path.join(HOME, "Escritorio"),
    path.join(HOME, "OneDrive", "Desktop"),
  ].filter(Boolean);
  return candidates.find((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

function installLinux() {
  const apps = path.join(HOME, ".local", "share", "applications");
  fs.mkdirSync(apps, { recursive: true });

  const entry = `[Desktop Entry]
Type=Application
Version=1.0
Name=CLIPX AI
Comment=Automatic AI gaming clips, with Instagram Reels and YouTube Shorts uploads
Exec="${process.execPath}" "${LAUNCHER}"
Path=${ROOT}
Icon=${ICON_PNG}
Terminal=false
Categories=AudioVideo;Video;Utility;
StartupWMClass=CLIPX AI
`;
  const menuFile = path.join(apps, "clipx-ai.desktop");
  fs.writeFileSync(menuFile, entry, { mode: 0o755 });

  const written = [menuFile];
  const desktop = desktopDir();
  if (desktop) {
    const desktopFile = path.join(desktop, "clipx-ai.desktop");
    fs.writeFileSync(desktopFile, entry, { mode: 0o755 });
    written.push(desktopFile);
  }
  try {
    execFileSync("update-desktop-database", [apps], { stdio: "ignore" });
  } catch {
    /* optional tool */
  }
  return written;
}

function installMac() {
  const appDir = path.join(HOME, "Applications", "CLIPX AI.app");
  const contents = path.join(appDir, "Contents");
  const macos = path.join(contents, "MacOS");
  const resources = path.join(contents, "Resources");
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });

  const executable = path.join(macos, "CLIPX AI");
  fs.writeFileSync(
    executable,
    `#!/bin/bash
# Runs the CLIPX AI launcher; Finder provides no PATH, so add the usual places.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
cd "${ROOT}" || exit 1
exec "${process.execPath}" "${LAUNCHER}"
`,
    { mode: 0o755 }
  );

  fs.writeFileSync(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>CLIPX AI</string>
  <key>CFBundleDisplayName</key><string>CLIPX AI</string>
  <key>CFBundleIdentifier</key><string>ai.clipx.desktop</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>CLIPX AI</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`
  );
  fs.copyFileSync(ICON_PNG, path.join(resources, "icon.png"));
  return [appDir];
}

function installWindows() {
  const desktop = desktopDir() || path.join(HOME, "Desktop");
  fs.mkdirSync(desktop, { recursive: true });
  const lnk = path.join(desktop, "CLIPX AI.lnk");
  const vbs = path.join(ROOT, "desktop", "CLIPX AI.vbs");

  // PowerShell is present on every supported Windows version.
  const script = `
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}')
$sc.TargetPath = 'wscript.exe'
$sc.Arguments = '"${vbs.replace(/'/g, "''")}"'
$sc.WorkingDirectory = '${ROOT.replace(/'/g, "''")}'
$sc.IconLocation = '${ICON_ICO.replace(/'/g, "''")}'
$sc.Description = 'CLIPX AI'
$sc.Save()
`;
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { stdio: "inherit" }
  );
  return [lnk];
}

function main() {
  console.log(`\nCLIPX AI — installing a desktop shortcut (${process.platform})\n`);

  if (!fs.existsSync(LAUNCHER)) {
    console.error("desktop/launch.mjs is missing — run this from the project folder.");
    process.exit(1);
  }

  let written;
  if (process.platform === "win32") written = installWindows();
  else if (process.platform === "darwin") written = installMac();
  else written = installLinux();

  for (const file of written) console.log(`  ✅ ${file}`);
  console.log(
    "\nDone. Launch “CLIPX AI” from your desktop/app menu — the first start builds the app if needed.\n"
  );
}

main();
