import "./scripts/node-compat.mjs";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import initSqlJs from "sql.js";
import { WebSocketServer } from "ws";

// Propagate Node 18–26 compatibility shim to any child workers spawned by Next.js
const compatHref = pathToFileURL(
  path.join(process.cwd(), "scripts", "node-compat.mjs")
).href;
if (!(process.env.NODE_OPTIONS || "").includes("node-compat.mjs")) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --import=${compatHref}`.trim();
}

// Support cross-platform CLI flags (--dev / --prod) for Windows CMD & PowerShell
if (process.argv.includes("--prod")) {
  process.env.NODE_ENV = "production";
} else if (process.argv.includes("--dev")) {
  process.env.NODE_ENV = "development";
} else if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
}

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

// Ensure production build exists before starting with `npm start`
if (!dev && !fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
  console.error(
    "\n[CLIPX AI] No production build found yet. Run `npm run build` first, or use `npm run dev`.\n"
  );
  process.exit(1);
}

// Pre-load pure WebAssembly SQLite engine (zero native C++/Python build tools needed!)
const wasmPath = path.join(
  process.cwd(),
  "node_modules",
  "sql.js",
  "dist",
  "sql-wasm.wasm"
);
globalThis.__clipxSqlJs = await initSqlJs({
  wasmBinary: fs.readFileSync(wasmPath),
});

// Global WebSocket client registry shared with Next.js API routes
if (!globalThis.__clipxWsClients) {
  globalThis.__clipxWsClients = new Set();
}

const { default: next } = await import("next");
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  globalThis.__clipxWsClients.add(ws);

  ws.send(
    JSON.stringify({
      event: "connected",
      payload: {
        message: "CLIPX AI Real-Time Telemetry Socket connected",
        clients: globalThis.__clipxWsClients.size,
      },
      timestamp: new Date().toISOString(),
    })
  );

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.type === "ping") {
        ws.send(
          JSON.stringify({
            event: "pong",
            payload: { ts: Date.now() },
            timestamp: new Date().toISOString(),
          })
        );
      }
    } catch {
      // ignore malformed frames
    }
  });

  ws.on("close", () => {
    globalThis.__clipxWsClients.delete(ws);
  });

  ws.on("error", () => {
    globalThis.__clipxWsClients.delete(ws);
  });
});

function parseRequestUrl(rawUrl = "/") {
  const urlObj = new URL(rawUrl, `http://localhost:${port}`);
  const query = {};
  for (const [k, v] of urlObj.searchParams.entries()) {
    if (k in query) {
      const prev = query[k];
      query[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else {
      query[k] = v;
    }
  }
  return {
    pathname: urlObj.pathname,
    query,
    search: urlObj.search,
    href: urlObj.pathname + urlObj.search,
    path: urlObj.pathname + urlObj.search,
  };
}

const server = createServer((req, res) => {
  const parsedUrl = parseRequestUrl(req.url || "/");
  handle(req, res, parsedUrl);
});

const nextUpgradeHandler = app.getUpgradeHandler();

server.on("upgrade", (req, socket, head) => {
  const { pathname } = parseRequestUrl(req.url || "/");
  if (pathname === "/api/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    nextUpgradeHandler(req, socket, head);
  }
});

// Keepalive ping every 25s
setInterval(() => {
  for (const ws of globalThis.__clipxWsClients) {
    if (ws.readyState === 1) {
      try {
        ws.ping();
      } catch {
        // ignore
      }
    }
  }
}, 25000);

server.listen(port, hostname, () => {
  console.log(
    `\n> CLIPX AI ready in ${dev ? "development" : "production"} mode`
  );
  console.log(`> Local:      http://localhost:${port}`);
  console.log(`> Network:    http://${hostname}:${port}`);
  console.log(`> WebSockets: ws://localhost:${port}/api/ws\n`);
});
