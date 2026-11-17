// Cross-platform Next.js CLI runner (works in Windows CMD, PowerShell, macOS, Linux, Node 18-26)
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const root = process.cwd();
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const compatUrl = pathToFileURL(
  path.join(root, "scripts", "node-compat.mjs")
).href;

const existingOpts = process.env.NODE_OPTIONS || "";
const importFlag = `--import=${compatUrl}`;
const nodeOptions = existingOpts.includes("node-compat.mjs")
  ? existingOpts
  : `${existingOpts} ${importFlag}`.trim();

const child = spawn(process.execPath, [nextBin, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: args[0] === "dev" ? "development" : "production",
    NODE_OPTIONS: nodeOptions,
  },
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
