#!/usr/bin/env node
/**
 * CLIPX AI smoke test.
 *
 * Run against a live server:
 *   npm run build && npm start          # in one shell
 *   npm run smoke                        # in another  (SMOKE_BASE_URL to override)
 *
 * Covers the security regressions fixed in v1.5.0 plus basic availability.
 * Exits non-zero if any check fails, so it can gate CI.
 */
import { SignJWT } from "jose";

const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);
const RETIRED_DEFAULT_SECRET = "clipx-ai-studio-hmac-session-key-2026-v1";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(path, init) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  let json = null;
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    json = await res.json().catch(() => null);
  } else {
    await res.arrayBuffer().catch(() => null);
  }
  return { res, json };
}

function sessionCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  const cookie = raw.find((c) => c.startsWith("clipx_session="));
  return cookie ? cookie.split(";")[0] : "";
}

async function main() {
  console.log(`\nCLIPX AI smoke test → ${BASE}\n`);

  // ---------- availability ----------
  console.log("Availability");
  for (const page of [
    "/",
    "/dashboard",
    "/monitoring",
    "/clips",
    "/editor",
    "/chat",
    "/downloads",
    "/settings",
    "/auth",
  ]) {
    const { res } = await req(page);
    check(`GET ${page} → 200`, res.status === 200, `got ${res.status}`);
  }

  const health = await req("/api/health");
  const mediaReady = health.json?.media?.ready === true;
  console.log(
    `  ℹ️  media toolchain: ${
      mediaReady
        ? "ready (FFmpeg + FFprobe found)"
        : "NOT ready — capture/edit/export will fail (see /api/health)"
    }`
  );

  const media = await req("/api/media/clips/demo-fps-clutch.mp4", {
    headers: { Range: "bytes=0-1023" },
  });
  check("media streaming (range) → 206", media.res.status === 206);

  const traversal = await req("/api/media/..%2f..%2fpackage.json");
  check(
    "path traversal blocked (403/404)",
    [403, 404].includes(traversal.res.status),
    `got ${traversal.res.status}`
  );

  // ---------- authentication ----------
  console.log("\nAuthentication");
  const demo = await req("/api/auth/demo", { method: "POST" });
  const demoCookie = sessionCookie(demo.res);
  check("demo login → 200 + session cookie", demo.res.status === 200 && !!demoCookie);

  const forged = await new SignJWT({ sub: "user-demo" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(new TextEncoder().encode(RETIRED_DEFAULT_SECRET));
  const forgedMe = await req("/api/auth/me", {
    headers: { Cookie: `clipx_session=${forged}` },
  });
  check(
    "retired hardcoded secret cannot forge a session",
    forgedMe.json?.user == null
  );

  // ---------- authorization ----------
  console.log("\nAuthorization");
  const guestConnect = await req("/api/streams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ streamUrl: "https://www.twitch.tv/shroud" }),
  });
  check(
    "anonymous stream connect → 401",
    guestConnect.res.status === 401,
    `got ${guestConnect.res.status}`
  );

  const guestSettings = await req("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ twitchAccessToken: "attacker-token" }),
  });
  check(
    "anonymous settings write → 401",
    guestSettings.res.status === 401,
    `got ${guestSettings.res.status}`
  );

  const guestUpload = await req("/api/streams/upload", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: "not-a-video",
  });
  check(
    "anonymous upload → 401",
    guestUpload.res.status === 401,
    `got ${guestUpload.res.status}`
  );

  const demoDelete = await req("/api/streams/stream-demo-sandbox", {
    method: "DELETE",
    headers: { Cookie: demoCookie },
  });
  check(
    "demo stream is read-only",
    demoDelete.res.status === 400,
    `got ${demoDelete.res.status}`
  );

  // ---------- rate limiting ----------
  console.log("\nRate limiting");
  let sawThrottle = false;
  for (let i = 0; i < 12 && !sawThrottle; i += 1) {
    const attempt = await req("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `nobody-${Date.now()}@example.com`,
        password: "definitely-wrong",
      }),
    });
    if (attempt.res.status === 429) sawThrottle = true;
  }
  check("repeated bad logins are rate limited (429)", sawThrottle);

  // ---------- summary ----------
  console.log(
    `\n${failures.length === 0 ? "✅ PASS" : "❌ FAIL"} — ${passed} passed, ${failures.length} failed`
  );
  for (const failure of failures) console.log(`   • ${failure}`);
  console.log("");
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nSmoke test crashed: ${err?.message || err}`);
  console.error("Is the server running? Start it with `npm start`.");
  process.exit(1);
});
